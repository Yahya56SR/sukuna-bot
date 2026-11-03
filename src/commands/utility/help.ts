import { SlashCommandBuilder } from "discord.js";

export default {
  data: new SlashCommandBuilder()
    .setName("help")
    .setDescription("List all available commands."),
  category: "Utility",
  execute: async (client: any, interaction: any) => {
    const categories: Record<string, string[]> = {};
    for (const cmd of client.commands.values()) {
      const cat = cmd.category || "Other";
      if (!categories[cat]) categories[cat] = [];
      categories[cat].push(`/${cmd.data.name}`);
    }

    let description = "";
    for (const [cat, cmds] of Object.entries(categories)) {
      description += `**${cat}:** ${cmds.join(", ")}\n`;
    }

    await interaction.reply({ content: `📖 **Sukuna Bot Commands**\n\n${description}`, ephemeral: true });
  },
};
