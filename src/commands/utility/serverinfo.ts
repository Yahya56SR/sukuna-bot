import { SlashCommandBuilder, EmbedBuilder } from "discord.js";

export default {
  data: new SlashCommandBuilder()
    .setName("serverinfo")
    .setDescription("Get information about the server."),
  category: "Utility",
  execute: async (client: any, interaction: any) => {
    const guild = interaction.guild!;
    const embed = new EmbedBuilder()
      .setColor(0x7289da)
      .setTitle(guild.name)
      .setThumbnail(guild.iconURL() || undefined)
      .addFields(
        { name: "🆔 ID", value: guild.id, inline: true },
        { name: "👑 Owner", value: `<@${guild.ownerId}>`, inline: true },
        { name: "👥 Members", value: guild.memberCount.toString(), inline: true },
        { name: "💬 Channels", value: guild.channels.cache.size.toString(), inline: true },
        { name: "🏅 Roles", value: guild.roles.cache.size.toString(), inline: true },
        {
          name: "📅 Created",
          value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`,
          inline: true,
        }
      );

    await interaction.reply({ embeds: [embed] });
  },
};
