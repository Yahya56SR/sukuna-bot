import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
import type { Command } from '../../core/commands.js';

// A small curated list of truth questions for fun
const truthQuestions = [
  'What is the most embarrassing thing that happened to you in public?',
  'What is a secret you have never told anyone?',
  'What is the worst haircut you ever had?',
  'What is the lie you told that you got away with?',
  'What is something you did when you were younger that you regret?',
  'What is the weirdest dream you have ever had?',
  'What is a habit you have that people find weird?',
  'What is the worst gift you have ever received?',
];

export const truthCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('truth')
    .setDescription('Get a random truth question.')
    .setDMPermission(true)
    .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages),
  category: 'fun',
  cooldownSeconds: 5,
  execute: async (context) => {
    const { interaction } = context;
    const question =
      truthQuestions[Math.floor(Math.random() * truthQuestions.length)];
    await interaction.reply({ content: `🔍 **Truth:** ${question}`, flags: MessageFlags.Ephemeral });
  },
};