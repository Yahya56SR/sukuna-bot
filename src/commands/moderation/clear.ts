import { SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../core/commands.js';

export const clearCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("clear")
    .setDescription("Delete messages in a channel.")
    .addIntegerOption((option) =>
      option
        .setName("amount")
        .setDescription("Number of messages to delete")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(100),
    ),
  category: "moderation",
  userPermissions: ["ManageMessages"],
  botPermissions: ["ManageMessages"],
  execute: async (context) => {
    const { interaction } = context;
    const amount = interaction.options.getInteger("amount")!;

    await interaction.channel?.bulkDelete(amount, true);
    await interaction.reply({
      content: `🗑️ Deleted ${amount} message(s).`,
      flags: 64,
    });
  },
};
