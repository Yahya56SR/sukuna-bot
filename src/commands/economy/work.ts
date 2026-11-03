import { SlashCommandBuilder } from "discord.js";

export default {
  data: new SlashCommandBuilder()
    .setName("work")
    .setDescription("Work to earn some coins."),
  category: "Economy",
  cooldown: 3600,
  execute: async (client: any, interaction: any) => {
    const { User } = require("../../database/models/User");
    const now = Date.now();
    const user = await User.findOne({ userId: interaction.user.id }) || (await User.create({ userId: interaction.user.id }));

    if (user.lastWork && now - user.lastWork.getTime() < 3600 * 1000) {
      const remaining = Math.ceil((3600 * 1000 - (now - user.lastWork.getTime())) / 1000 / 60);
      return interaction.reply({ content: `⏳ Work available in ${remaining} minute(s).`, ephemeral: true });
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
