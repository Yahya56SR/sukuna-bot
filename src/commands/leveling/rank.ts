import { SlashCommandBuilder, AttachmentBuilder, MessageFlags } from 'discord.js';
import type { Command } from '../../core/commands.js';
import { countRanked, getRankPosition, getUserXp } from '../../db/index.js';
import { levelFromXp } from '../../utils/level.js';
import { buildRankCard } from '../../utils/rankEmbeds.js';
import { rankCard } from '../../utils/rankcard.js';

export const rankCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('rank')
    .setDescription('Check your XP and level')
    .addUserOption((option) =>
      option.setName('user').setDescription('The user to check').setRequired(false),
    ),
  category: 'leveling',
  execute: async (context) => {
    const { interaction } = context;
    const target = interaction.options.getUser('user') ?? interaction.user;
    const guild = interaction.guild;

    const row = await getUserXp(target.id);
    if (!row || row.xp <= 0) {
      await interaction.reply({
        content: `${target.username} hasn't earned any XP yet.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const info = levelFromXp(row.xp);
    const [position, totalRanked] = await Promise.all([
      getRankPosition(target.id),
      countRanked(),
    ]);

    // Rendering happens off the response path, so defer first.
    await interaction.deferReply();

    try {
      const buffer = await rankCard.generate({
        avatarUrl: target.displayAvatarURL({ extension: 'png', size: 256 }),
        username: target.displayName,
        statusText: null,
        level: info.level,
        rank: position || null,
        totalRanked,
        xpIntoLevel: info.xpInLevel,
        xpNeeded: info.xpForNext,
        totalXp: info.totalXp,
        guildName: guild?.name,
      });

      const attachment = new AttachmentBuilder(buffer, { name: 'rank.png' });
      await interaction.editReply({ files: [attachment] });
    } catch (err) {
      console.error('Failed to render rank card:', err);
      // Fall back to a plain embed if the canvas fails.
      const embed = buildRankCard({
        user: target,
        info,
        guildName: guild?.name ?? 'this server',
        position,
      });
      await interaction.editReply({ embeds: [embed] }).catch(() => undefined);
    }
  },
};
