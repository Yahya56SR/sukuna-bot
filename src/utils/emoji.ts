/**
 * Custom emoji catalog — panels use the bot's own server emojis so every
 * panel looks identical everywhere, instead of plain unicode that renders
 * differently per platform.
 *
 * Resolution order for a key:
 *   1. a direct override (`key = <a:name:id>` in the dashboard)
 *   2. an alias that matches an emoji in the bot's emoji server (`key = name`)
 *   3. the bot's own emoji below
 */

export interface CustomEmoji {
  id: string;
  name: string;
  animated?: boolean;
}

/** Every semantic emoji a panel can ask for. */
export const PANEL_EMOJI_KEYS = [
  'staff', 'staffTeam', 'designer', 'developer', 'eventHost', 'partnership',
  'ticket', 'tempvc', 'giveaway', 'support', 'pub', 'bug', 'abuse', 'server',
  'staffReport', 'donate', 'link', 'mouse', 'check', 'cross', 'warning',
  'member', 'question', 'clock', 'sparkles', 'voice', 'settings', 'role',
  'home', 'arrow', 'ping', 'rules', 'ban', 'mute', 'kick', 'clear', 'wave',
  'eye', 'lock', 'unlock', 'trash', 'pencil', 'crown', 'shield', 'logo',
  'medal1', 'medal2', 'medal3', 'trophy', 'diamond', 'gold', 'silver',
  'members', 'bolt', 'refresh', 'newBadge', 'upArrow', 'gift', 'hourglass',
  'list', 'info', 'folder', 'chart', 'target',
] as const;

export type PanelEmojiKey = typeof PANEL_EMOJI_KEYS[number];

/** The bot's own emoji — used when no override is mapped. */
export const EMOJI_FALLBACKS: Record<PanelEmojiKey, string> = {
  staff: '<:trial_admin:1570774095509856390>',
  staffTeam: '<:staffTeam:1570774083510210560>',
  designer: '<:designer:1570773989624774676>',
  developer: '<:developer:1570773993672151041>',
  eventHost: '<:eventHost:1570773998285889576>',
  partnership: '<:partnership:1570774035854524546>',
  ticket: '<:ticket:1570774090027900928>',
  tempvc: '<:tempvc:1570774087448658030>',
  giveaway: '<:giveaway:1570774003759718442>',
  support: '<:VOID:1570774101469962311>',
  pub: '<:pub:1570774053487386704>',
  bug: '<:bug:1570773968779214969>',
  abuse: '<:abuse:1570773960495337523>',
  server: '<:server:1570774069035405362>',
  staffReport: '<:staffReport:1570774081698009168>',
  donate: '<:donate:1570774150547636307>',
  link: '<:link:1570774009476415519>',
  mouse: '<:bot:1570773966509842603>',
  check: '<:check:1570773971161579653>',
  cross: '<:cross:1570773985908621392>',
  warning: '<:warning:1570774108927561798>',
  member: '<:member:1570774030284488846>',
  question: '<:question:1570774057551659078>',
  clock: '<:clock:1570773975313809488>',
  sparkles: '<:sparkles:1570774077772140574>',
  voice: '<:voice:1570774099469279252>',
  settings: '<:settings:1570774073292623922>',
  role: '<:role:1570774063662760036>',
  home: '<:home:1570774005479121088>',
  arrow: '<:arrow:1570773962802073660>',
  ping: '<:ping:1570774051259945001>',
  rules: '<:rules:1570774065847869480>',
  ban: '<:ban:1570773964488310905>',
  mute: '<:muted:1570774032381386892>',
  kick: '<:kick:1570774007056306196>',
  clear: '<:clear:1570773973011267745>',
  wave: '<:wave:1570774111569977364>',
  eye: '<:eye:1570774001347862628>',
  lock: '<:locked:1570774024600952932>',
  unlock: '<:unlock:1570774097674240031>',
  trash: '<:trash:1570774092989079552>',
  pencil: '<:pencil:1570774049548795904>',
  crown: '<:crown:1570773987984810014>',
  shield: '<:shield:1570774075331317770>',
  logo: '<:logo:1570774028635869345>',
  medal1: '🥇',
  medal2: '🥈',
  medal3: '🥉',
  trophy: '🏆',
  diamond: '💎',
  gold: '🏅',
  silver: '⚪',
  members: '👥',
  bolt: '⚡',
  refresh: '🔄',
  newBadge: '🆕',
  upArrow: '▲',
  gift: '🎁',
  hourglass: '⏳',
  list: '📋',
  info: 'ℹ️',
  folder: '📁',
  chart: '📊',
  target: '🎯',
};

