import {
  SlashCommandBuilder,
  EmbedBuilder,
  AttachmentBuilder,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
import type { Command } from '../../core/commands.js';

export const avatarCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('avatar')
    .setDescription('View a user\'s avatar, optionally as a high-quality card.')
    .addUserOption((option) =>
      option.setName('user').setDescription('The user to view avatar for').setRequired(false),
    )
    .setDMPermission(true)
    .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages),
  category: 'utility',
  cooldownSeconds: 5,
  execute: async (context) => {
    const { interaction } = context;
    const target = interaction.options.getUser('user') ?? interaction.user;

    const avatarUrl = target.displayAvatarURL({ extension: 'png', size: 1024 });
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setAuthor({ name: target.username, iconURL: target.displayAvatarURL() })
      .setImage(avatarUrl)
      .setFooter({ text: '愛 Bella Star • Avatar' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
};