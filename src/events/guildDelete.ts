import { Events, type ClientEvents } from 'discord.js';
import { OpenTicket } from '../db/models/Ticket.js';
import { ActiveTempVC, clearTempVCConfigCache } from '../db/models/TempVC.js';

/**
 * When a guild removes the bot, mark all of its open tickets closed so they
 * don't linger as orphan rows, and drop all of its active temp VC rows.
 * In-memory caches are evicted too — a stale entry would otherwise resurrect
 * state on a future re-join.
 */
export const guildDelete = {
  name: Events.GuildDelete as keyof ClientEvents,
  execute: async (client: any, guild: any) => {
    try {
      await OpenTicket.updateMany(
        { guildId: guild.id, closedAt: null },
        { closedAt: new Date(), closedBy: 'system', closeReason: 'guild_deleted' },
      );
    } catch (error) {
      client.logger?.warn({ err: error, guildId: guild.id }, 'guildDelete ticket cleanup failed');
    }

    try {
      await ActiveTempVC.deleteMany({ guildId: guild.id });
    } catch (error) {
      client.logger?.warn({ err: error, guildId: guild.id }, 'guildDelete temp VC cleanup failed');
    }

    // Evict caches (settings, XP cooldowns, automod rules, tempVC config).
    try { client.evictGuildCache?.(guild.id); } catch (error) {
      client.logger?.warn({ err: error, guildId: guild.id }, 'guildDelete settings cache evict failed');
    }
    try { clearTempVCConfigCache(guild.id); } catch (error) {
      client.logger?.warn({ err: error, guildId: guild.id }, 'guildDelete tempVC cache evict failed');
    }
    try {
      const { invalidateAutomodCache } = await import('../handlers/automod.js');
      invalidateAutomodCache(guild.id);
    } catch (error) {
      client.logger?.warn({ err: error, guildId: guild.id }, 'guildDelete automod cache evict failed');
    }
  },
};
