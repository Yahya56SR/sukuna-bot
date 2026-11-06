import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
import type { Command } from '../../core/commands.js';

// A small curated list of dare prompts for fun
const darePrompts = [
  'Do 10 push-ups right now.',
  'Send a random message to your closest contact.',
  'Send the last text message in your inbox to the group chat.',
  'Eat a spoonful of something spicy.',
  'Post your last three search queries.',
  'Do your best impression of the person to your left.',
  'Take a selfie and post it in the chat.',
  'Open your Spotify and share the now-playing song.',
];

export const dareCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('dare')
    .setDescription('Get a random dare.')
    .setDMPermission(true)
    .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages),
  category: 'fun',
  cooldownSeconds: 5,
  execute: async (context) => {
    const { interaction } = context;
    const dare = darePrompts[Math.floor(Math.random() * darePrompts.length)];
    await interaction.reply({ content: `💥 **Dare:** ${dare}`, flags: MessageFlags.Ephemeral });
  },
};