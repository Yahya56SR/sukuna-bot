"use strict";
/**
 * MEE6-compatible level math.
 *
 * XP required to advance from `level` to `level + 1`:
 *     5 * level^2 + 50 * level + 100
 *
 * MEE6 reference table:
 *   Level 0  -> 1  : 100 XP     (total 0)
 *   Level 1  -> 2  : 155 XP     (total 100)
 *   Level 2  -> 3  : 220 XP     (total 255)
 *   Level 5  -> 6  : 475 XP     (total 1,150)
 *   Level 10 -> 11 : 1,100 XP   (total 4,675)
 *   Level 20 -> 21 : 3,100 XP   (total 23,850)
 *
 * Sukuna keeps its own configurable formulas in LevelingService for XP
 * accounting, but rank cards / leaderboards use this module for the
 * MEE6-style progress display so the visuals match what users expect
 * from MEE6.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.xpForLevel = xpForLevel;
exports.totalXpForLevel = totalXpForLevel;
exports.levelFromXp = levelFromXp;
exports.xpUntilNextLevel = xpUntilNextLevel;
exports.progressPercent = progressPercent;
exports.progressBar = progressBar;
exports.randomXp = randomXp;
/** XP needed to advance from `level` to `level + 1`. */
function xpForLevel(level) {
    return Math.floor(5 * level * level + 50 * level + 100);
}
/** Total XP required to reach `level` from scratch. */
function totalXpForLevel(level) {
    let total = 0;
    for (let i = 0; i < level; i++) {
        total += xpForLevel(i);
    }
    return total;
}
/** Break a total XP value into level + progress. */
function levelFromXp(totalXp) {
    const total = Number.isFinite(totalXp) ? Math.max(0, Math.floor(totalXp)) : 0;
    let level = 0;
    let remaining = total;
    let iterations = 0;
    const MAX_ITERATIONS = 100000;
    while (remaining >= xpForLevel(level)) {
        remaining -= xpForLevel(level);
        level++;
        iterations++;
        if (iterations > MAX_ITERATIONS) {
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
function xpUntilNextLevel(info) {
    return Math.max(0, info.xpForNext - info.xpInLevel);
}
/** Percentage progress toward the next level (0-100). */
function progressPercent(info) {
    if (info.xpForNext <= 0)
        return 100;
    return Math.min(100, Math.floor((info.xpInLevel / info.xpForNext) * 100));
}
/** MEE6-style text progress bar. */
function progressBar(percent, size = 20) {
    const clamped = Math.max(0, Math.min(100, percent));
    const filled = Math.round((clamped / 100) * size);
    return '▰'.repeat(filled) + '▱'.repeat(Math.max(0, size - filled));
}
/**
 * Random XP amount, MEE6 style (15-25 per message by default).
 */
function randomXp(min, max, fixed) {
    const lo = Number.isFinite(min) && min >= 0 ? Math.floor(min) : (fixed !== undefined && Number.isFinite(fixed) ? Math.floor(fixed) : 0);
    const hi = Number.isFinite(max) && max >= 0 ? Math.floor(max) : lo;
    if (hi <= lo)
        return lo;
    return lo + Math.floor(Math.random() * (hi - lo + 1));
}
