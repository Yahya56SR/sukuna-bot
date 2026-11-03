import { SlashCommandBuilder } from "discord.js";

export default {
  data: new SlashCommandBuilder()
    .setName("clear")
    .setDescription("Delete messages in a channel.")
    .addIntegerOption((option) =>
      option.setName("amount").setDescription("Number of messages to delete").setRequired(true).setMinValue(1).setMaxValue(100)
    ),
  category: "Moderation",
  userPermissions: ["ManageMessages"],
  botPermissions: ["ManageMessages"],
  execute: async (client: any, interaction: any) => {
    const amount = interaction.options.getInteger("amount")!;

    await interaction.channel?.bulkDelete(amount, true);
    await interaction.reply({
      content: `🗑️ Deleted ${amount} message(s).`,
      ephemeral: true,
    });
  },
};
