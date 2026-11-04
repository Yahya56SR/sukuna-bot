import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  type Guild,
  ChannelType,
} from 'discord.js';
import type { Command } from '../../core/commands.js';

export const serverinfoEnhancedCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('serverinfo')
    .setDescription('View enhanced server information with decorations.')
    .setDMPermission(false),
  category: 'utility',
  execute: async (context) => {
    const { interaction } = context;
    const guild = interaction.guild;

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

    // Get boost info
    const boostTier = guild.premiumTier;
    const boostCount = guild.premiumSubscriptionCount ?? 0;

    // Calculate created at timestamp
    const createdTimestamp = Math.floor(guild.createdTimestamp / 1000);

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setAuthor({ name: guild.name, iconURL: guild.iconURL() ?? undefined })
      .setThumbnail(guild.iconURL({ size: 256 }) ?? null)
      .addFields(
        { name: '🏷️ Name', value: guild.name, inline: true },
        { name: '🆔 ID', value: guild.id, inline: true },
        { name: '👑 Owner', value: `<@${guild.ownerId}>`, inline: true },
        { name: '👥 Members', value: guild.memberCount.toLocaleString(), inline: true },
        { name: '💬 Text Channels', value: textChannels.toString(), inline: true },
        { name: '🔊 Voice Channels', value: voiceChannels.toString(), inline: true },
        { name: '📁 Categories', value: categoryChannels.toString(), inline: true },
        { name: '🎭 Roles', value: guild.roles.cache.size.toString(), inline: true },
        { name: '✨ Boosts', value: `${boostCount} boost${boostCount !== 1 ? 's' : ''}`, inline: true },
        { name: '🌟 Boost Tier', value: boostTier ? `Tier ${boostTier}` : 'None', inline: true },
        { name: '📅 Created', value: `<t:${createdTimestamp}:R>`, inline: true },
        { name: '🛡️ Verification', value: String(guild.verificationLevel), inline: true },
      )
      .setFooter({ text: '爱 Doctora • Server Info' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
};