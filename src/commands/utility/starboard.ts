import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, Colors, Message, TextChannel } from 'discord.js';
import { StarboardConfig, StarboardEntry } from '../../db/models/Starboard.js';
import { recordActivity } from '../../core/metrics.js';
import type { Command } from '../../core/commands.js';

export const starboardCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('starboard')
    .setDescription('Starboard system')
    .addSubcommand(sub => sub
      .setName('set')
      .setDescription('Configure starboard')
      .addChannelOption(opt => opt
        .setName('channel')
        .setDescription('Channel to post starred messages')
        .setRequired(true)
      )
      .addIntegerOption(opt => opt
        .setName('threshold')
        .setDescription('Minimum stars required (default: 5)')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(1000)
      )
      .addStringOption(opt => opt
        .setName('emoji')
        .setDescription('Emoji to use for starring (default: ⭐)')
        .setRequired(false)
      )
    )
    .addSubcommand(sub => sub
      .setName('remove')
      .setDescription('Disable starboard')
    )
    .addSubcommand(sub => sub
      .setName('config')
      .setDescription('View/configure starboard settings')
      .addBooleanOption(opt => opt
        .setName('allow_self_star')
        .setDescription('Allow users to star their own messages')
        .setRequired(false)
      )
      .addBooleanOption(opt => opt
        .setName('allow_bot_messages')
        .setDescription('Allow starring bot messages')
        .setRequired(false)
      )
      .addBooleanOption(opt => opt
        .setName('require_attachment')
        .setDescription('Only star messages with attachments')
        .setRequired(false)
      )
      .addBooleanOption(opt => opt
        .setName('require_embed')
        .setDescription('Only star messages with embeds')
        .setRequired(false)
      )
      .addChannelOption(opt => opt
        .setName('ignore_channel')
        .setDescription('Channel to ignore')
        .setRequired(false)
      )
      .addRoleOption(opt => opt
        .setName('ignore_role')
        .setDescription('Role to ignore (users with this role)')
        .setRequired(false)
      )
      .addBooleanOption(opt => opt
        .setName('remove_ignore')
        .setDescription('Remove from ignore list')
        .setRequired(false)
      )
      .addIntegerOption(opt => opt
        .setName('max_age_days')
        .setDescription('Max age of message to star (0 = no limit)')
        .setRequired(false)
        .setMinValue(0)
        .setMaxValue(365)
      )
      .addBooleanOption(opt => opt
        .setName('allow_multiple')
        .setDescription('Allow multiple starboard entries per message at different thresholds')
        .setRequired(false)
      )
    )
    .addSubcommand(sub => sub
      .setName('list')
      .setDescription('Show recently starred messages')
      .addIntegerOption(opt => opt
        .setName('limit')
        .setDescription('Number to show')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(50)
      )
    )
    .addSubcommand(sub => sub
      .setName('leaderboard')
      .setDescription('Show top starred users')
      .addIntegerOption(opt => opt
        .setName('limit')
        .setDescription('Number to show')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(50)
      )
    ),

  category: 'utility',
  cooldownSeconds: 5,
  userPermissions: ['ManageGuild'],
  botPermissions: ['SendMessages', 'EmbedLinks', 'AddReactions', 'ReadMessageHistory'],

  async execute(context) {
    const { interaction, guild } = context;
    const guildId = guild.id;
    const sub = interaction.options.getSubcommand();

    if (sub === 'set') {
      const channel = interaction.options.getChannel('channel', true) as TextChannel;
      const threshold = interaction.options.getInteger('threshold') ?? 5;
      const emoji = interaction.options.getString('emoji') ?? '⭐';

      await StarboardConfig.findOneAndUpdate(
        { guildId },
        {
          guildId,
          channelId: channel.id,
          threshold,
          emoji,
          enabled: true,
        },
        { upsert: true, new: true }
      );

      const embed = new EmbedBuilder()
        .setColor(Colors.Gold)
        .setTitle('✅ Starboard Configured')
        .addFields(
          { name: 'Channel', value: `<#${channel.id}>`, inline: true },
          { name: 'Threshold', value: threshold.toString(), inline: true },
          { name: 'Emoji', value: emoji, inline: true },
        );

      await interaction.reply({ embeds: [embed] });
      return;
    }

    if (sub === 'remove') {
      const config = await StarboardConfig.findOneAndUpdate({ guildId }, { enabled: false });
      if (!config) {
        await interaction.reply({ content: 'Starboard not configured', ephemeral: true });
        return;
      }

      await interaction.reply({ content: '✅ Starboard disabled', ephemeral: true });
      return;
    }

    if (sub === 'config') {
      const config = await StarboardConfig.findOne({ guildId });
      if (!config) {
        await interaction.reply({ content: 'Starboard not configured. Use /starboard set first', ephemeral: true });
        return;
      }

      const allowSelfStar = interaction.options.getBoolean('allow_self_star');
      const allowBotMessages = interaction.options.getBoolean('allow_bot_messages');
      const requireAttachment = interaction.options.getBoolean('require_attachment');
      const requireEmbed = interaction.options.getBoolean('require_embed');
      const ignoreChannel = interaction.options.getChannel('ignore_channel');
      const ignoreRole = interaction.options.getRole('ignore_role');
      const removeIgnore = interaction.options.getBoolean('remove_ignore') ?? false;
      const maxAgeDays = interaction.options.getInteger('max_age_days');
      const allowMultiple = interaction.options.getBoolean('allow_multiple');

      if (allowSelfStar !== null) config.allowSelfStar = allowSelfStar;
      if (allowBotMessages !== null) config.allowBotMessages = allowBotMessages;
      if (requireAttachment !== null) config.requireAttachment = requireAttachment;
      if (requireEmbed !== null) config.requireEmbed = requireEmbed;
      if (maxAgeDays !== null) config.maxAgeDays = maxAgeDays;
      if (allowMultiple !== null) config.allowMultiple = allowMultiple;

      if (ignoreChannel) {
        if (removeIgnore) {
          config.ignoredChannels = config.ignoredChannels.filter(c => c !== ignoreChannel.id);
        } else {
          if (!config.ignoredChannels.includes(ignoreChannel.id)) config.ignoredChannels.push(ignoreChannel.id);
        }
      }

      if (ignoreRole) {
        if (removeIgnore) {
          config.ignoredRoles = config.ignoredRoles.filter(r => r !== ignoreRole.id);
        } else {
          if (!config.ignoredRoles.includes(ignoreRole.id)) config.ignoredRoles.push(ignoreRole.id);
        }
      }

      await config.save();

      const embed = new EmbedBuilder()
        .setColor(Colors.Gold)
        .setTitle('⚙️ Starboard Settings Updated')
        .addFields(
          { name: 'Self-Star', value: config.allowSelfStar ? '✅' : '❌', inline: true },
          { name: 'Bot Messages', value: config.allowBotMessages ? '✅' : '❌', inline: true },
          { name: 'Require Attachment', value: config.requireAttachment ? '✅' : '❌', inline: true },
          { name: 'Require Embed', value: config.requireEmbed ? '✅' : '❌', inline: true },
          { name: 'Max Age', value: config.maxAgeDays ? `${config.maxAgeDays}d` : 'None', inline: true },
          { name: 'Multiple Entries', value: config.allowMultiple ? '✅' : '❌', inline: true },
          { name: 'Ignored Channels', value: config.ignoredChannels.map(c => `<#${c}>`).join(', ') || 'None', inline: false },
          { name: 'Ignored Roles', value: config.ignoredRoles.map(r => `<@&${r}>`).join(', ') || 'None', inline: false },
        );

      await interaction.reply({ embeds: [embed] });
      return;
    }

    if (sub === 'list') {
      const limit = interaction.options.getInteger('limit') ?? 10;

      const entries = await StarboardEntry.find({ guildId })
        .sort({ stars: -1, createdAt: -1 })
        .limit(limit)
        .lean();

      if (!entries.length) {
        await interaction.reply({ content: 'No starred messages yet', ephemeral: true });
        return;
      }

      const config = await StarboardConfig.findOne({ guildId });
      const emoji = config?.emoji || '⭐';

      const embed = new EmbedBuilder()
        .setColor(Colors.Gold)
        .setTitle('⭐ Recent Starboard Entries')
        .setDescription(
          entries.map((e, i) => {
            const author = guild.members.cache.get(e.authorId);
            const name = author ? author.user.tag : `Unknown (${e.authorId})`;
            return `**${i + 1}.** ${e.stars} ${emoji} — ${name} — [Jump](${getJumpUrl(guildId, e.channelId, e.messageId)})`;
          }).join('\n')
        )
        .setFooter({ text: `Top ${limit} starred messages` });

      await interaction.reply({ embeds: [embed] });
      return;
    }

    if (sub === 'leaderboard') {
      const limit = interaction.options.getInteger('limit') ?? 10;

      const entries = await StarboardEntry.aggregate([
        { $match: { guildId } },
        { $group: { _id: '$authorId', totalStars: { $sum: '$stars' }, messages: { $sum: 1 } } },
        { $sort: { totalStars: -1 } },
        { $limit: limit },
      ]);

      if (!entries.length) {
        await interaction.reply({ content: 'No star data yet', ephemeral: true });
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(Colors.Gold)
        .setTitle('🏆 Star Leaderboard')
        .setDescription(
          entries.map((e, i) => {
            const user = guild.members.cache.get(e._id);
            const name = user ? user.user.tag : `Unknown (${e._id})`;
            return `**${i + 1}.** ${name} — **${e.totalStars}** ⭐ (${e.messages} messages)`;
          }).join('\n')
        )
        .setFooter({ text: `Top ${limit} starred users` });

      await interaction.reply({ embeds: [embed] });
      return;
    }
  },
};

