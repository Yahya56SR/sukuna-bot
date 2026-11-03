import { SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../core/commands.js';
import { DEFAULT_DISPLAY_NAME, getSukunaConfig } from '../../config/index.js';

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
    const name = getSukunaConfig().displayName || DEFAULT_DISPLAY_NAME;
    await interaction.reply({
      content: `📖 **${name} Commands**\n\n${list}`,
      flags: 64, // Ephemeral
    });
  },
};
