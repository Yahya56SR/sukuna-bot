import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
import type { Command } from '../../core/commands.js';

export const complimentCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('compliment')
    .setDescription('Give a compliment to someone.')
    .addUserOption((option) =>
      option.setName('user').setDescription('The user to compliment').setRequired(false),
    )
    .setDMPermission(true)
    .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages),
  category: 'fun',
  execute: async (context) => {
    const { interaction } = context;
    const target = interaction.options.getUser('user') ?? interaction.user;

    const compliments = [
      'You have great energy!',
      'Your smile lights up the room.',
      'You are incredibly thoughtful.',
      'You have great taste in music.',
      'You are a really good friend.',
      'Your creativity is inspiring.',
      'You always know how to make people smile.',
      'You have a fantastic personality.',
      'You are super smart.',
      'You light up every room you enter.',
    ];

    const compliment =
      compliments[Math.floor(Math.random() * compliments.length)];

    const embed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle('💖 Compliment')
      .setDescription(`**${target.username}**, ${compliment}`)
      .setFooter({ text: '爱 Doctora • Compliment' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};