// Starboard event handler
let configCache: Map<string, any> = new Map();

export async function handleStarboardReaction(reaction: any, user: any, added: boolean): Promise<void> {
  if (reaction.partial) {
    try {
      await reaction.fetch();
    } catch {
      return;
    }
  }

  const message = reaction.message;
  if (!message.guildId) return;

  const guildId = message.guildId;
  let config = configCache.get(guildId);

  if (!config) {
    config = await StarboardConfig.findOne({ guildId, enabled: true }).lean();
    if (!config) return;
    configCache.set(guildId, config);
  }

  // These gates must run after the config is loaded — reading the cache before
  // the load above meant the flags were always `undefined` on a cold cache.
  if (message.author.bot && !config.allowBotMessages) return;
  if (message.author.id === user.id && !config.allowSelfStar) return;

  // Check ignored channels/roles
  if (config.ignoredChannels.includes(message.channelId)) return;
  if (message.member && config.ignoredRoles.some((r: string) => message.member.roles.cache.has(r))) return;

  // Check emoji
  const reactionEmoji = reaction.emoji.name || reaction.emoji.toString();
  if (reactionEmoji !== config.emoji) return;

  // Check attachment/embed requirements
  if (config.requireAttachment && message.attachments.size === 0) return;
  if (config.requireEmbed && message.embeds.length === 0) return;

  // Check max age
  if (config.maxAgeDays > 0) {
    const ageDays = (Date.now() - message.createdTimestamp) / (1000 * 60 * 60 * 24);
    if (ageDays > config.maxAgeDays) return;
  }

  const starCount = reaction.count || 0;

  if (added && starCount >= config.threshold) {
    // Check if already starred
    let entry = await StarboardEntry.findOne({ guildId, messageId: message.id });
    if (entry && !config.allowMultiple) {
      // Update existing
      entry.stars = starCount;
      entry.starredBy = [...new Set([...entry.starredBy, user.id])];
      await entry.save();
      await updateStarboardMessage(guildId, config, entry, message);
    } else if (!entry || config.allowMultiple) {
      // Create new entry
      const g = reaction.client.guilds.cache.get(guildId);
      if (!g) return;
      const starChannel = g.channels.cache.get(config.channelId) as any;
      if (!starChannel) return;

      const starEmbed = buildStarboardEmbed(message, starCount, config);
      const starMessage = await starChannel.send({ embeds: [starEmbed] });

      entry = await StarboardEntry.create({
        guildId,
        messageId: message.id,
        starboardMessageId: starMessage.id,
        channelId: message.channelId,
        authorId: message.author.id,
        stars: starCount,
        starredBy: [user.id],
      });
    }
  } else if (!added && starCount < config.threshold) {
    // Remove starboard entry if below threshold
    const entry = await StarboardEntry.findOne({ guildId, messageId: message.id });
    if (entry) {
      await entry.deleteOne();
      try {
        const g = reaction.client.guilds.cache.get(guildId);
        if (g) {
          const starChannel = g.channels.cache.get(config.channelId) as any;
          if (starChannel) {
            const starMsg = await starChannel.messages.fetch(entry.starboardMessageId);
            await starMsg.delete();
          }
        }
      } catch {}
    }
  }
}

