import { Events, type ClientEvents } from 'discord.js';
import { OpenTicket } from '../db/models/Ticket.js';
import {
  getCachedActiveTempVC,
  deleteCachedActiveTempVC,
  deleteActiveTempVC,
} from '../db/models/TempVC.js';

/**
 * When a ticket channel is deleted (manually or by a close flow), mark the
 * OpenTicket row closed so the owner isn't permanently locked out by an
 * orphan row with closedAt = null.
 *
 * When a temp VC channel is deleted, remove its ActiveTempVC row so the owner
 * can create a new one.
 */
export const channelDelete = {
  name: Events.ChannelDelete as keyof ClientEvents,
  execute: async (client: any, channel: any) => {
    if (!channel?.guildId) return;
    try {
      // Ticket cleanup
      const ticket = await OpenTicket.findOne({
        guildId: channel.guildId,
        channelId: channel.id,
        closedAt: null,
      });
      if (ticket) {
        await OpenTicket.updateOne(
          { _id: ticket._id },
          { closedAt: new Date(), closedBy: 'system', closeReason: 'channel_deleted' },
        );
        client.logger?.debug({ guildId: channel.guildId, channelId: channel.id }, 'ticket cleaned up after channel delete');
      }

      // Temp VC cleanup
      const active = getCachedActiveTempVC(channel.id);
      if (active) {
        await deleteActiveTempVC(channel.id);
        deleteCachedActiveTempVC(channel.id);
        client.logger?.debug({ guildId: channel.guildId, channelId: channel.id }, 'temp VC cleaned up after channel delete');
      }
    } catch (error) {
      client.logger?.warn({ err: error, guildId: channel.guildId, channelId: channel.id }, 'channelDelete cleanup failed');
    }
  },
};
