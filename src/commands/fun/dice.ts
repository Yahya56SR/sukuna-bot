import { SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../core/commands.js';

export const diceCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("dice")
    .setDescription("Roll a dice.")
    .addIntegerOption((option) =>
      option
        .setName("sides")
        .setDescription("Number of sides")
        .setRequired(false)
        .setMinValue(2)
        .setMaxValue(1000),
    ),
  category: "fun",
  execute: async (context) => {
    const { interaction } = context;
    const sides = interaction.options.getInteger("sides") ?? 6;
    const result = Math.floor(Math.random() * sides) + 1;
    await interaction.reply(`🎲 You rolled a ${result} (1-${sides})!`);
  },
};
