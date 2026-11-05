import { AutoModRule, type IAutoModRule } from '../db/models/AutoModRule.js';
import { Infraction, type IInfraction } from '../db/models/Infraction.js';
import { LogChannel, type LogEventType } from '../db/models/LogChannel.js';
import { recordActivity } from '../core/metrics.js';
import { Guild, Message, TextChannel, User, EmbedBuilder, Colors, WebhookClient } from 'discord.js';

interface AutomodContext {
  guild: Guild;
  message: Message;
  user: User;
}

/** Check if user has any ignore roles */
function hasIgnoreRole(member: any, ignoreRoles: string[]): boolean {
  if (!member || !member.roles) return false;
  return member.roles.cache.hasAny(...ignoreRoles);
}

/** Check if channel is ignored */
function isIgnoredChannel(channelId: string, ignoreChannels: string[]): boolean {
  return ignoreChannels.includes(channelId);
}

/** Get log channel for automod */
async function getLogChannel(guild: Guild, event: LogEventType): Promise<{ channel: TextChannel | null; webhookId?: string; webhookToken?: string }> {
  const logConfig = await LogChannel.findOne({ guildId: guild.id, event }).lean();
  if (!logConfig) return { channel: null };
  const channel = guild.channels.cache.get(logConfig.channelId) as TextChannel;
  return { channel: channel ?? null, webhookId: logConfig.webhookId, webhookToken: logConfig.webhookToken };
}

/** Send log to channel */
async function sendLog(channel: TextChannel, embed: EmbedBuilder, webhook?: { id: string; token: string }): Promise<void> {
  try {
    if (webhook?.id && webhook?.token) {
      const webhookClient = new WebhookClient({ id: webhook.id, token: webhook.token });
      await webhookClient.send({ embeds: [embed] });
    } else {
      await channel.send({ embeds: [embed] });
    }
  } catch (error) {
    console.warn('[AutoMod] Failed to send log:', error);
  }
}

/** Create infraction record */
async function createInfraction(
  guildId: string,
  userId: string,
  moderatorId: string,
  type: IInfraction['type'],
  reason: string,
  duration?: number,
): Promise<IInfraction> {
  const expiresAt = duration ? new Date(Date.now() + duration * 1000) : undefined;
  return Infraction.create({
    guildId,
    userId,
    moderatorId,
    type,
    reason,
    duration,
    expiresAt,
    active: !!duration,
  });
}

/** Execute actions */
async function executeActions(
  ctx: AutomodContext,
  rule: IAutoModRule,
  reason: string,
): Promise<void> {
  const { guild, message, user } = ctx;
  const member = await guild.members.fetch(user.id).catch(() => null);
  const botMember = guild.members.me;

  if (!member || !botMember) return;

  // Check bot permissions
  const canModerate = botMember.permissions.has('ModerateMembers');
  const canBan = botMember.permissions.has('BanMembers');
  const canKick = botMember.permissions.has('KickMembers');
  const canManageMessages = botMember.permissions.has('ManageMessages');

  // Check hierarchy
  const canActOnMember = member.roles.highest.position < botMember.roles.highest.position;

  const logResult = await getLogChannel(guild, 'automodTrigger');
  const logChannel = logResult.channel;

  const embed = new EmbedBuilder()
    .setColor(Colors.Red)
    .setTitle('🛡️ Auto-Mod Triggered')
    .setDescription(`**Rule:** ${rule.name} (${rule.type})`)
    .addFields(
      { name: 'User', value: `${user.tag} (${user.id})`, inline: true },
      { name: 'Channel', value: `<#${message.channelId}>`, inline: true },
      { name: 'Reason', value: reason, inline: false },
    )
    .setTimestamp();

  if (message.content) {
    embed.addFields({ name: 'Message', value: message.content.slice(0, 1000), inline: false });
  }

  for (const action of rule.actions) {
    try {
      switch (action) {
        case 'delete': {
          if (canManageMessages) {
            await message.delete().catch(() => {});
            embed.addFields({ name: 'Action', value: '✅ Message deleted', inline: true });
          } else {
            embed.addFields({ name: 'Action', value: '❌ Missing ManageMessages permission', inline: true });
          }
          break;
        }

        case 'warn': {
          await createInfraction(guild.id, user.id, guild.client.user!.id, 'warn', reason);
          embed.addFields({ name: 'Action', value: '✅ Warning issued', inline: true });

          // DM user
          const warnMsg = rule.warnMessage || `You were warned in **${guild.name}**: ${reason}`;
          await user.send(warnMsg).catch(() => {});

          break;
        }

        case 'timeout': {
          if (canModerate && canActOnMember && rule.timeoutDuration) {
            await member.timeout(rule.timeoutDuration * 1000, reason).catch(() => {});
            await createInfraction(guild.id, user.id, guild.client.user!.id, 'timeout', reason, rule.timeoutDuration);
            embed.addFields({ name: 'Action', value: `✅ Timed out for ${rule.timeoutDuration}s`, inline: true });
          } else {
            embed.addFields({ name: 'Action', value: '❌ Cannot timeout (permissions/hierarchy)', inline: true });
          }
          break;
        }

        case 'ban': {
          if (canBan && canActOnMember) {
            await guild.members.ban(user.id, { reason, deleteMessageSeconds: 0 }).catch(() => {});
            await createInfraction(guild.id, user.id, guild.client.user!.id, 'ban', reason);
            embed.addFields({ name: 'Action', value: '✅ User banned', inline: true });
          } else {
            embed.addFields({ name: 'Action', value: '❌ Cannot ban (permissions/hierarchy)', inline: true });
          }
          break;
        }

        case 'log': {
          embed.addFields({ name: 'Action', value: '📝 Logged', inline: true });
          break;
        }
      }
    } catch (error) {
      console.error('[AutoMod] Action failed:', error);
      embed.addFields({ name: `Action (${action})`, value: `❌ Error: ${error}`, inline: true });
    }
  }

  if (logChannel) {
    await sendLog(logChannel, embed, logResult.webhookId && logResult.webhookToken
      ? { id: logResult.webhookId, token: logResult.webhookToken }
      : undefined);
  }

  recordActivity('command', `AutoMod Triggered: ${rule.name}`, {
    level: 'warn',
    meta: { guildId: guild.id, userId: user.id, ruleType: rule.type },
  });
}

