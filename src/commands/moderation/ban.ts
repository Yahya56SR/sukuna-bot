import { SlashCommandBuilder } from "discord.js";

export default {
  data: new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Ban a member from the server.")
    .addUserOption((option) =>
      option.setName("user").setDescription("The user to ban").setRequired(true)
    )
    .addStringOption((option) =>
      option.setName("reason").setDescription("Reason for banning").setRequired(false)
    ),
  category: "Moderation",
  userPermissions: ["BanMembers"],
  botPermissions: ["BanMembers"],
  execute: async (client: any, interaction: any) => {
    const user = interaction.options.getUser("user");
    const reason = interaction.options.getString("reason") || "No reason provided";

    await interaction.guild?.members.ban(user!, { reason });
    await interaction.reply(`🔨 Banned ${user.tag} — Reason: ${reason}`);
  },
};
