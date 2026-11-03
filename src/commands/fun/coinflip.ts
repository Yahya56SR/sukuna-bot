import { SlashCommandBuilder } from "discord.js";

export default {
  data: new SlashCommandBuilder()
    .setName("coinflip")
    .setDescription("Flip a coin."),
  category: "Fun",
  execute: async (client: any, interaction: any) => {
    const result = Math.random() < 0.5 ? "Heads" : "Tails";
    await interaction.reply(`🪙 Coin flip: **${result}**!`);
  },
};
