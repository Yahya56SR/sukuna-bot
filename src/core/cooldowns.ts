interface CooldownEntry {
  expiry: number;
}

const cooldowns = new Map<string, CooldownEntry>();
const MAX_ENTRIES = 25_000;

/** Rate-limit how often we sweep so a hot command path never pays full scans. */
const SWEEP_INTERVAL_MS = 60_000;
let lastSweep = 0;

/**
 * Drop expired entries so the map cannot grow forever (one entry per
 * user × guild × command is otherwise retained for the process lifetime).
 */
function sweep(now: number): void {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [key, entry] of cooldowns) {
    if (now >= entry.expiry) cooldowns.delete(key);
  }
}

/**
 * Returns remaining milliseconds if on cooldown, else 0 and records the hit.
 * Key is `${guildId}:${userId}:${commandName}`.
 */
export function takeCooldown(
  guildId: string,
  userId: string,
  commandName: string,
  cooldownSeconds: number,
): number {
  const now = Date.now();
  sweep(now);

  const key = `${guildId}:${userId}:${commandName}`;
  const entry = cooldowns.get(key);

  if (entry && now < entry.expiry) {
    return entry.expiry - now;
  }

  // Hard cap so a hot guild cannot grow this map without bound.
  if (cooldowns.size >= MAX_ENTRIES) sweep(now + SWEEP_INTERVAL_MS);
  if (cooldowns.size >= MAX_ENTRIES) return 0; // fail-open rather than leak
  cooldowns.set(key, { expiry: now + cooldownSeconds * 1000 });
  return 0;
}

/** For shutdown / tests: drop all cooldown state. */
export function clearAllCooldowns(): void { cooldowns.clear(); }

/**
 * Give a cooldown back when the command failed before doing its work, so a
 * transient database error does not cost the user a 24h `/daily` reward.
 */
export function clearCooldown(guildId: string, userId: string, commandName: string): void {
  cooldowns.delete(`${guildId}:${userId}:${commandName}`);
}
