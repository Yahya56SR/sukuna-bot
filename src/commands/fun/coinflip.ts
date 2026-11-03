import { SlashCommandBuilder } from 'discord.js';
import type { Command } from '../core/commands.js';

export const coinflipCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("coinflip")
    .setDescription("Flip a coin."),
  category: "fun",
  execute: async (context) => {
    const { interaction } = context;
    const result = Math.random() < 0.5 ? "Heads" : "Tails";
    await interaction.reply(`🪙 Coin flip: **${result}**!`);
  },
};
