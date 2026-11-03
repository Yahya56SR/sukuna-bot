import type { CommandContext } from '../../core/commands.js';
import { readGuildConfig, updateGuildConfig } from '../../db/models/Guild.js';
import { readLevelSettings, type LevelSettings } from '../../utils/levelSettings.js';

/**
 * Read the level settings straight from MongoDB so a command never acts on a
 * stale dashboard cache, then normalise them.
 */
export async function loadLevelSettings(context: CommandContext): Promise<LevelSettings> {
  const row = await readGuildConfig(context.guild.id).catch(() => null);
  return readLevelSettings(row ?? context.settings ?? {});
}

/**
 * Persist a guild patch and refresh the client's settings cache so the message
 * and voice XP paths see the change immediately.
 */
export async function saveGuildSettings(
  context: CommandContext,
  updates: Record<string, unknown>,
): Promise<LevelSettings> {
  const fresh = await updateGuildConfig(context.guild.id, updates as any);
  if (fresh) context.client.cacheSettings(context.guild.id, fresh, Date.now());
  return readLevelSettings(fresh ?? context.settings ?? {});
}
