/**
 * In-process metrics and activity feed used by the dashboard.
 *
 * Everything here is best-effort and bounded so a long-running bot cannot leak
 * memory. Nothing is persisted: restarting the bot clears the feed.
 */

import { Writable } from 'node:stream';

export type ActivityKind = 'system' | 'command' | 'ai' | 'error' | 'log';
export type ActivityLevel = 'info' | 'success' | 'warn' | 'error';

export interface ActivityEvent {
  id: number;
  kind: ActivityKind;
  level: ActivityLevel;
  message: string;
  meta?: Record<string, string | number | boolean | null>;
  at: number;
}

export interface ActivityCounters {
  startedAt: number;
  messagesSeen: number;
  commandsRun: number;
  aiReplies: number;
  errors: number;
  guildJoins: number;
}

const MAX_EVENTS = 400;

const events: ActivityEvent[] = [];
const counters: ActivityCounters = {
  startedAt: Date.now(),
  messagesSeen: 0,
  commandsRun: 0,
  aiReplies: 0,
  errors: 0,
  guildJoins: 0,
};

let nextId = 1;

function sanitizeMeta(meta: Record<string, unknown> | undefined): ActivityEvent['meta'] {
  if (!meta) return undefined;
  const clean: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (value === undefined || value === null) {
      clean[key] = null;
      continue;
    }
    if (typeof value === 'string') {
      clean[key] = value.length > 200 ? value.slice(0, 200) : value;
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      clean[key] = value;
    }
  }
  return Object.keys(clean).length > 0 ? clean : undefined;
}

export function recordActivity(
  kind: ActivityKind,
  message: string,
  options: { level?: ActivityLevel; meta?: Record<string, unknown> } = {},
): ActivityEvent {
  const event: ActivityEvent = {
    id: nextId++,
    kind,
    level: options.level ?? 'info',
    message: String(message ?? '').slice(0, 500),
    meta: sanitizeMeta(options.meta),
    at: Date.now(),
  };

  events.unshift(event);
  if (events.length > MAX_EVENTS) events.length = MAX_EVENTS;
  return event;
}

export function getActivity(limit = 100, kind?: ActivityKind | 'all'): ActivityEvent[] {
  const max = Math.min(Math.max(Math.round(limit) || 100, 1), MAX_EVENTS);
  if (!kind || kind === 'all') return events.slice(0, max);
  return events.filter((event) => event.kind === kind).slice(0, max);
}

export function bumpCounter(key: Exclude<keyof ActivityCounters, 'startedAt'>, by = 1): void {
  counters[key] += by;
}

export function getCounters(): ActivityCounters {
  return { ...counters };
}

/* ------------------------------------------------------------------ */
/* pino -> activity bridge                                            */
/* ------------------------------------------------------------------ */

const PINO_LEVELS: Record<number, ActivityLevel> = {
  10: 'info',
  20: 'info',
  30: 'info',
  40: 'warn',
  50: 'error',
  60: 'error',
};

/** pino writes newline-delimited JSON. Turn useful lines into feed entries. */
export const activityLogStream = new Writable({
  write(chunk: Buffer | string, _encoding, callback): void {
    try {
      const raw = chunk.toString().trim();
      if (!raw) return callback();
      const line = JSON.parse(raw) as Record<string, unknown>;
      const levelNumber = typeof line.level === 'number' ? line.level : 30;
      const level = PINO_LEVELS[levelNumber] ?? 'info';
      const message = typeof line.msg === 'string' ? line.msg : '';
      if (!message) return callback();

      // Skip the per-message info line to keep the feed readable; counters
      // already track traffic volume.
      const isErr = line.err !== undefined || level === 'error';
      recordActivity(isErr ? 'error' : 'log', message, {
        level,
        meta: {
          tag: typeof line.tag === 'string' ? line.tag : undefined,
          command: typeof line.command === 'string' ? line.command : undefined,
          guildId: typeof line.guildId === 'string' ? line.guildId : undefined,
          userId: typeof line.userId === 'string' ? line.userId : undefined,
          event: typeof line.event === 'string' ? line.event : undefined,
          errorId: typeof line.errorId === 'string' ? line.errorId : undefined,
        },
      });
    } catch {
      // Ignore malformed log lines (e.g. pino-pretty output).
    }
    callback();
  },
});
