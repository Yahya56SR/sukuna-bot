/**
 * Pro-grade safety helpers for a single-guild premium-feel bot.
 *
 * No premium tiers (one guild = one tenant) — these helpers exist to stop
 * races, leaks and silent corruption that free-tier bots tolerate.
 */

import type { Guild, TextChannel } from 'discord.js';

/** Mongo duplicate-key (unique index violation). */
export function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 11000;
}

/** Clamp to integer in [min, max]; fall back when not finite. */
export function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.round(n), min), max);
}

/** Snowflake-ish Discord id check (5–25 digits). */
export function isSnowflake(value: unknown): value is string {
  return typeof value === 'string' && /^\d{5,25}$/.test(value);
}

/** Keep only unique valid snowflakes. */
export function cleanIdList(value: unknown, max = 100): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of value) {
    if (typeof v !== 'string') continue;
    const t = v.trim();
    if (!isSnowflake(t) || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Keyed in-process mutex. Serialises async work per key so two racing
 * interactions (double-click, duplicate event fan-out) cannot both pass a
 * "find-then-create" check. Bounded: the tail entry is always removed.
 */
const _locks = new Map<string, Promise<unknown>>();

export async function withMutex<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = _locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.then(() => next).catch(() => next);
  _locks.set(key, tail);
  await previous.catch(() => {});
  try {
    return await fn();
  } finally {
    release();
    // Only delete if we are still the tail — otherwise a newer waiter owns it.
    if (_locks.get(key) === tail) _locks.delete(key);
  }
}

/** Number of live mutex keys (for health/debug). */
export function lockCount(): number { return _locks.size; }

/** Bounded FIFO eviction for unbounded caches. */
export function pruneMap<K, V>(map: Map<K, V>, cap: number, isExpired?: (v: V) => boolean): void {
  if (isExpired) {
    for (const [k, v] of map) {
      if (isExpired(v)) map.delete(k);
    }
  }
  if (map.size <= cap) return;
  const excess = map.size - cap;
  let removed = 0;
  for (const k of map.keys()) {
    if (removed >= excess) break;
    map.delete(k);
    removed++;
  }
}

/** Cache-then-fetch a text channel; null when missing or not text-based. */
export async function getTextChannel(guild: Guild, id: string | null | undefined): Promise<TextChannel | null> {
  if (!id || !isSnowflake(id)) return null;
  const cached = guild.channels.cache.get(id);
  if (cached && cached.isTextBased() && !cached.isThread()) return cached as TextChannel;
  try {
    const fetched = await guild.channels.fetch(id);
    if (!fetched || !fetched.isTextBased() || fetched.isThread()) return null;
    return fetched as TextChannel;
  } catch {
    return null;
  }
}

/** Safe best-effort DM — never throws. */
export async function safeDm(guild: Guild, userId: string, content: string): Promise<void> {
  if (!isSnowflake(userId) || !content) return;
  try {
    const user = await guild.client.users.fetch(userId);
    await user.send({ content: content.slice(0, 1900) }).catch(() => {});
  } catch { /* user not fetchable / DMs closed */ }
}
