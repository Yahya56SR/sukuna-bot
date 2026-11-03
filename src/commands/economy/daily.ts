import { SlashCommandBuilder } from "discord.js";

export default {
  data: new SlashCommandBuilder()
    .setName("daily")
    .setDescription("Claim your daily reward."),
  category: "Economy",
  cooldown: 86400,
  execute: async (client: any, interaction: any) => {
    const { User } = require("../../database/models/User");
    const now = Date.now();
    const user = await User.findOne({ userId: interaction.user.id }) || (await User.create({ userId: interaction.user.id }));

    if (user.lastDaily && now - user.lastDaily.getTime() < 86400 * 1000) {
      const remaining = Math.ceil((86400 * 1000 - (now - user.lastDaily.getTime())) / 1000 / 60);
      return interaction.reply({ content: `⏳ Daily available in ${remaining} minute(s).`, ephemeral: true });
    }

    const reward = 500;
    user.balance += reward;
    user.lastDaily = new Date();
    await user.save();

    await interaction.reply(`💵 You claimed your daily reward of ${reward.toLocaleString()} coins!`);
  },
};
