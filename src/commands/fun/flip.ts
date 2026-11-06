import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
import type { Command } from '../../core/commands.js';

export const flipCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('flip')
    .setDescription('Flip a coin.')
    .setDMPermission(true)
    .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages),
  category: 'fun',
  cooldownSeconds: 5,
  execute: async (context) => {
    const { interaction } = context;
    const result = Math.random() < 0.5 ? 'Heads' : 'Tails';

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('🪙 Coin Flip')
      .setDescription(`**${result}**`)
      .setFooter({ text: '愛 Bella Star • Flip' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};