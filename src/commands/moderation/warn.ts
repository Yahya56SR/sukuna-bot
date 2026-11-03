import { SlashCommandBuilder } from "discord.js";

export default {
  data: new SlashCommandBuilder()
    .setName("warn")
    .setDescription("Warn a member.")
    .addUserOption((option) =>
      option.setName("user").setDescription("The user to warn").setRequired(true)
    )
    .addStringOption((option) =>
      option.setName("reason").setDescription("Reason for warning").setRequired(false)
    ),
  category: "Moderation",
  userPermissions: ["ModerateMembers"],
  execute: async (client: any, interaction: any, guild: any) => {
    const { User } = require("../../database/models/User");
    const user = interaction.options.getUser("user");
    const reason = interaction.options.getString("reason") || "No reason provided";

    const dbUser = await User.findOne({ userId: user!.id });
    if (!dbUser) {
      // ensure exists
      await User.create({ userId: user!.id });
    }

    const target = await User.findOne({ userId: user!.id });
    target!.warnings.push({
      guildId: interaction.guild!.id,
      moderatorId: interaction.user.id,
      reason,
      createdAt: new Date(),
    });
    await target!.save();

    await interaction.reply(
      `⚠️ Warned ${user.tag} — Reason: ${reason}\nTotal warnings: ${target!.warnings.length}`
    );
  },
};
