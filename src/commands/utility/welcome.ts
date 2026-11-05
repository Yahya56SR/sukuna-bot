import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, Colors, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';
import { WelcomeConfig } from '../../db/models/WelcomeConfig.js';
import { recordActivity } from '../../core/metrics.js';
import type { Command } from '../../core/commands.js';

export const welcomeCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('welcome')
    .setDescription('Welcome and greetings system')
    .addSubcommand(sub => sub
      .setName('set')
      .setDescription('Set welcome channel and message')
      .addChannelOption(opt => opt
        .setName('channel')
        .setDescription('Welcome channel')
        .setRequired(true)
      )
      .addStringOption(opt => opt
        .setName('message')
        .setDescription('Welcome message (supports {user}, {server}, {memberCount})')
        .setRequired(false)
        .setMaxLength(2000)
      )
    )
    .addSubcommand(sub => sub
      .setName('dm')
      .setDescription('Set welcome DM message')
      .addStringOption(opt => opt
        .setName('message')
        .setDescription('DM welcome message')
        .setRequired(true)
        .setMaxLength(2000)
      )
    )
    .addSubcommand(sub => sub
      .setName('leave')
      .setDescription('Set leave channel and message')
      .addChannelOption(opt => opt
        .setName('channel')
        .setDescription('Leave channel')
        .setRequired(true)
      )
      .addStringOption(opt => opt
        .setName('message')
        .setDescription('Leave message')
        .setRequired(false)
        .setMaxLength(2000)
      )
    )
    .addSubcommand(sub => sub
      .setName('autorole')
      .setDescription('Set auto-role on join')
      .addRoleOption(opt => opt
        .setName('role')
        .setDescription('Role to assign on join')
        .setRequired(true)
      )
    )
    .addSubcommand(sub => sub
      .setName('botrole')
      .setDescription('Set auto-role for bots on join')
      .addRoleOption(opt => opt
        .setName('role')
        .setDescription('Role to assign to bots on join')
        .setRequired(true)
      )
    )
    .addSubcommand(sub => sub
      .setName('test')
      .setDescription('Test welcome message')
    )
    .addSubcommand(sub => sub
      .setName('disable')
      .setDescription('Disable welcome system')
    ),

  category: 'utility',
  cooldownSeconds: 5,
  userPermissions: ['ManageGuild'],
  botPermissions: ['SendMessages', 'EmbedLinks', 'ManageRoles'],

  async execute(context) {
    const { interaction, guild } = context;
    const guildId = guild.id;
    const sub = interaction.options.getSubcommand();

    if (sub === 'set') {
      const channel = interaction.options.getChannel('channel', true) as any;
      const message = interaction.options.getString('message');

      await WelcomeConfig.findOneAndUpdate(
        { guildId },
        {
          guildId,
          welcomeChannelId: channel.id,
          welcomeMessage: message,
        },
        { upsert: true, new: true }
      );

      const embed = new EmbedBuilder()
        .setColor(Colors.Green)
        .setTitle('✅ Welcome System Configured')
        .addFields(
          { name: 'Channel', value: `<#${channel.id}>`, inline: true },
          { name: 'Message', value: message || 'Default welcome embed', inline: true },
        );

      await interaction.reply({ embeds: [embed] });
      recordActivity('command', 'Welcome system set', { meta: { guildId, channelId: channel.id } });
      return;
    }

    if (sub === 'dm') {
      const message = interaction.options.getString('message', true);

      await WelcomeConfig.findOneAndUpdate(
        { guildId },
        { guildId, dmMessage: message },
        { upsert: true, new: true }
      );

      await interaction.reply({ content: '✅ Welcome DM message set.', ephemeral: true });
      return;
    }

    if (sub === 'leave') {
      const channel = interaction.options.getChannel('channel', true) as any;
      const message = interaction.options.getString('message');

      await WelcomeConfig.findOneAndUpdate(
        { guildId },
        {
          guildId,
          leaveChannelId: channel.id,
          leaveMessage: message,
        },
        { upsert: true, new: true }
      );

      const embed = new EmbedBuilder()
        .setColor(Colors.Green)
        .setTitle('✅ Leave System Configured')
        .addFields(
          { name: 'Channel', value: `<#${channel.id}>`, inline: true },
          { name: 'Message', value: message || 'Default leave embed', inline: true },
        );

      await interaction.reply({ embeds: [embed] });
      return;
    }

    if (sub === 'autorole') {
      const role = interaction.options.getRole('role', true);

      await WelcomeConfig.findOneAndUpdate(
        { guildId },
        { guildId, autoRoleId: role.id },
        { upsert: true, new: true }
      );

      await interaction.reply({ content: `✅ Auto-role set to: **${role.name}**`, ephemeral: true });
      return;
    }

    if (sub === 'botrole') {
      const role = interaction.options.getRole('role', true);

      await WelcomeConfig.findOneAndUpdate(
        { guildId },
        { guildId, botAutoRoleId: role.id },
        { upsert: true, new: true }
      );

      await interaction.reply({ content: `✅ Bot auto-role set to: **${role.name}**`, ephemeral: true });
      return;
    }

    if (sub === 'test') {
      const config = await WelcomeConfig.findOne({ guildId });
      if (!config) {
        await interaction.reply({ content: 'Welcome system not configured. Use /welcome set first.', ephemeral: true });
        return;
      }

      const channel = guild.channels.cache.get(config.welcomeChannelId!) as any;
      if (!channel) {
        await interaction.reply({ content: 'Welcome channel not found.', ephemeral: true });
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(Colors.Blurple)
        .setTitle('👋 Welcome Test')
        .setDescription(`Welcome to **${guild.name}**, {user}!`)
        .setFooter({ text: 'Test welcome message' })
        .setTimestamp();

      const message = config.welcomeMessage?.replace('{user}', interaction.user.toString()).replace('{server}', guild.name).replace('{memberCount}', guild.memberCount.toString()) || '';

      await channel.send({ content: message || undefined, embeds: [embed] });
      await interaction.reply({ content: `✅ Test welcome sent to ${channel}.`, ephemeral: true });
      return;
    }

    if (sub === 'disable') {
      await WelcomeConfig.findOneAndDelete({ guildId });
      await interaction.reply({ content: '✅ Welcome system disabled.', ephemeral: true });
      return;
    }
  },
};