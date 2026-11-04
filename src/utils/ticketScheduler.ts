/**
 * Auto-close scheduler for idle tickets.
 *
 * Reads TicketConfig.autoCloseMinutes (0 = disabled) and closes tickets that
 * have been open longer than the threshold, posting a warning first.
 */

import { OpenTicket, TicketConfig } from '../db/models/Ticket.js';

let _timer: NodeJS.Timeout | null = null;
const CHECK_INTERVAL_MS = 60_000; // check every minute
const WARN_BEFORE_MS = 5 * 60_000; // warn 5 minutes before auto-close

export function startTicketScheduler(client: any): void {
  if (_timer) return;
  _timer = setInterval(async () => {
    try {
      await runAutoClose(client);
    } catch (error) {
      client.logger?.warn({ err: error }, 'ticket auto-close scheduler failed');
    }
  }, CHECK_INTERVAL_MS);
  _timer.unref();
}

export function stopTicketScheduler(): void {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
}

async function runAutoClose(client: any) {
  const now = Date.now();

  // Load all guilds that have an open ticket and auto-close enabled.
  const openTickets = await OpenTicket.find({ closedAt: null }).lean();
  if (openTickets.length === 0) return;

  const guildIds = [...new Set(openTickets.map((t) => t.guildId))];
  const configs = await TicketConfig.find({ guildId: { $in: guildIds } }).lean();
  const configByGuild = new Map(configs.map((c) => [c.guildId, c]));

  for (const ticket of openTickets) {
    const config = configByGuild.get(ticket.guildId);
    const autoCloseMinutes = config?.autoCloseMinutes ?? 0;
    if (!autoCloseMinutes || autoCloseMinutes <= 0) continue;

    const openedAt = new Date(ticket.createdAt).getTime();
    const elapsed = now - openedAt;
    const threshold = autoCloseMinutes * 60_000;

    if (elapsed >= threshold) {
      await closeTicket(client, ticket, 'Auto-closed due to inactivity');
    } else if (
      elapsed >= threshold - WARN_BEFORE_MS &&
      elapsed < threshold
    ) {
      // Post a single warning in the channel (guarded by transcriptSent flip not used here).
      const channel = client.channels.cache.get(ticket.channelId);
      if (channel && (channel as any).send) {
        try {
          await (channel as any).send(
            `⏰ This ticket will be auto-closed in ${Math.ceil(
              (threshold - elapsed) / 60_000,
            )} minute(s) due to inactivity.`,
          );
        } catch {}
      }
    }
  }
}

async function closeTicket(client: any, ticket: any, reason: string): Promise<void> {
  await OpenTicket.updateOne(
    { _id: ticket._id },
    { closedAt: new Date(), closedBy: 'system', closeReason: reason },
  );

  const channel = client.channels.cache.get(ticket.channelId);
  if (channel && (channel as any).send) {
    try {
      await (channel as any).send(`🔒 ${reason}. The channel will be deleted in 10 seconds.`);
      setTimeout(async () => {
        try {
          await (channel as any).delete();
        } catch {}
      }, 10_000);
    } catch {}
  }
}
