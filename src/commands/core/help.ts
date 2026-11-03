import { SlashCommandBuilder } from 'discord.js';
import type { Command } from '../core/commands.js';

export const helpCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("help")
    .setDescription("List all available commands."),
  category: "utility",
  execute: async (context) => {
    const { client, interaction } = context;
    const list = [...client.commands.values()]
      .map((c) => `/${c.data.name}`)
      .join(", ");
    await interaction.reply({
      content: `📖 **Sukuna Bot Commands**\n\n${list}`,
      flags: 64, // Ephemeral
    });
  },
};
