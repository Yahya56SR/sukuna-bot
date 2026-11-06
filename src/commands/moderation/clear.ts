import {
  SlashCommandBuilder,
  EmbedBuilder,
  Colors,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
import type { Command } from '../../core/commands.js';

export const clearCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Delete messages in a channel.')
    .setDMPermission(false)
    .addIntegerOption((option) =>
      option
        .setName('amount')
        .setDescription('Number of messages to delete')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(100),
    ),
  category: 'moderation',
  userPermissions: [PermissionFlagsBits.ManageMessages],
  botPermissions: [PermissionFlagsBits.ManageMessages],
  cooldownSeconds: 5,
  execute: async (context) => {
    const { interaction } = context;
    const amount = interaction.options.getInteger('amount')!;

    const channel = interaction.channel as any;
    if (!channel || typeof channel.bulkDelete !== 'function') {
      await interaction.reply({
        content: '❌ This channel does not support bulk deletion.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const deleted = await channel.bulkDelete(amount, true).catch(() => null);
    const count = deleted?.size ?? 0;

    const embed = new EmbedBuilder()
      .setColor(Colors.Blurple)
      .setTitle('🗑️ Messages Deleted')
      .setDescription(`Deleted ${count} message(s).`)
      .setFooter({ text: '愛 Bella Star • Moderation' })
      .setTimestamp();

    await interaction.reply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral,
    });
  },
};
