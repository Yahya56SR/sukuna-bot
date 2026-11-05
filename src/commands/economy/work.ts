import { SlashCommandBuilder, EmbedBuilder, Colors } from 'discord.js';
import type { Command } from '../../core/commands.js';
import { GameProfile } from '../../db/models/GameProfile.js';
import { User } from '../../db/models/User.js';
import { formatCoins, getEconomyUser } from '../../utils/economy.js';
import { recordActivity } from '../../core/metrics.js';

const WORK_COOLDOWN_MS = 3_600_000;

interface Job {
  name: string;
  emoji: string;
  min: number;
  max: number;
  /** Chance the shift goes sideways and pays nothing. */
  failureRate: number;
}

const JOBS: readonly Job[] = [
  { name: 'Pizza delivery', emoji: '🍕', min: 120, max: 380, failureRate: 0.08 },
  { name: 'Software developer', emoji: '💻', min: 200, max: 600, failureRate: 0.12 },
  { name: 'Security guard', emoji: '🛡️', min: 150, max: 420, failureRate: 0.1 },
  { name: 'Barista', emoji: '☕', min: 90, max: 260, failureRate: 0.05 },
  { name: 'Streamer', emoji: '📺', min: 60, max: 900, failureRate: 0.3 },
  { name: 'Fisherman', emoji: '🎣', min: 100, max: 500, failureRate: 0.18 },
  { name: 'Courier', emoji: '📦', min: 130, max: 400, failureRate: 0.09 },
];

export const workCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('work')
    .setDescription('Work a shift to earn some coins.'),
  category: 'economy',
  cooldownSeconds: 3600,
  execute: async (context) => {
    const { interaction } = context;
    const now = Date.now();
    const user = await getEconomyUser(interaction.user.id);

    if (user.lastWork && now - user.lastWork.getTime() < WORK_COOLDOWN_MS) {
      const remaining = Math.ceil((WORK_COOLDOWN_MS - (now - user.lastWork.getTime())) / 1000 / 60);
      const hours = Math.floor(remaining / 60);
      const minutes = remaining % 60;
      const human = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
      await interaction.reply({ content: `⏳ You can work again in **${human}**.`, ephemeral: true });
      return;
    }

    const job = JOBS[Math.floor(Math.random() * JOBS.length)];
    const failed = Math.random() < job.failureRate;
    const reward = failed ? 0 : Math.floor(Math.random() * (job.max - job.min + 1)) + job.min;

    // Guarded on `lastWork` so two concurrent shifts cannot both be paid.
    const updated = await User.findOneAndUpdate(
      {
        userId: interaction.user.id,
        $or: [{ lastWork: null }, { lastWork: { $lt: new Date(now - WORK_COOLDOWN_MS) } }],
      },
      {
        $inc: { balance: reward },
        $set: { lastWork: new Date(now) },
      },
      { new: true },
    );

    if (!updated) {
      await interaction.reply({ content: '⏳ Your shift was just completed by another request.', ephemeral: true });
      return;
    }

    if (!failed) {
      void GameProfile.updateOne(
        { userId: interaction.user.id, guildId: interaction.guildId },
        {
          $inc: { 'work.timesWorked': 1, 'work.totalEarned': reward },
          $set: { 'work.bestJob': job.name },
          $setOnInsert: { userId: interaction.user.id, guildId: interaction.guildId },
        },
        { upsert: true },
      ).catch(() => undefined);
    }

    recordActivity('command', `${interaction.user.tag} worked as ${job.name}`, {
      meta: { guildId: interaction.guildId, userId: interaction.user.id, reward },
    });

    const description = failed
      ? `${job.emoji} Your shift as a **${job.name}** went sideways and you earned nothing better luck next time.`
      : `${job.emoji} You worked as a **${job.name}** and earned **${formatCoins(reward)}** coins!\nWallet: **${formatCoins(updated.balance)}**`;

    const embed = new EmbedBuilder()
      .setColor(failed ? Colors.Red : Colors.Green)
      .setTitle(failed ? '💼 Shift gone wrong' : '💼 Shift complete')
      .setDescription(description)
      .setFooter({ text: '爱 Doctora • Economy' });

    await interaction.reply({ embeds: [embed] });
  },
};
