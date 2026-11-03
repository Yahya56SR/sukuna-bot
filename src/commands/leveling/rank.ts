import { SlashCommandBuilder, EmbedBuilder } from "discord.js";

export default {
  data: new SlashCommandBuilder()
    .setName("rank")
    .setDescription("Check your leveling rank.")
    .addUserOption((option) =>
      option.setName("user").setDescription("The user to check").setRequired(false)
    ),
  category: "Leveling",
  execute: async (client: any, interaction: any) => {
    const { User } = require("../../database/models/User");
    const user = interaction.options.getUser("user") || interaction.user;

    const dbUser = await User.findOne({ userId: user.id }) || (await User.create({ userId: user.id }));
    const nextXp = require("../../utils").xpForLevel(dbUser.level + 1);
    const progress = dbUser.xp - require("../../utils").xpForLevel(dbUser.level);
    const needed = nextXp - require("../../utils").xpForLevel(dbUser.level);

    const embed = new EmbedBuilder()
      .setColor(0x7289da)
      .setTitle(`Rank — ${user.tag}`)
      .addFields(
        { name: "🏆 Level", value: dbUser.level.toString(), inline: true },
        { name: "✨ XP", value: `${progress.toLocaleString()} / ${needed.toLocaleString()}`, inline: true },
        { name: "📊 Total XP", value: dbUser.totalXp.toLocaleString(), inline: true }
      );

    await interaction.reply({ embeds: [embed] });
  },
};
