import { User } from './models/User.js';
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
 * The increment is a single atomic `$inc`. The previous read → mutate →
 * `save()` lost awards whenever a message XP and a voice tick landed together:
 * both read the same base and the second write won.
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
  const granted = Number.isFinite(amount) ? Math.max(0, Math.floor(amount)) : 0;
  const addedMinutes = Number.isFinite(voiceMinutes) ? Math.max(0, Math.floor(voiceMinutes)) : 0;

  const now = new Date();
  const updated = await User.findOneAndUpdate(
    { userId },
    {
      $inc: {
        xp: granted,
        totalXp: granted,
        ...(addedMinutes > 0 ? { voiceMinutes: addedMinutes } : {}),
      },
      ...(source === 'message' ? { $set: { lastMessageAt: now } } : {}),
      // Schema defaults land here on first use, so the row is created with a
      // real `balance: 0` instead of an absent field.
      $setOnInsert: { userId },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  const doc = updated!;
  const totalXp = effectiveXp(doc);
  const oldLevel = levelFromXp(totalXp - granted).level;
  const info = levelFromXp(totalXp);

  // `level` is a pure function of the total, so it is written conditionally on
  // the total we just produced: if a concurrent award already moved it on, that
  // award owns the value and our stale write is skipped instead of clobbering
  // it. Runs only when the level actually changes, so the common path stays a
  // single round trip.
  // The old filter `{ totalXp, xp: totalXp }` never matched legacy rows where
  // `xp >> totalXp` (effective total != stored totalXp), so `level` stayed
  // stale forever. Filter on `level` instead — a concurrent higher level
  // also makes this a no-op — and heal `totalXp`/`xp` to the effective total
  // when they diverge.
  if (doc.level !== info.level) {
    await User.updateOne(
      { userId, level: { $lt: info.level } },
      { $set: { level: info.level } },
    ).catch(() => undefined);
  }
  if ((doc.xp ?? 0) !== totalXp || (doc.totalXp ?? 0) !== totalXp) {
    // Heal the dual-column divergence so leaderboards/ranks (which sort on
    // totalXp) see this user. Guarded to never overwrite a newer higher total.
    await User.updateOne(
      { userId, totalXp: { $lt: totalXp } },
      { $set: { totalXp, xp: totalXp } },
    ).catch(() => undefined);
  }

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
  const next = Number.isFinite(totalXp) ? Math.max(0, Math.floor(totalXp)) : 0;
  const info = levelFromXp(next);

  const before = await User.findOne({ userId }).lean();
  const oldLevel = before ? levelFromXp(effectiveXp(before)).level : 0;

  await User.updateOne(
    { userId },
    {
      $set: { xp: next, totalXp: next, level: info.level },
      $setOnInsert: { userId },
    },
    { upsert: true, setDefaultsOnInsert: true },
  );

  return {
    leveledUp: info.level > oldLevel,
    newLevel: info.level,
    oldLevel,
    totalXp: next,
    info,
  };
}

/**
 * One-time rewrite so `totalXp` matches `effectiveXp` on legacy rows.
 *
 * Older schemas only had `xp`; `totalXp` was added later with a default of 0,
 * so every leaderboard/rank query that sorts on `totalXp` ranks those members
 * as zero. Once this has run — and because every write keeps the two columns
 * equal — leaderboards become a plain indexed query instead of a
 * full-collection aggregation.
 */
export async function backfillUserXp(): Promise<number> {
  let fixed = 0;
  let batch: any[] = [];

  const flush = async (): Promise<void> => {
    if (!batch.length) return;
    const result = await User.collection.bulkWrite(batch, { ordered: false });
    fixed += result.modifiedCount;
    batch = [];
  };

  try {
    const cursor = User.collection.find({
      $expr: { $gt: [{ $ifNull: ['$xp', 0] }, { $ifNull: ['$totalXp', 0] }] },
    });

    for await (const doc of cursor) {
      // Guarded on stored totalXp still being below the source value so a
      // concurrent addXp between cursor read and this write is not clobbered.
      batch.push({
        updateOne: {
          filter: { _id: doc._id, totalXp: { $lt: doc.xp ?? 0 } },
          update: { $set: { totalXp: doc.xp ?? 0 } },
        },
      });
      if (batch.length >= 500) await flush();
    }
    await flush();
  } catch (error) {
    // Never block startup on this: it is a read optimisation, and each user's
    // row self-heals the next time they earn XP.
    return -1;
  }

  return fixed;
}

/** Top members, highest effective XP first (heals legacy xp-only rows). */
export async function getLeaderboard(limit = 10): Promise<XpRow[]> {
  const rows = await User.aggregate([
    { $addFields: { effectiveXp: { $max: [{ $ifNull: ['$xp', 0] }, { $ifNull: ['$totalXp', 0] }] } } },
    { $match: { effectiveXp: { $gt: 0 } } },
    { $sort: { effectiveXp: -1, userId: 1 } },
    { $limit: Math.max(1, limit) },
  ]).allowDiskUse(true);

  return rows.map((row: any) => {
    const xp = effectiveXp(row);
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
    $expr: { $gt: [{ $max: [{ $ifNull: ['$xp', 0] }, { $ifNull: ['$totalXp', 0] }] }, xp] },
  });
  return higher + 1;
}

/** How many members have an XP record (i.e. are ranked). */
export async function countRanked(): Promise<number> {
  return User.countDocuments({
    $expr: { $gt: [{ $max: [{ $ifNull: ['$xp', 0] }, { $ifNull: ['$totalXp', 0] }] }, 0] },
  });
}
