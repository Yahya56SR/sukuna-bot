import { SlashCommandBuilder, EmbedBuilder } from "discord.js";

export default {
  data: new SlashCommandBuilder()
    .setName("userinfo")
    .setDescription("Get information about a user.")
    .addUserOption((option) =>
      option.setName("user").setDescription("The user to look up").setRequired(false)
    ),
  category: "Utility",
  execute: async (client: any, interaction: any) => {
    const user = interaction.options.getUser("user") || interaction.user;
    const member = interaction.guild?.members.cache.get(user.id);

    const embed = new EmbedBuilder()
      .setColor(0x7289da)
      .setAuthor({ name: user.tag, iconURL: user.displayAvatarURL() })
      .setThumbnail(user.displayAvatarURL({ size: 1024 }))
      .addFields(
        { name: "🆔 ID", value: user.id, inline: true },
        { name: "🤖 Bot", value: user.bot ? "Yes" : "No", inline: true },
        {
          name: "📅 Account Created",
          value: `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`,
          inline: true,
        }
      );

    if (member) {
      embed.addFields(
        { name: "📥 Joined Server", value: `<t:${Math.floor(member.joinedTimestamp! / 1000)}:R>`, inline: true },
        {
          name: "🏅 Roles",
          value:
            member.roles.cache
              .filter((r: any) => r.id !== interaction.guild!.id)
              .map((r: any) => r.toString())
              .join(", ") || "None",
          inline: false,
        }
      );
    }

    await interaction.reply({ embeds: [embed] });
  },
};
