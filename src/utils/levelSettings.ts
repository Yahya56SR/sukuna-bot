/**
 * Normalisation for the per-guild XP/level configuration.
 *
 * Guild documents come from MongoDB (`readGuildConfig().lean()`), from the
 * dashboard cache, or from an empty `{ modules: {} }` fallback, so every field
 * has to be treated as optional and coerced to a sane value before it reaches
 * the hot message path.
 */

export interface LiveLeaderboardSettings {
  enabled: boolean;
  channelId: string;
  messageId: string;
  intervalMinutes: number;
  rows: number;
  title: string;
}

export interface LevelSettings {
  enabled: boolean;
  perMessageMin: number;
  perMessageMax: number;
  cooldownSeconds: number;
  perVoiceMinuteMin: number;
  perVoiceMinuteMax: number;
  /** Channels where members earn no XP */
  noXpChannels: string[];
  /** When set, XP is only earned in this channel */
  xpChannel: string;
  /** When true, bots earn no XP in text or voice channels */
  ignoreBots: boolean;
  /** Level-up announcement channel (empty = the channel where XP was earned) */
  levelUpChannel: string;
  /** Announcement template: {user} {username} {level} {server} {role} {xp} {xpneeded} */
  levelUpMessage: string;
  /** Level milestone -> role id */
  levelRoles: Record<string, string>;
  liveLeaderboard: LiveLeaderboardSettings;
}

export const DEFAULT_LEVEL_UP_MESSAGE =
  '🎉 Congratulations {user}, you have reached **level {level}**!';

export const DEFAULT_LEVEL_ROLES: Record<string, string> = {};

function asInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.round(parsed), min), max);
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

function asIdArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id): id is string => typeof id === 'string' && /^\d{5,25}$/.test(id)))];
}

/**
 * Level reward keys must be plain integers. Hand-edited documents can hold
 * `"05"` or `"5.0"`, which would never match a level and silently never grant
 * the reward.
 */
export function normalizeLevelRoles(raw: unknown): Record<string, string> {
  const source =
    raw instanceof Map
      ? (Object.fromEntries(raw as Map<string, unknown>) as Record<string, unknown>)
      : raw && typeof raw === 'object'
        ? (raw as Record<string, unknown>)
        : {};

  const entries: Array<[string, string]> = [];
  for (const [level, roleId] of Object.entries(source)) {
    if (!/^\d+$/.test(level)) continue;
    if (typeof roleId !== 'string' || roleId.trim() === '') continue;
    entries.push([String(Number.parseInt(level, 10)), roleId.trim()]);
  }
  return Object.fromEntries(entries);
}

export function readLevelSettings(config: any): LevelSettings {
  const raw = config ?? {};
  const voice = raw.xpVoice ?? {};

  return {
    enabled: raw.xpEnabled !== false,
    perMessageMin: asInt(raw.xpMin, 15, 0, 10_000),
    perMessageMax: asInt(raw.xpMax, 25, 0, 10_000),
    cooldownSeconds: asInt(raw.xpCooldown, 60, 0, 86_400),
    perVoiceMinuteMin: asInt(voice.min ?? raw.xpVoiceMin, 5, 0, 10_000),
    perVoiceMinuteMax: asInt(voice.max ?? raw.xpVoiceMax, 8, 0, 10_000),
    noXpChannels: asIdArray(raw.disableXpChannels),
    xpChannel: asString(raw.xpChannel),
    ignoreBots: asBool(raw.xpIgnoreBots, true),
    levelUpChannel: asString(raw.levelUpChannel),
    levelUpMessage: asString(raw.levelUpMessage, DEFAULT_LEVEL_UP_MESSAGE) || DEFAULT_LEVEL_UP_MESSAGE,
    levelRoles: normalizeLevelRoles(raw.levelRoles),
    liveLeaderboard: {
      enabled: asBool(raw.liveLeaderboard?.enabled, false),
      channelId: asString(raw.liveLeaderboard?.channelId),
      messageId: asString(raw.liveLeaderboard?.messageId),
      intervalMinutes: asInt(raw.liveLeaderboard?.intervalMinutes, 10, 1, 1440),
      rows: asInt(raw.liveLeaderboard?.rows, 25, 3, 25),
      title: asString(raw.liveLeaderboard?.title),
    },
  };
}
