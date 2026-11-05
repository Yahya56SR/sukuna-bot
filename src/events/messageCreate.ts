import { Events, type ClientEvents, Message } from 'discord.js';
import { bumpCounter } from '../core/metrics.js';
import { addXp, getUserXp } from '../db/utils.js';
import { handleLevelUp } from '../handlers/levelUp.js';
import { randomXp } from '../utils/level.js';
import { readLevelSettings } from '../utils/levelSettings.js';
import { handleSukunaMessage } from '../utils/sukuna.js';
import { checkAutomod } from '../handlers/automod.js';
import { executeCustomCommand } from '../commands/utility/customcmd.js';
import { handleAfkMessage } from '../commands/utility/afk.js';

/**
 * MEE6-style XP earning:
 *  - random XP per message (15-25 by default)
 *  - max one XP-earning message per cooldown (60s by default) per user
 *  - no XP in excluded channels
 *  - if an XP channel is configured, only that channel gives XP
 *  - bots can be excluded
 */
export const messageCreate = {
  name: Events.MessageCreate as keyof ClientEvents,
  execute: async (client: any, message: Message) => {
    // Run the Sukuna AI persona first: it also records bot messages as context.
    try {
      handleSukunaMessage(message);
    } catch (err) {
      client.logger?.warn({ err }, 'sukuna handler failed');
    }

    if (!message.guild) return;
    if (!message.author?.bot) bumpCounter('messagesSeen');

    let config: any = null;
    let configLoaded = true;
    try {
      config = await client.getConfig(message.guild.id);
    } catch (err) {
      configLoaded = false;
      client.logger?.warn({ err }, 'guild settings load failed');
    }

    // Moderation, tags and AFK are independent of the leveling module and must
    // run before any XP gate. They used to sit behind the XP cooldown and the
    // no-XP-channel / leveling-disabled checks, so a member sending a message
    // every minute bypassed automod entirely, and turning leveling off (or
    // configuring an exclusive XP channel) silently disabled moderation in
    // every other channel.
    try {
      await checkAutomod(message);
    } catch (err) {
      client.logger?.warn({ err }, 'automod check failed');
    }

    let tagHandled = false;
    try {
      const prefixMatch = message.content.match(PREFIX_COMMAND_RE);
      if (prefixMatch && !message.author.bot) {
        const commandName = prefixMatch[2].toLowerCase();
        const args = message.content.slice(prefixMatch[0].length).trim().split(/\s+/);
        tagHandled = await executeCustomCommand(message, commandName, args);
      }
    } catch (err) {
      client.logger?.warn({ err }, 'custom command handler failed');
    }

    try {
      await handleAfkMessage(message);
    } catch (err) {
      client.logger?.warn({ err }, 'afk handler failed');
    }

    // ---- Leveling gates (everything below only concerns XP) ----
    if (!configLoaded) return;

    // Leveling always on unless explicitly disabled.
    if (config?.modules?.leveling === false) return;

    const settings = readLevelSettings(config);
    if (!settings.enabled) return;

    // A tag command already produced the reply for this message.
    if (tagHandled) return;

    // Optionally ignore bots for text-channel XP.
    if (settings.ignoreBots && message.author.bot) return;

    // Excluded channels never give XP.
    if (settings.noXpChannels.includes(message.channelId)) return;

    // When an XP channel is configured, only that channel gives XP.
    if (settings.xpChannel && message.channelId !== settings.xpChannel) return;

    const userId = message.author.id as string;
    const guildId = message.guild.id as string;
    const now = Date.now();
    const cooldownMs = Math.max(0, settings.cooldownSeconds) * 1000;

    const xpCooldowns: Map<string, number> = client.xpCooldowns || new Map();
    client.xpCooldowns = xpCooldowns;
    const cooldownKey = `xp_${guildId}_${userId}`;

    // Fast in-memory path first. Only touch the database once the in-memory
    // window has elapsed, so the persisted `lastMessageAt` can still enforce the
    // cooldown across restarts without costing a query per message.
    const memoryExpiry = xpCooldowns.get(cooldownKey) ?? 0;
    if (memoryExpiry > now) return;

    let storedExpiry = 0;
    if (cooldownMs > 0) {
      try {
        const stored = await getUserXp(userId);
        storedExpiry = (stored?.lastMessageAt?.getTime?.() ?? 0) + cooldownMs;
      } catch (err) {
        client.logger?.warn({ err, userId }, 'xp cooldown read failed');
      }
    }
    if (storedExpiry > now) {
      xpCooldowns.set(cooldownKey, storedExpiry);
      return;
    }

    const amount = randomXp(settings.perMessageMin, settings.perMessageMax);
    if (amount <= 0) return;

    try {
      const result = await addXp(userId, amount, 'message');

      // Start the cooldown only once XP was actually awarded, so a failed write
      // does not silently cost the member their next message.
      xpCooldowns.set(cooldownKey, now + cooldownMs);

      if (result.leveledUp) {
        await handleLevelUp(
          message.guild,
          message.author,
          result.newLevel,
          result.oldLevel,
          message.channel,
          settings,
        );
      }
    } catch (err) {
      client.logger?.error({ err, userId }, 'failed to process XP for message');
    }

    // Prune on a size threshold regardless of whether XP was awarded, so a
    // guild running with XP disabled cannot grow this map without bound.
    if (xpCooldowns.size > XP_COOLDOWN_SOFT_CAP) cleanupCooldowns(xpCooldowns, now);
  },
};

/** `!tag name` / `/tag name` message prefix commands. */
const PREFIX_COMMAND_RE = /^([!/])(\w+)/;

/** Soft cap on cached XP cooldown keys before expired entries are dropped. */
const XP_COOLDOWN_SOFT_CAP = 10_000;

/** Remove expired cooldown entries to prevent memory leaks. */
function cleanupCooldowns(cooldowns: Map<string, number>, now: number): void {
  for (const [key, expiry] of cooldowns.entries()) {
    if (expiry <= now) cooldowns.delete(key);
  }
}