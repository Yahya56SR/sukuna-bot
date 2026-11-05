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
import { handleStarboardReaction } from '../commands/utility/starboard.js';

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

    let config: any;
    try {
      config = await client.getConfig(message.guild.id);
    } catch (err) {
      client.logger?.warn({ err }, 'guild settings load failed');
      return;
    }

    // Leveling always on unless explicitly disabled.
    if (config?.modules?.leveling === false) return;

    const settings = readLevelSettings(config);
    if (!settings.enabled) return;

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

    // Run auto-mod check (before XP to potentially delete message)
    try {
      await checkAutomod(message);
    } catch (err) {
      client.logger?.warn({ err }, 'automod check failed');
    }

    // Check custom commands (tags)
    try {
      const prefixMatch = message.content.match(/^([!/])(\w+)/);
      if (prefixMatch && !message.author.bot) {
        const commandName = prefixMatch[2].toLowerCase();
        const args = message.content.slice(prefixMatch[0].length).trim().split(/\s+/);
        const handled = await executeCustomCommand(message, commandName, args);
        if (handled) return; // Don't process XP if command was handled
      }
    } catch (err) {
      client.logger?.warn({ err }, 'custom command handler failed');
    }

    // Handle AFK
    try {
      await handleAfkMessage(message);
    } catch (err) {
      client.logger?.warn({ err }, 'afk handler failed');
    }

    const amount = randomXp(settings.perMessageMin, settings.perMessageMax);
    if (amount <= 0) return;

    try {
      const result = await addXp(userId, amount, 'message');

      // Start the cooldown only once XP was actually awarded, so a failed write
      // does not silently cost the member their next message.
      xpCooldowns.set(cooldownKey, now + cooldownMs);

      // Periodically clean up expired entries to prevent a memory leak.
      if (xpCooldowns.size > 10000) cleanupCooldowns(xpCooldowns, now);

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
  },
};

/** Remove expired cooldown entries to prevent memory leaks. */
function cleanupCooldowns(cooldowns: Map<string, number>, now: number): void {
  for (const [key, expiry] of cooldowns.entries()) {
    if (expiry <= now) cooldowns.delete(key);
  }
}