/** Check spam rule */
function checkSpam(rule: IAutoModRule, recentMessages: Message[]): boolean {
  const config = rule.config;
  const maxMessages = config.maxMessages ?? 5;
  const windowSeconds = config.windowSeconds ?? 10;

  if (recentMessages.length >= maxMessages) {
    const oldest = recentMessages[recentMessages.length - maxMessages];
    const timeDiff = (Date.now() - oldest.createdTimestamp) / 1000;
    return timeDiff <= windowSeconds;
  }
  return false;
}

/** Check links rule */
function checkLinks(rule: IAutoModRule, content: string): boolean {
  const config = rule.config;
  const allowedDomains = config.allowedDomains ?? [];
  const urlRegex = /(https?:\/\/[^\s]+)/gi;
  const urls = content.match(urlRegex) ?? [];

  for (const url of urls) {
    try {
      const hostname = new URL(url).hostname.replace('www.', '');
      if (!allowedDomains.some(d => hostname === d || hostname.endsWith('.' + d))) {
        return true;
      }
    } catch {
      return true;
    }
  }

  // Check for Discord invites
  const inviteRegex = /(discord\.gg\/|discordapp\.com\/invite\/)[a-zA-Z0-9]+/gi;
  if (inviteRegex.test(content)) return true;

  return false;
}

/** Check words rule */
function checkWords(rule: IAutoModRule, content: string): boolean {
  const config = rule.config;
  const bannedWords = config.bannedWords ?? [];
  const regexPatterns = config.regexPatterns ?? [];

  const lowerContent = content.toLowerCase();

  for (const word of bannedWords) {
    if (lowerContent.includes(word.toLowerCase())) return true;
  }

  for (const pattern of regexPatterns) {
    try {
      const regex = new RegExp(pattern, 'gi');
      if (regex.test(content)) return true;
    } catch {
      // Invalid regex, skip
    }
  }

  return false;
}

/** Check caps rule */
function checkCaps(rule: IAutoModRule, content: string): boolean {
  const config = rule.config;
  const minLength = config.minLength ?? 10;
  const maxPercent = config.maxCapsPercent ?? 70;

  if (content.length < minLength) return false;

  const letters = content.match(/[a-zA-Z]/g);
  if (!letters || letters.length < minLength) return false;

  const caps = letters.filter(c => c === c.toUpperCase()).length;
  const percent = (caps / letters.length) * 100;

  return percent > maxPercent;
}

/** Check mentions rule */
function checkMentions(rule: IAutoModRule, message: Message): boolean {
  const config = rule.config;
  const maxMentions = config.maxMentions ?? 5;

  const mentionCount = message.mentions.users.size + message.mentions.roles.size;
  return mentionCount > maxMentions;
}

