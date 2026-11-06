import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  type Guild,
  ChannelType,
} from 'discord.js';
import type { Command } from '../../core/commands.js';

export const serverinfoCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('serverinfo')
    .setDescription('View server information: member count, channels, roles, boosts, and more.')
    .setDMPermission(false),
  category: 'utility',
  cooldownSeconds: 5,
  execute: async (context) => {
    const { interaction, guild } = context;
    if (!guild) {
      await interaction.reply({
        content: '❌ This command can only be used in a server.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const textChannels = guild.channels.cache.filter((c) => c.isTextBased()).size;
    const voiceChannels = guild.channels.cache.filter((c) => c.isVoiceBased()).size;
    const categoryChannels = guild.channels.cache.filter(
      (c) => c.type === ChannelType.GuildCategory,
    ).size;

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setAuthor({ name: guild.name, iconURL: guild.iconURL() ?? undefined })
      .setThumbnail(guild.iconURL({ size: 256 }))
      .addFields(
        { name: 'Name', value: guild.name, inline: true },
        { name: 'ID', value: guild.id, inline: true },
        { name: 'Owner', value: `<@${guild.ownerId}>`, inline: true },
        { name: 'Members', value: guild.memberCount.toLocaleString(), inline: true },
        { name: 'Text Channels', value: textChannels.toString(), inline: true },
        { name: 'Voice Channels', value: voiceChannels.toString(), inline: true },
        { name: 'Categories', value: categoryChannels.toString(), inline: true },
        { name: 'Roles', value: guild.roles.cache.size.toString(), inline: true },
        { name: 'Boosts', value: (guild.premiumSubscriptionCount ?? 0).toString(), inline: true },
        { name: 'Boost Tier', value: String(guild.premiumTier), inline: true },
        {
          name: 'Created',
          value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`,
          inline: true,
        },
        { name: 'Verification Level', value: String(guild.verificationLevel), inline: true },
      )
      .setFooter({ text: '愛 Bella Star • Server Info' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
};
