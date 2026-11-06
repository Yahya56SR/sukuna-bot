import { SlashCommandBuilder, AutocompleteInteraction, ChatInputCommandInteraction, EmbedBuilder, Colors, ChannelType, TextChannel, WebhookClient } from 'discord.js';
import { LogChannel, type LogEventType } from '../../db/models/LogChannel.js';
import { recordActivity } from '../../core/metrics.js';
import type { Command } from '../../core/commands.js';

const logEvents: { name: string; value: LogEventType; description: string }[] = [
  { name: 'Message Delete', value: 'messageDelete', description: 'When a message is deleted' },
  { name: 'Message Edit', value: 'messageEdit', description: 'When a message is edited' },
  { name: 'Bulk Message Delete', value: 'messageDeleteBulk', description: 'When multiple messages are deleted' },
  { name: 'Member Join', value: 'memberJoin', description: 'When a member joins' },
  { name: 'Member Leave', value: 'memberLeave', description: 'When a member leaves' },
  { name: 'Member Ban', value: 'memberBanAdd', description: 'When a member is banned' },
  { name: 'Member Unban', value: 'memberBanRemove', description: 'When a member is unbanned' },
  { name: 'Member Update', value: 'memberUpdate', description: 'When member updates (nickname, roles, etc.)' },
  { name: 'Role Create', value: 'roleCreate', description: 'When a role is created' },
  { name: 'Role Delete', value: 'roleDelete', description: 'When a role is deleted' },
  { name: 'Role Update', value: 'roleUpdate', description: 'When a role is updated' },
  { name: 'Channel Create', value: 'channelCreate', description: 'When a channel is created' },
  { name: 'Channel Delete', value: 'channelDelete', description: 'When a channel is deleted' },
  { name: 'Channel Update', value: 'channelUpdate', description: 'When a channel is updated' },
  { name: 'Voice State Update', value: 'voiceStateUpdate', description: 'Voice channel join/leave/move' },
  { name: 'Invite Create', value: 'inviteCreate', description: 'When an invite is created' },
  { name: 'Invite Delete', value: 'inviteDelete', description: 'When an invite is deleted' },
  { name: 'Guild Update', value: 'guildUpdate', description: 'When server settings change' },
  { name: 'Emoji Create', value: 'emojiCreate', description: 'When an emoji is added' },
  { name: 'Emoji Delete', value: 'emojiDelete', description: 'When an emoji is removed' },
  { name: 'Emoji Update', value: 'emojiUpdate', description: 'When an emoji is updated' },
  { name: 'Thread Create', value: 'threadCreate', description: 'When a thread is created' },
  { name: 'Thread Delete', value: 'threadDelete', description: 'When a thread is deleted' },
  { name: 'Thread Update', value: 'threadUpdate', description: 'When a thread is updated' },
  { name: 'Warn', value: 'moderationWarn', description: 'When a user is warned' },
];