/** Check attachments rule */
function checkAttachments(rule: IAutoModRule, message: Message): boolean {
  const config = rule.config;
  const blockedExtensions = config.blockedExtensions ?? ['exe', 'bat', 'cmd', 'scr', 'pif', 'com', 'jar', 'msi'];

  for (const attachment of message.attachments.values()) {
    const ext = attachment.name.split('.').pop()?.toLowerCase();
    if (ext && blockedExtensions.includes(ext)) return true;
  }
  return false;
}

/** Check newlines rule */
function checkNewlines(rule: IAutoModRule, content: string): boolean {
  const config = rule.config;
  const maxNewlines = config.maxNewlines ?? 20;
  const newlines = (content.match(/\n/g) || []).length;
  return newlines > maxNewlines;
}

/** Check emojis rule */
function checkEmojis(rule: IAutoModRule, content: string): boolean {
  const config = rule.config;
  const maxEmojis = config.maxEmojis ?? 20;

  // Count custom emojis
  const customEmojis = (content.match(/<a?:[a-zA-Z0-9_]+:\d+>/g) || []).length;
  // Count unicode emojis (rough approximation)
  const unicodeEmojis = (content.match(/[\u{1F300}-\u{1FAFF}]/gu) || []).length;

  return (customEmojis + unicodeEmojis) > maxEmojis;
}

/** Check repeated messages rule */
function checkRepeated(rule: IAutoModRule, recentMessages: Message[], currentMessage: Message): boolean {
  const config = rule.config;
  const maxRepeated = config.maxRepeated ?? 3;

  let count = 0;
  for (const msg of recentMessages) {
    if (msg.content === currentMessage.content && msg.author.id === currentMessage.author.id) {
      count++;
    }
  }
  return count >= maxRepeated;
}

/** Main automod check function */
export async function checkAutomod(message: Message): Promise<void> {
  if (!message.guild || !message.channel.isTextBased()) return;
  if (message.author.bot) return;

  const guild = message.guild;
  const member = await guild.members.fetch(message.author.id).catch(() => null);
  if (!member) return;

  // Check if user has admin/manage messages - they bypass automod
  if (member.permissions.has('Administrator') || member.permissions.has('ManageMessages')) return;

  const rules = await AutoModRule.find({ guildId: guild.id, enabled: true }).lean();

  if (!rules.length) return;

  // Get recent messages for spam/repeated checks (last 30 seconds)
  const recentMessages: Message[] = [];
  // In a real implementation, you'd maintain a cache per channel
  // For now, we'll skip the cache-based checks

  for (const rule of rules) {
    // Check ignore channels
    if (isIgnoredChannel(message.channelId, rule.ignoreChannels)) continue;

    // Check ignore roles
    if (hasIgnoreRole(member, rule.ignoreRoles)) continue;

    let triggered = false;
    let reason = '';

    switch (rule.type) {
      case 'spam': {
        // Would need message cache
        break;
      }
      case 'links':
      case 'invites': {
        if (checkLinks(rule, message.content)) {
          triggered = true;
          reason = 'Message contains unauthorized links/invites';
        }
        break;
      }
      case 'words': {
        if (checkWords(rule, message.content)) {
          triggered = true;
          reason = 'Message contains banned words/phrases';
        }
        break;
      }
      case 'caps': {
        if (checkCaps(rule, message.content)) {
          triggered = true;
          reason = 'Message contains excessive caps';
        }
        break;
      }
      case 'mentions': {
        if (checkMentions(rule, message)) {
          triggered = true;
          reason = 'Message contains excessive mentions';
        }
        break;
      }
      case 'attachments': {
        if (checkAttachments(rule, message)) {
          triggered = true;
          reason = 'Message contains blocked file types';
        }
        break;
      }
      case 'newlines': {
        if (checkNewlines(rule, message.content)) {
          triggered = true;
          reason = 'Message contains excessive newlines';
        }
        break;
      }
      case 'emojis': {
        if (checkEmojis(rule, message.content)) {
          triggered = true;
          reason = 'Message contains excessive emojis';
        }
        break;
      }
      case 'repeated': {
        // Would need message cache
        break;
      }
    }

    if (triggered) {
      await executeActions({ guild, message, user: message.author }, rule, reason);
      break; // Only trigger first matching rule
    }
  }
}

/** Initialize automod (call on ready) */
export async function initAutomod(): Promise<void> {
  console.log('[AutoMod] Auto-moderation system initialized');
}