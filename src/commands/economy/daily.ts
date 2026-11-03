import { SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../core/commands.js';
import { getUser } from '../../db/index.js';

export const dailyCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("daily")
    .setDescription("Claim your daily reward."),
  category: "economy",
  cooldownSeconds: 86400,
  execute: async (context) => {
    const { interaction, client } = context;
    const now = Date.now();
    const user = await getUser(interaction.user.id);

    const remainingMs = 86400 * 1000;
    if (user.lastDaily && now - user.lastDaily.getTime() < remainingMs) {
      const remaining = Math.ceil((remainingMs - (now - user.lastDaily.getTime())) / 1000 / 60);
      await interaction.reply({
        content: `⏳ Daily available in ${remaining} minute(s).`,
        flags: 64,
      });
      return;
    }

    const reward = 500;
    user.balance += reward;
    user.lastDaily = new Date();
    await user.save();

    await interaction.reply(
      `💵 You claimed your daily reward of ${reward.toLocaleString()} coins!`,
    );
  },
};
