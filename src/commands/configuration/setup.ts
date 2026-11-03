import { SlashCommandBuilder } from "discord.js";

export default {
  data: new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Quick server setup wizard (owner only).")
    .addStringOption((option) =>
      option
        .setName("module")
        .setDescription("Module to configure")
        .setRequired(true)
        .addChoices(
          { name: "Moderation", value: "moderation" },
          { name: "Economy", value: "economy" },
          { name: "Leveling", value: "leveling" },
          { name: "Tickets", value: "tickets" },
          { name: "Welcome", value: "welcome" },
          { name: "Logging", value: "logging" }
        )
    ),
  category: "Configuration",
  ownerOnly: true,
  execute: async (client: any, interaction: any, guild: any) => {
    const module = interaction.options.getString("module")!;

    await interaction.reply(
      `⚙️ Setup for **${module}** is not fully configured yet. Use the dashboard or contact support to finish setup.`
    );
  },
};
