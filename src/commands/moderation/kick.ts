import { SlashCommandBuilder } from "discord.js";

export default {
  data: new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Kick a member from the server.")
    .addUserOption((option) =>
      option.setName("user").setDescription("The user to kick").setRequired(true)
    )
    .addStringOption((option) =>
      option.setName("reason").setDescription("Reason for kicking").setRequired(false)
    ),
  category: "Moderation",
  userPermissions: ["KickMembers"],
  botPermissions: ["KickMembers"],
  execute: async (client: any, interaction: any) => {
    const user = interaction.options.getUser("user");
    const reason = interaction.options.getString("reason") || "No reason provided";
    const member = interaction.guild?.members.cache.get(user!.id);

    if (!member) {
      return interaction.reply({ content: "❌ User not found in this server.", ephemeral: true });
    }

    if (!member.kickable) {
      return interaction.reply({ content: "❌ I cannot kick this user.", ephemeral: true });
    }

    await member.kick(reason);
    await interaction.reply(`👢 Kicked ${user.tag} — Reason: ${reason}`);
  },
};
