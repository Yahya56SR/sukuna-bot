/**
 * MEE6-compatible level math.
 *
 * XP required to advance from `level` to `level + 1`:
 *     5 * level^2 + 50 * level + 100
 *
 * MEE6 reference table (XP to reach the level):
 *   Level 1  : 100 XP       (0 -> 1 costs 100)
 *   Level 2  : 255 XP       (1 -> 2 costs 155)
 *   Level 3  : 475 XP       (2 -> 3 costs 220)
 *   Level 5  : 1,150 XP     (4 -> 5 costs 380)
 *   Level 10 : 4,675 XP     (9 -> 10 costs 955)
 *   Level 20 : 23,850 XP    (19 -> 20 costs 2,855)
 */

export interface LevelInfo {
  /** Current level */
  level: number;
  /** XP earned within the current level */
  xpInLevel: number;
  /** XP required to reach the next level */
  xpForNext: number;
  /** Total XP accumulated */
  totalXp: number;
}

/** XP needed to advance from `level` to `level + 1`. */
export function xpForLevel(level: number): number {
  return Math.floor(5 * level * level + 50 * level + 100);
}

/** Total XP required to reach `level` from scratch. */
export function totalXpForLevel(level: number): number {
  let total = 0;
  for (let i = 0; i < level; i++) {
    total += xpForLevel(i);
  }
  return total;
}

/** Break a total XP value into level + progress. */
export function levelFromXp(totalXp: number): LevelInfo {
  // A NaN/Infinity XP value (corrupt db row) would otherwise produce
  // `xpInLevel: NaN` and `xpForNext: NaN` for every embed and rank card.
  const total = Number.isFinite(totalXp) ? Math.max(0, Math.floor(totalXp)) : 0;
  let level = 0;
  let remaining = total;

  // Use a loop with a safety limit to prevent infinite loops.
  // Max level with 32-bit safe integers is around level 30000.
  let iterations = 0;
  const MAX_ITERATIONS = 100000;

  while (remaining >= xpForLevel(level)) {
    remaining -= xpForLevel(level);
    level++;
    iterations++;
    if (iterations > MAX_ITERATIONS) {
      console.error('levelFromXp: Max iterations exceeded, breaking loop');
      break;
    }
  }

  return {
    level,
    xpInLevel: remaining,
    xpForNext: xpForLevel(level),
    totalXp: total,
  };
}

/** XP still required to reach the next level. */
export function xpUntilNextLevel(info: LevelInfo): number {
  return Math.max(0, info.xpForNext - info.xpInLevel);
}

/** Percentage progress toward the next level (0-100). */
export function progressPercent(info: LevelInfo): number {
  if (info.xpForNext <= 0) return 100;
  return Math.min(100, Math.floor((info.xpInLevel / info.xpForNext) * 100));
}

/** MEE6-style text progress bar. */
export function progressBar(percent: number, size = 20): string {
  const clamped = Math.max(0, Math.min(100, percent));
  const filled = Math.round((clamped / 100) * size);
  return '▰'.repeat(filled) + '▱'.repeat(Math.max(0, size - filled));
}

/**
 * Random XP amount, MEE6 style (15-25 per message by default).
 * Falls back to `fixed` when the range is missing or invalid.
 */
export function randomXp(min: number, max: number, fixed?: number): number {
  const lo =
    Number.isFinite(min) && min >= 0
      ? Math.floor(min)
      : fixed !== undefined && Number.isFinite(fixed)
        ? Math.floor(fixed)
        : 0;
  const hi = Number.isFinite(max) && max >= 0 ? Math.floor(max) : lo;
  if (hi <= lo) return lo;
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}
