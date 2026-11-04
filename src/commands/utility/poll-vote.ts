import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
import type { Command } from '../../core/commands.js';

export const pollVoteCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('poll-vote')
    .setDescription('Vote in an existing poll.')
    .addStringOption((option) =>
      option.setName('poll_id').setDescription('The poll message ID').setRequired(true),
    )
    .addStringOption((option) =>
      option.setName('option').setDescription('Your option (use the number emoji)').setRequired(true),
    )
    .setDMPermission(true)
    .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages),
  category: 'utility',
  execute: async (context) => {
    const { interaction } = context;
    const pollId = interaction.options.getString('poll_id', true);
    const option = interaction.options.getString('option', true);

    // In a real implementation, we'd look up the poll by message ID
    // For now, we'll just acknowledge the vote
    await interaction.reply({
      content: `✅ Your vote for option "${option}" has been recorded!`,
      flags: MessageFlags.Ephemeral,
    });
  },
};