import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, Colors, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';
import { NotificationFeed } from '../../db/models/NotificationFeed.js';
import { recordActivity } from '../../core/metrics.js';
import type { Command } from '../../core/commands.js';

export const notificationsCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('notifications')
    .setDescription('Feed notifications system')
    .addSubcommand(sub => sub
      .setName('twitch')
      .setDescription('Twitch live stream alerts')
      .addChannelOption(opt => opt
        .setName('channel')
        .setDescription('Discord channel to post alerts')
        .setRequired(true)
      )
      .addStringOption(opt => opt
        .setName('twitch_channel')
        .setDescription('Twitch channel name')
        .setRequired(true)
      )
      .addRoleOption(opt => opt
        .setName('role')
        .setDescription('Role to ping on live')
        .setRequired(false)
      )
    )
    .addSubcommand(sub => sub
      .setName('youtube')
      .setDescription('YouTube upload alerts')
      .addChannelOption(opt => opt
        .setName('channel')
        .setDescription('Discord channel to post alerts')
        .setRequired(true)
      )
      .addStringOption(opt => opt
        .setName('youtube_channel')
        .setDescription('YouTube channel ID')
        .setRequired(true)
      )
      .addRoleOption(opt => opt
        .setName('role')
        .setDescription('Role to ping on upload')
        .setRequired(false)
      )
    )
    .addSubcommand(sub => sub
      .setName('reddit')
      .setDescription('Reddit subreddit feed')
      .addChannelOption(opt => opt
        .setName('channel')
        .setDescription('Discord channel to post alerts')
        .setRequired(true)
      )
      .addStringOption(opt => opt
        .setName('subreddit')
        .setDescription('Subreddit name')
        .setRequired(true)
      )
      .addStringOption(opt => opt
        .setName('sort')
        .setDescription('Sort type')
        .setRequired(false)
        .addChoices(
          { name: 'Hot', value: 'hot' },
          { name: 'New', value: 'new' },
          { name: 'Top', value: 'top' },
          { name: 'Rising', value: 'rising' },
        )
      )
    )
    .addSubcommand(sub => sub
      .setName('list')
      .setDescription('List all notification feeds')
    )
    .addSubcommand(sub => sub
      .setName('remove')
      .setDescription('Remove a notification feed')
      .addStringOption(opt => opt
        .setName('type')
        .setDescription('Feed type')
        .setRequired(true)
        .addChoices(
          { name: 'Twitch', value: 'twitch' },
          { name: 'YouTube', value: 'youtube' },
          { name: 'Reddit', value: 'reddit' },
        )
      )
      .addStringOption(opt => opt
        .setName('source')
        .setDescription('Source identifier')
        .setRequired(true)
      )
    ),

  category: 'utility',
  cooldownSeconds: 5,
  userPermissions: ['ManageGuild'],
  botPermissions: ['SendMessages', 'EmbedLinks'],

  async execute(context) {
    const { interaction, guild } = context;
    const guildId = guild.id;
    const sub = interaction.options.getSubcommand();

    if (sub === 'twitch') {
      const channel = interaction.options.getChannel('channel', true) as any;
      const twitchChannel = interaction.options.getString('twitch_channel', true);
      const role = interaction.options.getRole('role');

      await NotificationFeed.findOneAndUpdate(
        { guildId, type: 'twitch', source: twitchChannel },
        {
          guildId,
          type: 'twitch',
          channelId: channel.id,
          source: twitchChannel,
          roleId: role?.id,
          pingEveryone: false,
          active: true,
        },
        { upsert: true, new: true }
      );

      await interaction.reply({ content: `✅ Twitch alerts set for **${twitchChannel}** in <#${channel.id}>`, ephemeral: true });
      return;
    }

    if (sub === 'youtube') {
      const channel = interaction.options.getChannel('channel', true) as any;
      const youtubeChannel = interaction.options.getString('youtube_channel', true);
      const role = interaction.options.getRole('role');

      await NotificationFeed.findOneAndUpdate(
        { guildId, type: 'youtube', source: youtubeChannel },
        {
          guildId,
          type: 'youtube',
          channelId: channel.id,
          source: youtubeChannel,
          roleId: role?.id,
          pingEveryone: false,
          active: true,
        },
        { upsert: true, new: true }
      );

      await interaction.reply({ content: `✅ YouTube alerts set for **${youtubeChannel}** in <#${channel.id}>`, ephemeral: true });
      return;
    }

    if (sub === 'reddit') {
      const channel = interaction.options.getChannel('channel', true) as any;
      const subreddit = interaction.options.getString('subreddit', true);
      const sort = interaction.options.getString('sort') || 'hot';

      await NotificationFeed.findOneAndUpdate(
        { guildId, type: 'reddit', source: subreddit },
        {
          guildId,
          type: 'reddit',
          channelId: channel.id,
          source: subreddit,
          redditSort: sort as any,
          pingEveryone: false,
          active: true,
        },
        { upsert: true, new: true }
      );

      await interaction.reply({ content: `✅ Reddit feed set for **r/${subreddit}** in <#${channel.id}>`, ephemeral: true });
      return;
    }

    if (sub === 'list') {
      const feeds = await NotificationFeed.find({ guildId }).lean();
      if (!feeds.length) {
        await interaction.reply({ content: 'No notification feeds configured.', ephemeral: true });
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(Colors.Blurple)
        .setTitle('📢 Notification Feeds')
        .setDescription(
          feeds.map(f => `**${f.type}** — ${f.source} → <#${f.channelId}> ${f.active ? '🟢' : '🔴'}`).join('\n')
        )
        .setFooter({ text: `${feeds.length} feed(s)` });

      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    if (sub === 'remove') {
      const type = interaction.options.getString('type', true);
      const source = interaction.options.getString('source', true);

      const feed = await NotificationFeed.findOneAndDelete({ guildId, type: type as any, source });
      if (!feed) {
        await interaction.reply({ content: 'Feed not found.', ephemeral: true });
        return;
      }

      await interaction.reply({ content: `✅ Removed ${type} feed for **${source}**.`, ephemeral: true });
      return;
    }
  },
};