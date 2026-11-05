import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  type Guild,
} from 'discord.js';
import type { Command } from '../../core/commands.js';
import { updateGuildConfig } from '../../db/models/Guild.js';
import { isOwner } from '../../core/owner.js';

export const setupCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription(
      'Owner-only: configure the bot for this server (XP, modules, level-up channel, etc.).',
    )
    .setDMPermission(false)
    .addBooleanOption((option) =>
      option
        .setName('xp_enabled')
        .setDescription('Enable or disable XP earning in this server'),
    )
    .addIntegerOption((option) =>
      option
        .setName('xp_cooldown')
        .setDescription('Seconds between XP-earning messages per user (0-3600)')
        .setMinValue(0)
        .setMaxValue(3600),
    )
    .addIntegerOption((option) =>
      option
        .setName('xp_min')
        .setDescription('Minimum XP per message (0-10000)')
        .setMinValue(0)
        .setMaxValue(10000),
    )
    .addIntegerOption((option) =>
      option
        .setName('xp_max')
        .setDescription('Maximum XP per message (0-10000)')
        .setMinValue(0)
        .setMaxValue(10000),
    )
    .addChannelOption((option) =>
      option
        .setName('levelup_channel')
        .setDescription('Channel for level-up announcements')
        .addChannelTypes(0),
    )
    .addStringOption((option) =>
      option
        .setName('levelup_message')
        .setDescription('Level-up message template')
        .setMaxLength(2000),
    ),
  category: 'moderation',
  userPermissions: ['ManageGuild'],
  execute: async (context) => {
    const { interaction, guild } = context;

    // Owner-only check
    if (!isOwner(interaction.user.id)) {
      await interaction.reply({
        content: '❌ This command is owner-only.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!guild) {
      await interaction.reply({
        content: '❌ Server-only command.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const updates: Record<string, unknown> = {};

    const xpEnabled = interaction.options.getBoolean('xp_enabled');
    const xpCooldown = interaction.options.getInteger('xp_cooldown');
    const xpMin = interaction.options.getInteger('xp_min');
    const xpMax = interaction.options.getInteger('xp_max');
    const levelupChannel = interaction.options.getChannel('levelup_channel');
    const levelupMessage = interaction.options.getString('levelup_message');

    if (xpEnabled !== null) updates.xpEnabled = xpEnabled;
    if (xpCooldown !== null) updates.xpCooldown = xpCooldown;
    if (xpMin !== null) updates.xpMin = xpMin;
    if (xpMax !== null) updates.xpMax = xpMax;
    if (levelupChannel?.isTextBased()) updates.levelUpChannel = levelupChannel.id;
    if (levelupMessage) updates.levelUpMessage = levelupMessage;

    if (Object.keys(updates).length === 0) {
      await interaction.reply({
        content: '❌ No changes provided. Pass at least one option.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await updateGuildConfig(guild.id, updates);

    const embed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle('✅ Server configured')
      .setDescription(
        Object.entries(updates)
          .map(([key, value]) => `• **${key}**: \`${value}\``)
          .join('\n'),
      )
      .setFooter({ text: '爱 Doctora • Setup' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
};