export const logsCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('logs')
    .setDescription('Configure logging channels')
    .addSubcommand(sub => sub
      .setName('set')
      .setDescription('Set a log channel for an event')
      .addStringOption(opt => opt
        .setName('event')
        .setDescription('Event to log')
        .setRequired(true)
        .setAutocomplete(true)
      )
      .addChannelOption(opt => opt
        .setName('channel')
        .setDescription('Channel to log to')
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      )
      .addBooleanOption(opt => opt
        .setName('include_content')
        .setDescription('Include message content in logs')
        .setRequired(false)
      )
      .addBooleanOption(opt => opt
        .setName('log_bots')
        .setDescription('Log bot messages/actions')
        .setRequired(false)
      )
    )
    .addSubcommand(sub => sub
      .setName('remove')
      .setDescription('Remove a log channel')
      .addStringOption(opt => opt
        .setName('event')
        .setDescription('Event to stop logging')
        .setRequired(true)
        .setAutocomplete(true)
      )
    )
    .addSubcommand(sub => sub
      .setName('list')
      .setDescription('List all configured log channels')
    )
    .addSubcommand(sub => sub
      .setName('ignore')
      .setDescription('Ignore channels/roles from logging')
      .addStringOption(opt => opt
        .setName('event')
        .setDescription('Event to configure ignores for')
        .setRequired(true)
        .setAutocomplete(true)
      )
      .addChannelOption(opt => opt
        .setName('channel')
        .setDescription('Channel to ignore')
        .setRequired(false)
      )
      .addRoleOption(opt => opt
        .setName('role')
        .setDescription('Role to ignore (users with this role)')
        .setRequired(false)
      )
      .addBooleanOption(opt => opt
        .setName('remove')
        .setDescription('Remove from ignore list')
        .setRequired(false)
      )
    )
    .addSubcommand(sub => sub
      .setName('test')
      .setDescription('Send a test log message')
      .addStringOption(opt => opt
        .setName('event')
        .setDescription('Event to test')
        .setRequired(true)
        .setAutocomplete(true)
      )
    ),

  category: 'moderation',
  cooldownSeconds: 5,
  userPermissions: ['ManageGuild'],
  botPermissions: ['SendMessages', 'EmbedLinks', 'ManageWebhooks'],

  async autocomplete(interaction: AutocompleteInteraction) {
    const focused = interaction.options.getFocused(true);
    if (focused.name === 'event') {
      await interaction.respond(
        logEvents
          .filter(e => e.name.toLowerCase().includes(focused.value.toLowerCase()) || e.value.toLowerCase().includes(focused.value.toLowerCase()))
          .slice(0, 25)
          .map(e => ({ name: e.name, value: e.value }))
      );
    }
  },

  async execute(context) {
    const { interaction, guild } = context;
    const guildId = guild.id;
    const sub = interaction.options.getSubcommand();

    if (sub === 'set') {
      const event = interaction.options.getString('event', true) as LogEventType;
      const channel = interaction.options.getChannel('channel', true) as TextChannel;
      const includeContent = interaction.options.getBoolean('include_content') ?? true;
      const logBots = interaction.options.getBoolean('log_bots') ?? false;

      // Create webhook for better formatting
      let webhookId: string | undefined;
      let webhookToken: string | undefined;
      try {
        const webhook = await channel.createWebhook({
          name: '愛 Bella Star Logs',
          avatar: interaction.client.user.displayAvatarURL(),
          reason: 'Auto-mod logging webhook',
        });
        webhookId = webhook.id;
        webhookToken = webhook.token ?? undefined;
      } catch (error) {
        console.warn('[Logs] Could not create webhook:', error);
      }

      await LogChannel.findOneAndUpdate(
        { guildId, event },
        {
          guildId,
          event,
          channelId: channel.id,
          includeContent,
          logBots,
          webhookId,
          webhookToken,
        },
        { upsert: true, new: true }
      );

      const embed = new EmbedBuilder()
        .setColor(Colors.Green)
        .setTitle('✅ Log Channel Set')
        .addFields(
          { name: 'Event', value: event, inline: true },
          { name: 'Channel', value: `<#${channel.id}>`, inline: true },
          { name: 'Include Content', value: includeContent ? 'Yes' : 'No', inline: true },
          { name: 'Log Bots', value: logBots ? 'Yes' : 'No', inline: true },
        );

      await interaction.reply({ embeds: [embed] });
      recordActivity('command', 'Log channel set', { meta: { guildId, event, channelId: channel.id } });
      return;
    }

    if (sub === 'remove') {
      const event = interaction.options.getString('event', true) as LogEventType;

      const config = await LogChannel.findOneAndDelete({ guildId, event });
      if (!config) {
        await interaction.reply({ content: 'No log channel configured for this event', ephemeral: true });
        return;
      }

      // Delete webhook if exists
      if (config.webhookId && config.webhookToken) {
        try {
          const webhookClient = new WebhookClient({ id: config.webhookId, token: config.webhookToken });
          await webhookClient.delete();
        } catch {}
      }

      await interaction.reply({ content: `✅ Removed log channel for **${event}**`, ephemeral: true });
      return;
    }

    if (sub === 'list') {
      const configs = await LogChannel.find({ guildId }).lean();
      if (!configs.length) {
        await interaction.reply({ content: 'No log channels configured', ephemeral: true });
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(Colors.Blurple)
        .setTitle('📋 Log Channels')
        .setDescription(configs.map(c => {
          const ch = guild.channels.cache.get(c.channelId);
          const chName = ch ? `<#${c.channelId}>` : `#deleted-channel`;
          return `**${c.event}** → ${chName} ${c.includeContent ? '📝' : ''} ${c.logBots ? '🤖' : ''}`;
        }).join('\n'))
        .setFooter({ text: `${configs.length} event(s) configured` });

      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    if (sub === 'ignore') {
      const event = interaction.options.getString('event', true) as LogEventType;
      const channel = interaction.options.getChannel('channel');
      const role = interaction.options.getRole('role');
      const remove = interaction.options.getBoolean('remove') ?? false;

      if (!channel && !role) {
        await interaction.reply({ content: 'Specify a channel or role', ephemeral: true });
        return;
      }

      const config = await LogChannel.findOne({ guildId, event });
      if (!config) {
        await interaction.reply({ content: 'No log channel configured for this event', ephemeral: true });
        return;
      }

      if (channel) {
        if (remove) {
          config.ignoredChannels = config.ignoredChannels.filter(c => c !== channel.id);
        } else {
          if (!config.ignoredChannels.includes(channel.id)) {
            config.ignoredChannels.push(channel.id);
          }
        }
      }

      if (role) {
        if (remove) {
          config.ignoredRoles = config.ignoredRoles.filter(r => r !== role.id);
        } else {
          if (!config.ignoredRoles.includes(role.id)) {
            config.ignoredRoles.push(role.id);
          }
        }
      }

      await config.save();

      await interaction.reply({ content: `✅ ${remove ? 'Removed' : 'Added'} ignore for ${channel ? `<#${channel.id}>` : `<@&${role?.id}>`} on **${event}**`, ephemeral: true });
      return;
    }

    if (sub === 'test') {
      const event = interaction.options.getString('event', true) as LogEventType;

      const config = await LogChannel.findOne({ guildId, event });
      if (!config) {
        await interaction.reply({ content: 'No log channel configured for this event', ephemeral: true });
        return;
      }

      const logChannel = guild.channels.cache.get(config.channelId) as TextChannel;
      if (!logChannel) {
        await interaction.reply({ content: 'Log channel not found', ephemeral: true });
        return;
      }

      const testEmbed = new EmbedBuilder()
        .setColor(Colors.Blurple)
        .setTitle('🧪 Test Log')
        .setDescription(`This is a test log for **${event}**`)
        .addFields(
          { name: 'Triggered by', value: interaction.user.tag, inline: true },
          { name: 'Channel', value: `<#${interaction.channelId}>`, inline: true },
        )
        .setTimestamp();

      try {
        if (config.webhookId && config.webhookToken) {
          const webhookClient = new WebhookClient({ id: config.webhookId, token: config.webhookToken });
          await webhookClient.send({ embeds: [testEmbed] });
        } else {
          await logChannel.send({ embeds: [testEmbed] });
        }
        await interaction.reply({ content: '✅ Test log sent', ephemeral: true });
      } catch (error) {
        await interaction.reply({ content: `❌ Failed to send test log: ${error}`, ephemeral: true });
      }
      return;
    }
  },
};