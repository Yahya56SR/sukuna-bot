/**
 * Auto-close scheduler for idle tickets + shared ticket close helpers.
 *
 * Reads TicketConfig.autoCloseMinutes (0 = disabled) and closes tickets that
 * have been open longer than the threshold, posting a warning first.
 */

import { OpenTicket, TicketConfig, TicketDepartment } from '../db/models/Ticket.js';
import { replyError } from '../core/respond.js';

let _timer: NodeJS.Timeout | null = null;
const CHECK_INTERVAL_MS = 60_000; // check every minute
const WARN_BEFORE_MS = 5 * 60_000; // warn 5 minutes before auto-close

// Tickets currently being closed — guards double-close races across the
// slash command, button and scheduler paths.
const _closing = new Set<string>();
// Ticket channelIds already warned in the current auto-close window —
// ensures we warn at most once per ticket instead of every minute.
const _warned = new Set<string>();

/* -------------------------------------------------------------------------- */
/* Shared helpers                                                             */
/* -------------------------------------------------------------------------- */

/** Fetch the open ticket for a channel, if any. */
export async function getTicketByChannel(
  guildId: string,
  channelId: string,
): Promise<any | null> {
  return OpenTicket.findOne({
    guildId,
    channelId,
    closedAt: null,
  }).lean();
}

/**
 * Unified ticket close. Used by /ticket close, the close button and the
 * auto-close scheduler. Atomic (won't close an already-closed ticket), posts
 * an optional transcript, and deletes the channel independently of sending so
 * a failed send never orphans the channel.
 *
 * @param opts.reason        human reason shown in the close notice
 * @param opts.closedBy      user id who closed it ('system' for scheduler)
 * @param opts.closeReason   stored closeReason value
 * @param opts.sendTranscript whether to post a transcript to the channel first
 */
export async function closeTicket(
  client: any,
  ticket: any,
  opts: {
    reason: string;
    closedBy: string;
    closeReason?: string;
    sendTranscript?: boolean;
    dmTranscript?: boolean;
  },
): Promise<void> {
  if (_closing.has(ticket.channelId)) return;
  _closing.add(ticket.channelId);
  try {
    // Atomically mark closed only if it is still open — loses races cleanly.
    const updated = await OpenTicket.findOneAndUpdate(
      { _id: ticket._id, closedAt: null },
      {
        closedAt: new Date(),
        closedBy: opts.closedBy,
        closeReason: opts.closeReason ?? opts.reason,
      },
    );
    if (!updated) return; // already closed by another path

    const channel = client.channels.cache.get(ticket.channelId);
    const guild = channel?.guild ?? client.guilds.cache.get(ticket.guildId);

    if (opts.sendTranscript !== false && channel?.isTextBased()) {
      await postTranscript(client, channel, ticket, opts.closedBy).catch(() => {});
    }

    if (opts.dmTranscript && guild) {
      await dmTranscriptToOwner(guild, ticket, opts.closedBy).catch(() => {});
    }

    // Notice + channel delete are independent: a failed notice never blocks
    // deletion, and deletion is not coupled to the send completing.
    if (channel && (channel as any).delete) {
      try {
        await (channel as any).send(`🔒 ${opts.reason}. The channel will be deleted in 10 seconds.`).catch(() => {});
      } catch {}
      setTimeout(async () => {
        try {
          await (channel as any).delete();
        } catch {}
      }, 10_000).unref?.();
    }
  } finally {
    _closing.delete(ticket.channelId);
  }
}

async function dmTranscriptToOwner(guild: any, ticket: any, closedBy: string): Promise<void> {
  const member = await guild.members.fetch(ticket.userId).catch(() => null);
  if (!member) return;

  const channel = guild.channels.cache.get(ticket.channelId);
  if (!channel?.isTextBased()) return;

  const messages = await channel.messages.fetch({ limit: 100 });
  const lines = messages
    .reverse()
    .map((m: any) => `[${m.createdAt.toISOString()}] ${m.author.tag}: ${m.content}`)
    .join('\n');

  const transcript = `TICKET TRANSCRIPT\nGuild: ${guild.name}\nChannel: #${channel.name}\nOwner: <@${ticket.userId}>\nDepartment: ${ticket.departmentName}\nClaimed by: ${ticket.claimedBy ? `<@${ticket.claimedBy}>` : 'none'}\nClosed by: <@${closedBy}>\n\n${lines}`;

  const attachment = Buffer.from(transcript);
  const fileName = `ticket-${ticket.channelId}-${Math.random().toString(36).slice(2, 8)}.txt`;

  await member.user
    .send({
      content: `📄 Transcript for ticket #${channel.name}`,
      files: [{ attachment, name: fileName }],
    })
    .catch(() => {});
}

async function postTranscript(client: any, channel: any, ticket: any, closedBy: string): Promise<void> {
  const guild = client.guilds.cache.get(ticket.guildId);
  if (!guild) return;

  const messages = await channel.messages.fetch({ limit: 100 });
  const lines = messages
    .reverse()
    .map((m: any) => `[${m.createdAt.toISOString()}] ${m.author.tag}: ${m.content}`)
    .join('\n');

  const transcript = `TICKET TRANSCRIPT\nGuild: ${guild.name}\nChannel: #${channel.name}\nOwner: <@${ticket.userId}>\nDepartment: ${ticket.departmentName}\nClaimed by: ${ticket.claimedBy ? `<@${ticket.claimedBy}>` : 'none'}\nClosed by: <@${closedBy}>\n\n${lines}`;

  const attachment = Buffer.from(transcript);
  const fileName = `ticket-${ticket.channelId}-${Math.random().toString(36).slice(2, 8)}.txt`;

  await channel.send({
    content: `📄 Ticket transcript generated by <@${closedBy}>:`,
    files: [{ attachment, name: fileName }],
  });
}

/* -------------------------------------------------------------------------- */
/* Scheduler                                                                  */
/* -------------------------------------------------------------------------- */

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
  _warned.clear();
}

async function runAutoClose(client: any) {
  const now = Date.now();

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
      // Only warn once per ticket; clear the warn flag when we actually close.
      _warned.delete(ticket.channelId);
      await closeTicket(client, ticket, {
        reason: 'Auto-closed due to inactivity',
        closedBy: 'system',
        closeReason: 'auto_close',
        sendTranscript: false,
      });
    } else if (
      elapsed >= threshold - WARN_BEFORE_MS &&
      elapsed < threshold &&
      !_warned.has(ticket.channelId)
    ) {
      _warned.add(ticket.channelId);
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
