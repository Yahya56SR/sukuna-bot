import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
import type { Command } from '../../core/commands.js';

export const servercardCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('servercard')
    .setDescription('View a server card with enhanced decorations.')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages),
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

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('🏰 Server Card')
      .setDescription(`**${guild.name}**`)
      .addFields(
        { name: 'Owner', value: `<@${guild.ownerId}>`, inline: true },
        { name: 'Members', value: guild.memberCount.toLocaleString(), inline: true },
        { name: 'Text Channels', value: guild.channels.cache.filter((c) => c.isTextBased()).size.toString(), inline: true },
        { name: 'Voice Channels', value: guild.channels.cache.filter((c) => c.isVoiceBased()).size.toString(), inline: true },
        { name: 'Boost Tier', value: guild.premiumTier ? `${guild.premiumTier} (${guild.premiumSubscriptionCount} boosts)` : 'None', inline: true },
      )
      .setThumbnail(guild.iconURL({ size: 256 }) ?? null)
      .setFooter({ text: '爱 Doctora • Server Card' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
};