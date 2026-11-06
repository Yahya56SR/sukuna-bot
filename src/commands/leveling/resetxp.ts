import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
import type { Command } from '../../core/commands.js';
import { setUserXp } from '../../db/index.js';
import { syncLevelRoles } from '../../handlers/levelUp.js';
import { readLevelSettings } from '../../utils/levelSettings.js';
import { isOwner } from '../../core/owner.js';

export const resetXpCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('resetxp')
    .setDescription('Reset a user\'s XP (owner only).')
    .addUserOption((option) =>
      option.setName('user').setDescription('The user to reset XP for').setRequired(true),
    )
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  category: 'leveling',
  execute: async (context) => {
    const { interaction, guild } = context;
    const targetUser = interaction.options.getUser('user', true);

    // Owner-only check
    if (!isOwner(interaction.user.id)) {
      await interaction.reply({
        content: '❌ This command is owner-only.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const result = await setUserXp(targetUser.id, 0);

    // Re-derive level (now 0) and sync roles so a reset strips any level rewards.
    // Use role sync (silent) — announcing "Congratulations, level 0!" via
    // handleLevelUp is noise and previously used empty settings (no-op).
    if (guild) {
      const member =
        guild.members.cache.get(targetUser.id) ??
        (await guild.members.fetch(targetUser.id).catch(() => null));
      const settings = readLevelSettings((context as any).settings ?? {});
      if (member) {
        await syncLevelRoles(guild, member, result.newLevel, settings.levelRoles).catch(() => undefined);
      }
    }

    const embed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle('✅ XP Reset')
      .setDescription(`XP has been reset for **${targetUser.tag}**`)
      .setFooter({ text: '愛 Bella Star • XP Reset' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
