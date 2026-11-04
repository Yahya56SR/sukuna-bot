import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
import type { Command } from '../../core/commands.js';
import { setUserXp } from '../../db/index.js';

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
    const { interaction } = context;
    const targetUser = interaction.options.getUser('user', true);

    // Owner-only check
    const ownerIds = (process.env.OWNER_IDS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!ownerIds.includes(interaction.user.id)) {
      await interaction.reply({
        content: '❌ This command is owner-only.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await setUserXp(targetUser.id, 0);

    const embed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle('✅ XP Reset')
      .setDescription(`XP has been reset for **${targetUser.tag}**`)
      .setFooter({ text: '爱 Doctora • XP Reset' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};