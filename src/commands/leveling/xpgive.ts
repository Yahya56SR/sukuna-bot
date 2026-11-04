import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
import type { Command } from '../../core/commands.js';
import { addXp } from '../../db/index.js';

export const xpgiveCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('xpgive')
    .setDescription('Give XP to a member (owner only).')
    .addUserOption((option) =>
      option.setName('user').setDescription('The user to give XP to').setRequired(true),
    )
    .addIntegerOption((option) =>
      option.setName('amount').setDescription('Amount of XP to give').setMinValue(1).setMaxValue(10000).setRequired(true),
    )
    .addIntegerOption((option) =>
      option.setName('level').setDescription('Force a level (optional)').setMinValue(0).setMaxValue(1000),
    )
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  category: 'leveling',
  execute: async (context) => {
    const { interaction } = context;
    const targetUser = interaction.options.getUser('user', true);
    const amount = interaction.options.getInteger('amount', true);

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

    await addXp(targetUser.id, amount, 'admin', 0);

    const embed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle('✅ XP Given')
      .addFields(
        { name: 'User', value: targetUser.tag, inline: true },
        { name: 'XP Given', value: `${amount}`, inline: true },
      )
      .setFooter({ text: '爱 Doctora • XP Given' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};