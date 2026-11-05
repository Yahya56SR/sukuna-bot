import { Events, type ClientEvents } from 'discord.js';
import { OpenTicket } from '../db/models/Ticket.js';
import { ActiveTempVC } from '../db/models/TempVC.js';

/**
 * When a guild removes the bot, mark all of its open tickets closed so they
 * don't linger as orphan rows, and drop all of its active temp VC rows.
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
  },
};
