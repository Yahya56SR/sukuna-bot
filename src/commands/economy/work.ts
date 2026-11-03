import { SlashCommandBuilder } from 'discord.js';
import type { Command } from '../core/commands.js';
import { getUser } from '../../db/index.js';

export const workCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("work")
    .setDescription("Work to earn some coins."),
  category: "economy",
  cooldownSeconds: 3600,
  execute: async (context) => {
    const { interaction } = context;
    const now = Date.now();
    const user = await getUser(interaction.user.id);

    const remainingMs = 3600 * 1000;
    if (user.lastWork && now - user.lastWork.getTime() < remainingMs) {
      const remaining = Math.ceil((remainingMs - (now - user.lastWork.getTime())) / 1000 / 60);
      await interaction.reply({
        content: `⏳ Work available in ${remaining} minute(s).`,
        flags: 64,
      });
      return;
    }

    const jobs = ["Pizza delivery", "Software dev", "Security guard", "Barista", "Streamer"];
    const job = jobs[Math.floor(Math.random() * jobs.length)];
    const reward = Math.floor(Math.random() * 400) + 100;

    user.balance += reward;
    user.lastWork = new Date();
    await user.save();

    await interaction.reply(`💼 You worked as a ${job} and earned ${reward.toLocaleString()} coins!`);
  },
};
