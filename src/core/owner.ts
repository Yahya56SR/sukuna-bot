/**
 * Owner-only gate shared across commands (xpgive, resetxp, quick-ticket, setup, ...).
 *
 * Reads OWNER_IDS from the environment (comma-separated Discord user ids).
 * Keeping this in one place avoids the triplicated owner check that was
 * scattered across three commands.
 */

export function ownerIds(): string[] {
  return (process.env.OWNER_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isOwner(userId: string): boolean {
  return ownerIds().includes(userId);
}