function buildStarboardEmbed(message: Message, stars: number, config: any): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(config.color || Colors.Gold)
    .setAuthor({ name: message.author.tag, iconURL: message.author.displayAvatarURL() })
    .setDescription(message.content || '*No text content*')
    .addFields(
      { name: 'Channel', value: `<#${message.channelId}>`, inline: true },
      { name: 'Stars', value: `${stars} ${config.emoji}`, inline: true },
    )
    .setTimestamp(message.createdAt)
    .setFooter({ text: `ID: ${message.id}` });

  if (config.includeJumpLink) {
    embed.addFields({ name: 'Jump', value: `[Go to message](${getJumpUrl(message.guildId!, message.channelId, message.id)})`, inline: true });
  }

  // Add first attachment as image
  const firstAttachment = message.attachments.first();
  if (firstAttachment && firstAttachment.contentType?.startsWith('image/')) {
    embed.setImage(firstAttachment.url);
  }

  // Add embeds from original message
  if (message.embeds.length > 0) {
    const firstEmbed = message.embeds[0];
    if (firstEmbed.image?.url) embed.setImage(firstEmbed.image.url);
    if (firstEmbed.thumbnail?.url) embed.setThumbnail(firstEmbed.thumbnail.url);
  }

  return embed;
}

async function updateStarboardMessage(guildId: string, config: any, entry: any, message: Message): Promise<void> {
  try {
    const g = entry.client.guilds.cache.get(guildId);
    if (!g) return;
    const starChannel = g.channels.cache.get(config.channelId) as any;
    if (!starChannel) return;

    const starMessage = await starChannel.messages.fetch(entry.starboardMessageId);
    const newEmbed = buildStarboardEmbed(message, entry.stars, config);
    await starMessage.edit({ embeds: [newEmbed] });
  } catch {}
}

function getJumpUrl(guildId: string, channelId: string, messageId: string): string {
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}

// Invalidate cache when config changes. Omit the guild id to drop everything
// (used at startup and by the dashboard, which may edit any guild).
export function invalidateStarboardCache(guildId?: string): void {
  if (guildId) configCache.delete(guildId);
  else configCache.clear();
}