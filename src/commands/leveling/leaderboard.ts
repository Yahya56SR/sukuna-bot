import { SlashCommandBuilder, AttachmentBuilder, MessageFlags } from 'discord.js';
import type { Command } from '../../core/commands.js';
import { getLeaderboard } from '../../db/index.js';
import { levelFromXp } from '../../utils/level.js';
import { buildLeaderboardEmbed } from '../../utils/rankEmbeds.js';
import { leaderboardCard } from '../../utils/rankcard.js';

export const leaderboardCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('View the top XP earners in the server')
    .addIntegerOption((option) =>
      option
        .setName('limit')
        .setDescription('How many members to show (1-25)')
        .setMinValue(1)
        .setMaxValue(25),
    ),
  category: 'leveling',
  execute: async (context) => {
    const { interaction } = context;
    const limit = interaction.options.getInteger('limit') ?? 10;

    // Defer before any DB/REST work: resolving up to 25 uncached users can
    // exceed Discord's 3-second acknowledgement window.
    await interaction.deferReply();

    const rows = await getLeaderboard(limit);

    if (rows.length === 0) {
      await interaction.editReply({
        content: 'No XP records yet.',
      });
      return;
    }

    const entries = await Promise.all(
      rows.map(async (row) => {
        let user = interaction.client.users.cache.get(row.user_id);
        if (!user) {
          try {
            user = await interaction.client.users.fetch(row.user_id);
          } catch {
            // User not found on Discord (e.g. left the server / deleted account)
            user = undefined;
          }
        }
        return {
          userId: row.user_id,
          username: user?.username ?? 'Unknown user',
          avatarUrl: user?.displayAvatarURL({ extension: 'png', size: 128 }) ?? '',
          level: levelFromXp(row.xp).level,
          totalXp: row.xp,
        };
      }),
    );

    try {
      const buffer = await leaderboardCard.generate(
        entries,
        interaction.guild?.name ?? 'this server',
        '🏆 Top members',
      );

      const attachment = new AttachmentBuilder(buffer, { name: 'leaderboard.png' });
      await interaction.editReply({ files: [attachment] });
    } catch (err) {
      console.error('Failed to render leaderboard image:', err);
      const embed = buildLeaderboardEmbed(
        entries.map((entry) => ({
          userId: entry.userId,
          username: entry.username,
          level: entry.level,
          totalXp: entry.totalXp,
        })),
        interaction.guild?.name ?? 'this server',
      );
      await interaction.editReply({ embeds: [embed] }).catch(() => undefined);
    }
  },
};
