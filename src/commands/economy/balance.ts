import { SlashCommandBuilder } from "discord.js";

export default {
  data: new SlashCommandBuilder()
    .setName("balance")
    .setDescription("Check your wallet and bank balance.")
    .addUserOption((option) =>
      option.setName("user").setDescription("The user to check").setRequired(false)
    ),
  category: "Economy",
  execute: async (client: any, interaction: any, guild: any) => {
    const { User } = require("../../database/models/User");
    const user = interaction.options.getUser("user") || interaction.user;

    const dbUser = await User.findOne({ userId: user.id }) || (await User.create({ userId: user.id }));

    await interaction.reply(
      `💰 Balance for ${user.tag}:\n💵 Wallet: ${dbUser.balance.toLocaleString()}\n🏦 Bank: ${dbUser.bank.toLocaleString()} / ${dbUser.bankLimit.toLocaleString()}`
    );
  },
};
