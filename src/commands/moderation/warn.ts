import { SlashCommandBuilder } from 'discord.js';
import type { Command } from '../core/commands.js';
import { getUser } from '../../db/index.js';

export const warnCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("warn")
    .setDescription("Warn a member.")
    .addUserOption((option) =>
      option.setName("user").setDescription("The user to warn").setRequired(true),
    )
    .addStringOption((option) =>
      option.setName("reason").setDescription("Reason for warning").setRequired(false),
    ),
  category: "moderation",
  userPermissions: ["ModerateMembers"],
  execute: async (context) => {
    const { interaction } = context;
    const user = interaction.options.getUser("user");
    const reason = interaction.options.getString("reason") ?? "No reason provided";

    const target = await getUser(user!.id);

    await interaction.reply(
      `⚠️ Warned ${user.tag} — Reason: ${reason}`,
    );
  },
};
