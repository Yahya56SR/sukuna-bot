interface CooldownEntry {
  expiry: number;
}

const cooldowns = new Map<string, CooldownEntry>();

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
  const key = `${guildId}:${userId}:${commandName}`;
  const entry = cooldowns.get(key);

  if (entry && now < entry.expiry) {
    return entry.expiry - now;
  }

  cooldowns.set(key, { expiry: now + cooldownSeconds * 1000 });
  return 0;
}

export function clearCooldown(guildId: string, userId: string, commandName: string): void {
  cooldowns.delete(`${guildId}:${userId}:${commandName}`);
}
