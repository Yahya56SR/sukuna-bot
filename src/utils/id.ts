import { randomUUID } from 'crypto';

/**
 * Collision-resistant identifier helper.
 *
 * The old code used `Date.now()` + `Math.random().toString(36)`, which can
 * collide when two records are written in the same millisecond and is not
 * sortable by insertion order. `randomUUID()` gives us a stable, unique id
 * while the optional prefix keeps ids readable in logs and the dashboard.
 */
export function newId(prefix?: string): string {
  const raw = randomUUID().replace(/-/g, '');
  return prefix ? `${prefix}_${raw}` : raw;
}

/** Short id for user-facing references (still collision-resistant enough for tickets). */
export function shortId(prefix?: string): string {
  const raw = randomUUID().replace(/-/g, '').slice(0, 8);
  return prefix ? `${prefix}_${raw}` : raw;
}

/** Discord snowflake-ish check used when accepting ids from the dashboard. */
export function isSnowflake(value: string | null | undefined): boolean {
  return typeof value === 'string' && /^\d{15,25}$/.test(value);
}
