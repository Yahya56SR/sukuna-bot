import { SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../core/commands.js';
import { getUser } from '../../db/index.js';

export const balanceCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("balance")
    .setDescription("Check your wallet and bank balance.")
    .addUserOption((option) =>
      option.setName("user").setDescription("The user to check").setRequired(false),
    ),
  category: "economy",
  execute: async (context) => {
    const { interaction } = context;
    const user = interaction.options.getUser("user") ?? interaction.user;

    const dbUser = await getUser(user.id);

    await interaction.reply(
      `💰 Balance for ${user.tag}:\n💵 Wallet: ${dbUser.balance.toLocaleString()}\n🏦 Bank: ${dbUser.bank.toLocaleString()} / ${dbUser.bankLimit.toLocaleString()}`,
    );
  },
};
