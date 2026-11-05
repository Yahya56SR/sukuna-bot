import { SlashCommandBuilder, EmbedBuilder, Colors } from 'discord.js';
import type { Command } from '../../core/commands.js';
import { User } from '../../db/models/User.js';
import { adjustBalance, formatCoins, getEconomyUser } from '../../utils/economy.js';
import { recordActivity } from '../../core/metrics.js';

const DAY_MS = 86_400_000;
/** Base payout, plus 50 per consecutive day up to a 500 bonus. */
const BASE_REWARD = 500;
const STREAK_BONUS_PER_DAY = 50;
const STREAK_BONUS_CAP = 500;
/** Claiming within this many hours of the last claim keeps the streak alive. */
const STREAK_GRACE_MS = DAY_MS * 2;

export const dailyCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('daily')
    .setDescription('Claim your daily reward.'),
  category: 'economy',
  cooldownSeconds: 86400,
  execute: async (context) => {
    const { interaction } = context;
    const now = Date.now();
    const user = await getEconomyUser(interaction.user.id);

    if (user.lastDaily && now - user.lastDaily.getTime() < DAY_MS) {
      const remaining = Math.ceil((DAY_MS - (now - user.lastDaily.getTime())) / 1000 / 60);
      const hours = Math.floor(remaining / 60);
      const minutes = remaining % 60;
      const human = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
      await interaction.reply({
        content: `⏳ Daily available in **${human}**. Current streak: **${user.dailyStreak ?? 0}** 🔥`,
        ephemeral: true,
      });
      return;
    }

    const previousStreak = user.dailyStreak ?? 0;
    const sinceLast = user.lastDaily ? now - user.lastDaily.getTime() : Number.POSITIVE_INFINITY;
    const freezeArmed = user.streakFreeze === true;

    let streak: number;
    let consumedFreeze = false;
    if (!user.lastDaily) {
      streak = 1;
    } else if (sinceLast < STREAK_GRACE_MS) {
      streak = previousStreak + 1;
    } else if (freezeArmed && sinceLast < STREAK_GRACE_MS * 1.5) {
      // Missed a day, but a Streak Freeze is armed — keep the run and burn it.
      streak = previousStreak + 1;
      consumedFreeze = true;
    } else {
      streak = 1;
    }

    const bonus = Math.min(streak - 1, STREAK_BONUS_CAP / STREAK_BONUS_PER_DAY) * STREAK_BONUS_PER_DAY;
    const reward = BASE_REWARD + bonus;

    // Claim is guarded on `lastDaily` so two concurrent claims cannot both pay.
    const claimed = await User.findOneAndUpdate(
      {
        userId: interaction.user.id,
        $or: [{ lastDaily: null }, { lastDaily: { $lt: new Date(now - DAY_MS) } }],
      },
      {
        $inc: { balance: reward },
        $set: {
          lastDaily: new Date(now),
          dailyStreak: streak,
          ...(consumedFreeze ? { streakFreeze: false } : {}),
        },
        $max: { maxDailyStreak: streak },
      },
      { new: true },
    );

    if (!claimed) {
      await interaction.reply({
        content: '⏳ Your daily was just claimed by another request.',
        ephemeral: true,
      });
      return;
    }

    recordActivity('command', `${interaction.user.tag} claimed a daily`, {
      meta: { guildId: interaction.guildId, userId: interaction.user.id, streak, reward },
    });

    const streakLine = consumedFreeze
      ? `🧊 A Streak Freeze kept your streak alive — **${streak}** days!`
      : `🔥 Daily streak: **${streak}**${streak > 1 ? ` (+${formatCoins(bonus)} bonus)` : ''}`;

    const embed = new EmbedBuilder()
      .setColor(Colors.Gold)
      .setTitle('💵 Daily Reward')
      .setDescription(
        `You claimed **${formatCoins(reward)}** coins.\n${streakLine}\nWallet: **${formatCoins(claimed.balance)}**`,
      )
      .setFooter({ text: '爱 Doctora • Economy' });

    await interaction.reply({ embeds: [embed] });
  },
};
