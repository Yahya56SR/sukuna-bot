/**
 * Minimal, dependency-free 5-field cron parser.
 * Fields: minute hour day-of-month month day-of-week
 * Supports: `*`  lists `a,b`  ranges `a-b`  steps `*\/n`, `a-b\/n`, `n\/n`
 * day-of-week: 0-7 (0 and 7 are Sunday), names SUN..SAT also accepted.
 * month: 1-12, names JAN..DEC accepted.
 * When both day-of-month and day-of-week are restricted, a match on either
 * field satisfies the day check (standard cron OR semantics).
 */

const MONTH_NAMES = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

interface ParsedField {
  /** Matches every value in the field range. */
  any: boolean;
  /** Explicit integer values (sorted). */
  values: number[];
}

export interface ParsedCron {
  minute: ParsedField;
  hour: ParsedField;
  dayOfMonth: ParsedField;
  month: ParsedField;
  dayOfWeek: ParsedField;
}

function parseField(field: string, min: number, max: number, names: string[], offset = 0): ParsedField {
  const text = field.trim();
  if (text === '') throw new Error('Empty cron field');
  const tokens = text.split(',');
  const values = new Set<number>();
  let any = false;

  for (const raw of tokens) {
    const token = raw.trim();
    const [rangePart, stepPart] = token.split('/');
    if (!rangePart || rangePart === '') throw new Error(`Invalid cron token: "${token}"`);
    const step = stepPart !== undefined ? Number(stepPart) : 1;
    if (!Number.isInteger(step) || step < 1) throw new Error(`Invalid cron step in "${token}"`);

    let lo: number;
    let hi: number;
    const normalizedPart = rangePart.trim() === '*' ? '*' : rangePart.trim();

    if (normalizedPart === '*') {
      lo = min;
      hi = max;
      if (step === 1 && tokens.length === 1) any = true;
    } else if (normalizedPart.includes('-')) {
      const [a, b] = normalizedPart.split('-');
      if (a === undefined || b === undefined) throw new Error(`Invalid cron range: "${token}"`);
      lo = namedValue(a, names, offset);
      hi = namedValue(b, names, offset);
    } else {
      lo = namedValue(normalizedPart, names, offset);
      hi = stepPart !== undefined ? max : lo;
    }

    if (Number.isNaN(lo) || Number.isNaN(hi)) throw new Error(`Invalid cron value in "${token}"`);
    if (lo < min || hi > max || lo > hi) throw new Error(`Cron value out of range in "${token}"`);
    for (let value = lo; value <= hi; value += step) values.add(value);
  }

  const sorted = [...values].sort((a, b) => a - b);
  return { any, values: sorted };
}

function namedValue(raw: string, names: string[], offset: number): number {
  const t = raw.trim().toUpperCase();
  const index = names.indexOf(t);
  const value = index >= 0 ? index + 1 + offset : Number(t);
  return value;
}

function normalizeWeekday(field: ParsedField): ParsedField {
  // Map 7 → 0 (both are Sunday) and dedupe.
  if (!field.values.includes(7)) return field;
  const mapped = new Set<number>();
  for (const v of field.values) mapped.add(v === 7 ? 0 : v);
  return { any: field.any, values: [...mapped].sort((a, b) => a - b) };
}

export function parseCron(expression: string): ParsedCron {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`Expected 5 cron fields, got ${parts.length}. Example: "0 9 * * *"`);
  const [minute, hour, dom, month, dow] = parts as [string, string, string, string, string];
  return {
    minute: parseField(minute, 0, 59, []),
    hour: parseField(hour, 0, 23, []),
    dayOfMonth: parseField(dom, 1, 31, []),
    month: parseField(month, 1, 12, MONTH_NAMES, 0),
    dayOfWeek: normalizeWeekday(parseField(dow, 0, 7, DAY_NAMES, -1)),
  };
}

function fieldMatches(field: ParsedField, value: number): boolean {
  return field.any || field.values.includes(value);
}

export function cronMatches(parsed: ParsedCron, date: Date): boolean {
  if (!fieldMatches(parsed.minute, date.getMinutes())) return false;
  if (!fieldMatches(parsed.hour, date.getHours())) return false;
  if (!fieldMatches(parsed.month, date.getMonth() + 1)) return false;

  const domRestricted = !parsed.dayOfMonth.any;
  const dowRestricted = !parsed.dayOfWeek.any;
  const domMatch = fieldMatches(parsed.dayOfMonth, date.getDate());
  const dowMatch = fieldMatches(parsed.dayOfWeek, date.getDay());
  if (domRestricted && dowRestricted) return domMatch || dowMatch;
  return domMatch && dowMatch;
}

/** Next run time strictly after `from` (defaults to now). */
export function nextCron(expression: string, from: Date = new Date()): Date {
  const parsed = parseCron(expression);
  // Start at the next minute, seconds zeroed.
  const cursor = new Date(from.getTime());
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);

  const limit = new Date(cursor.getTime());
  limit.setFullYear(limit.getFullYear() + 5);

  while (cursor < limit) {
    if (cronMatches(parsed, cursor)) return new Date(cursor.getTime());
    cursor.setMinutes(cursor.getMinutes() + 1);
  }
  throw new Error(`Cron expression "${expression}" has no occurrence within 5 years`);
}

/** True when the expression can be parsed. */
export function isValidCron(expression: string): boolean {
  try {
    parseCron(expression);
    return true;
  } catch {
    return false;
  }
}
