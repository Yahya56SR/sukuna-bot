import { SlashCommandBuilder, EmbedBuilder, Colors } from 'discord.js';
import type { Command } from '../../core/commands.js';
import { User } from '../../db/models/User.js';
import { formatCoins } from '../../utils/economy.js';

const MAX_LEADERBOARD = 10;

export const richCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('rich')
    .setDescription('See who holds the most coins.')
    .addIntegerOption((option) =>
      option
        .setName('limit')
        .setDescription('How many members to show')
        .setMinValue(1)
        .setMaxValue(MAX_LEADERBOARD),
    ),
  category: 'economy',
  cooldownSeconds: 10,
  execute: async (context) => {
    const { interaction } = context;
    const limit = interaction.options.getInteger('limit') ?? 10;

    // Sorted on the `{ balance: -1 }` index instead of the old hardcoded list,
    // which showed five fake users sorted by XP.
    const rows = await User.find({ balance: { $gt: 0 } })
      .sort({ balance: -1, userId: 1 })
      .limit(limit)
      .lean();

    if (!rows.length) {
      await interaction.reply('🪙 Nobody has earned coins yet.');
      return;
    }

    const medal = ['🥇', '🥈', '🥉'];
    const lines = rows.map((row, index) => {
      const place = medal[index] ?? `**${index + 1}.**`;
      return `${place} <@${row.userId}> — **${formatCoins(row.balance)}** coins`;
    });

    const viewer = rows.findIndex((row) => row.userId === interaction.user.id);
    const footer =
      viewer >= 0
        ? `Your rank: #${viewer + 1}`
        : 'Earn coins with /daily, /work or the casino.';

    const embed = new EmbedBuilder()
      .setColor(Colors.Gold)
      .setTitle('💰 Richest Members')
      .setDescription(lines.join('\n'))
      .setFooter({ text: footer });

    await interaction.reply({ embeds: [embed] });
  },
};
