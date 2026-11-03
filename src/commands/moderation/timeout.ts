import { SlashCommandBuilder } from 'discord.js';
import type { Command } from '../core/commands.js';

export const timeoutCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("timeout")
    .setDescription("Timeout a member.")
    .addUserOption((option) =>
      option.setName("user").setDescription("The user to timeout").setRequired(true),
    )
    .addIntegerOption((option) =>
      option
        .setName("duration")
        .setDescription("Duration in minutes")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(40320),
    )
    .addStringOption((option) =>
      option.setName("reason").setDescription("Reason for timeout").setRequired(false),
    ),
  category: "moderation",
  userPermissions: ["ModerateMembers"],
  botPermissions: ["ModerateMembers"],
  execute: async (context) => {
    const { interaction } = context;
    const user = interaction.options.getUser("user");
    const minutes = interaction.options.getInteger("duration")!;
    const reason = interaction.options.getString("reason") ?? "No reason provided";
    const member = interaction.guild?.members.cache.get(user!.id);

    if (!member) {
      await interaction.reply({ content: "❌ User not found in this server.", flags: 64 });
      return;
    }

    const durationMs = minutes * 60 * 1000;
    await member.timeout(durationMs, reason);
    await interaction.reply(
      `⏱️ Timed out ${user.tag} for ${minutes} minute(s) — Reason: ${reason}`,
    );
  },
};
