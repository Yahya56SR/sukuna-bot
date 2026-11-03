import { User, getUser } from './models/User.js';
import { levelFromXp, xpForLevel, type LevelInfo } from '../utils/level.js';

export { xpForLevel };

/** Total XP stored on a user row, tolerating legacy `xp`-only documents. */
export function effectiveXp(doc: {
  xp?: number | null;
  totalXp?: number | null;
}): number {
  const xp = Number.isFinite(doc.xp) ? Math.max(0, Math.floor(doc.xp as number)) : 0;
  const totalXp = Number.isFinite(doc.totalXp)
    ? Math.max(0, Math.floor(doc.totalXp as number))
    : 0;
  return Math.max(xp, totalXp);
}

/** BSON-side equivalent of {@link effectiveXp} for aggregations. */
const EFFECTIVE_XP_EXPRESSION = {
  $max: [{ $ifNull: ['$totalXp', 0] }, { $ifNull: ['$xp', 0] }],
};

export interface UserXpRow {
  userId: string;
  xp: number;
  level: number;
  lastMessageAt?: Date;
}

export interface XpRow {
  user_id: string;
  xp: number;
  level: number;
}

export interface AddXpResult {
  leveledUp: boolean;
  newLevel: number;
  oldLevel: number;
  totalXp: number;
  info: LevelInfo;
}

/**
 * Read the total XP for one user without creating a row.
 */
export async function getUserXp(userId: string): Promise<UserXpRow | null> {
  const doc = await User.findOne({ userId }).lean();
  if (!doc) return null;
  const xp = effectiveXp(doc);
  return {
    userId: doc.userId,
    xp,
    level: levelFromXp(xp).level,
    lastMessageAt: doc.lastMessageAt ?? undefined,
  };
}

/**
 * Grant XP and derive the new level from the stored total.
 *
 * The level is derived from the XP total rather than trusted from the row:
 * dashboard edits can leave `level` out of sync with `xp`, and a stale (too
 * high) level would swallow every future level-up, so no reward role would
 * ever be given.
 */
export async function addXp(
  userId: string,
  amount: number,
  source: 'message' | 'voice' | 'admin' | 'other' = 'message',
  voiceMinutes = 0,
): Promise<AddXpResult> {
  const user = await getUser(userId);
  const baseXp = effectiveXp(user);
  const oldLevel = levelFromXp(baseXp).level;
  const granted = Number.isFinite(amount) ? Math.max(0, Math.floor(amount)) : 0;
  const totalXp = baseXp + granted;

  user.xp = totalXp;
  user.totalXp = totalXp;
  user.level = levelFromXp(totalXp).level;

  if (source === 'message') user.lastMessageAt = new Date();
  const addedMinutes = Number.isFinite(voiceMinutes) ? Math.max(0, Math.floor(voiceMinutes)) : 0;
  if (addedMinutes > 0) {
    user.voiceMinutes = (Number.isFinite(user.voiceMinutes) ? user.voiceMinutes : 0) + addedMinutes;
  }

  await user.save();

  const info = levelFromXp(totalXp);
  return {
    leveledUp: info.level > oldLevel,
    newLevel: info.level,
    oldLevel,
    totalXp,
    info,
  };
}

/**
 * Overwrite a user's total XP (dashboard / admin edits) and re-derive the level.
 */
export async function setUserXp(
  userId: string,
  totalXp: number,
): Promise<AddXpResult> {
  const user = await getUser(userId);
  const oldLevel = levelFromXp(effectiveXp(user)).level;
  const next = Number.isFinite(totalXp) ? Math.max(0, Math.floor(totalXp)) : 0;

  user.xp = next;
  user.totalXp = next;
  user.level = levelFromXp(next).level;
  await user.save();

  const info = levelFromXp(next);
  return {
    leveledUp: info.level > oldLevel,
    newLevel: info.level,
    oldLevel,
    totalXp: next,
    info,
  };
}

/** Top members, highest total XP first. */
export async function getLeaderboard(limit = 10): Promise<XpRow[]> {
  const rows = await User.aggregate([
    { $addFields: { effectiveXp: EFFECTIVE_XP_EXPRESSION } },
    { $match: { effectiveXp: { $gt: 0 } } },
    { $sort: { effectiveXp: -1, userId: 1 } },
    { $limit: Math.max(1, limit) },
  ]);

  return rows.map((row) => {
    const xp = effectiveXp({ xp: row.xp, totalXp: row.effectiveXp });
    return {
      user_id: row.userId as string,
      xp,
      level: levelFromXp(xp).level,
    };
  });
}

/**
 * 1-based position of a user on the XP leaderboard, or 0 when unranked.
 */
export async function getRankPosition(userId: string): Promise<number> {
  const doc = await User.findOne({ userId }).lean();
  if (!doc) return 0;

  const xp = effectiveXp(doc);
  if (xp <= 0) return 0;

  const higher = await User.countDocuments({
    $expr: { $gt: [EFFECTIVE_XP_EXPRESSION, xp] },
  });
  return higher + 1;
}

/** How many members have an XP record (i.e. are ranked). */
export async function countRanked(): Promise<number> {
  return User.countDocuments({
    $expr: { $gt: [EFFECTIVE_XP_EXPRESSION, 0] },
  });
}
