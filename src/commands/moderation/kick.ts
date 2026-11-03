import { SlashCommandBuilder } from 'discord.js';
import type { Command } from '../core/commands.js';

export const kickCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Kick a member from the server.")
    .addUserOption((option) =>
      option.setName("user").setDescription("The user to kick").setRequired(true),
    )
    .addStringOption((option) =>
      option.setName("reason").setDescription("Reason for kicking").setRequired(false),
    ),
  category: "moderation",
  userPermissions: ["KickMembers"],
  botPermissions: ["KickMembers"],
  execute: async (context) => {
    const { interaction } = context;
    const user = interaction.options.getUser("user");
    const reason = interaction.options.getString("reason") ?? "No reason provided";
    const member = interaction.guild?.members.cache.get(user!.id);

    if (!member) {
      await interaction.reply({ content: "❌ User not found in this server.", flags: 64 });
      return;
    }

    if (!member.kickable) {
      await interaction.reply({ content: "❌ I cannot kick this user.", flags: 64 });
      return;
    }

    await member.kick(reason);
    await interaction.reply(`👢 Kicked ${user.tag} — Reason: ${reason}`);
  },
};