/** Lower-cased lookup so `staffTeam` and `staffteam` both resolve. */
const FALLBACK_LOOKUP = new Map<string, string>(
  Object.entries(EMOJI_FALLBACKS).map(([key, value]) => [key.toLowerCase(), value]),
);

export class EmojiRegistry {
  /** Custom emoji from the bot's emoji server: name -> `<a:name:id>`. */
  private byName = new Map<string, string>();
  /** Semantic key -> custom emoji name. */
  private aliases = new Map<string, string>();
  /** Semantic key -> literal emoji (admin override). */
  private direct = new Map<string, string>();

  public setCustomEmojis(emojis: CustomEmoji[]): number {
    this.byName.clear();
    for (const emoji of emojis) {
      if (!emoji?.name || !emoji?.id) continue;
      const marker = emoji.animated ? 'a' : '';
      this.byName.set(emoji.name.toLowerCase(), `<${marker}:${emoji.name}:${emoji.id}>`);
    }
    return this.byName.size;
  }

  /** `key = name` pairs — the name must exist in the emoji server. */
  public setAliases(aliases: Record<string, string>): void {
    this.aliases.clear();
    for (const [key, value] of Object.entries(aliases ?? {})) {
      const name = String(value ?? '').trim();
      if (key && name) this.aliases.set(key.trim().toLowerCase(), name);
    }
  }

  /** `key = <a:name:id>` pairs — used verbatim. */
  public setDirect(overrides: Record<string, string>): void {
    this.direct.clear();
    for (const [key, value] of Object.entries(overrides ?? {})) {
      const literal = String(value ?? '').trim();
      if (key && literal) this.direct.set(key.trim().toLowerCase(), literal);
    }
  }

  public getCustomEmojiCount(): number {
    return this.byName.size;
  }

  /** Every custom emoji the bot can use — used by the dashboard picker. */
  public listCustomEmojis(): { name: string; value: string }[] {
    return [...this.byName.entries()]
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Resolves a semantic key to a renderable emoji. */
  public get(key: string): string {
    const normalized = String(key ?? '').trim().toLowerCase();
    if (!normalized) return '';

    const direct = this.direct.get(normalized);
    if (direct) return direct;

    const alias = this.aliases.get(normalized);
    if (alias) {
      const custom = this.byName.get(alias.toLowerCase());
      if (custom) return custom;
    }

    const fallback = FALLBACK_LOOKUP.get(normalized);
    if (fallback) return fallback;

    // Unknown key — pass it through so literal unicode still works.
    return String(key).trim();
  }

  /** Every known key with its resolved emoji — handy for the dashboard. */
  public snapshot(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const key of PANEL_EMOJI_KEYS) out[key] = this.get(key);
    return out;
  }
}

/** Shared registry — populated by the panel service when the bot logs in. */
export const emojiRegistry = new EmojiRegistry();

/**
 * Resolves either a semantic key (`ticket`) or a literal emoji
 * (`🍺`, `<:name:id>`). Literal values are returned untouched.
 */
export function emoji(value: string): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (raw.startsWith('<') || raw.startsWith(':')) return raw;
  return emojiRegistry.get(raw);
}

/** Alias of {@link emoji} — used by the panel kit. */
export const resolveEmoji = emoji;
