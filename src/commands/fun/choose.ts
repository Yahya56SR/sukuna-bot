import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
import type { Command } from '../../core/commands.js';

export const chooseCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('choose')
    .setDescription('Let the bot choose one option from a list.')
    .addStringOption((option) =>
      option.setName('options').setDescription('Comma-separated list of options').setRequired(true).setMaxLength(200),
    )
    .setDMPermission(true)
    .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages),
  category: 'fun',
  cooldownSeconds: 5,
  execute: async (context) => {
    const { interaction } = context;
    const optionsStr = interaction.options.getString('options', true);
    const options = optionsStr.split(',').map((o) => o.trim()).filter((o) => o.length > 0);

    if (options.length < 2) {
      await interaction.reply({
        content: '❌ You need at least 2 options.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const choice = options[Math.floor(Math.random() * options.length)];

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('🎯 Choice')
      .setDescription(`I choose: **${choice}**`)
      .setFooter({ text: '愛 Bella Star • Choose' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};