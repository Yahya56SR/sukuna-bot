import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import type { Command } from '../core/commands.js';
import { getUser, xpForLevel } from '../../db/index.js';

export const rankCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("rank")
    .setDescription("Check your leveling rank.")
    .addUserOption((option) =>
      option.setName("user").setDescription("The user to check").setRequired(false),
    ),
  category: "leveling",
  execute: async (context) => {
    const { interaction } = context;
    const user = interaction.options.getUser("user") ?? interaction.user;

    const dbUser = await getUser(user.id);
    const nextXp = xpForLevel(dbUser.level + 1);
    const progress = dbUser.xp - xpForLevel(dbUser.level);
    const needed = nextXp - xpForLevel(dbUser.level);

    const embed = new EmbedBuilder()
      .setColor(0x7289da)
      .setTitle(`Rank — ${user.tag}`)
      .addFields(
        { name: "🏆 Level", value: dbUser.level.toString(), inline: true },
        {
          name: "✨ XP",
          value: `${progress.toLocaleString()} / ${needed.toLocaleString()}`,
          inline: true,
        },
        { name: "📊 Total XP", value: dbUser.totalXp.toLocaleString(), inline: true },
      );

    await interaction.reply({ embeds: [embed] });
  },
};
