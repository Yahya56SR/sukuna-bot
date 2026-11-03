export function xpForLevel(level: number): number {
  return Math.floor(5 * Math.pow(level, 2) + 50 * level + 100);
}
