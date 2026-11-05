import { SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../core/commands.js';
import { formatCoins, getEconomyUser, hasItem } from '../../utils/economy.js';

export const balanceCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('balance')
    .setDescription('Check your wallet and bank balance.')
    .addUserOption((option) =>
      option.setName('user').setDescription('The user to check').setRequired(false),
    ),
  category: 'economy',
  cooldownSeconds: 5,
  execute: async (context) => {
    const { interaction } = context;
    const user = interaction.options.getUser('user') ?? interaction.user;

    const dbUser = await getEconomyUser(user.id);

    const keepsakes: string[] = [];
    if (hasItem(dbUser, 'gold_plated_card')) keepsakes.push('💳 Gold-Plated Card');
    if (hasItem(dbUser, 'veteran_badge')) keepsakes.push('🎖️ Veteran Badge');

    const lines = [
      `💵 Wallet: **${formatCoins(dbUser.balance)}**`,
      `🏦 Bank: **${formatCoins(dbUser.bank)}** / ${formatCoins(dbUser.bankLimit)}`,
      `🔥 Daily streak: **${dbUser.dailyStreak ?? 0}** (best ${dbUser.maxDailyStreak ?? 0})`,
      `📦 Net worth: **${formatCoins(dbUser.balance + dbUser.bank)}**`,
    ];
    if (keepsakes.length) lines.push(`✨ ${keepsakes.join(' • ')}`);

    await interaction.reply(`💰 Balance for ${user.tag}\n${lines.join('\n')}`);
  },
};
