import { GlobalFonts } from '@napi-rs/canvas';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Font handling for every canvas render (rank cards, welcome cards, panel
 * banners, leaderboard podiums).
 *
 * Resolution order for a glyph:
 *   1. fonts bundled in `assets/fonts`
 *   2. fonts downloaded at runtime into `data/fonts`
 *   3. system fonts (Windows / Linux / macOS)
 *
 * Any font in the catalog that is missing locally is **downloaded
 * automatically** the first time a canvas is rendered, so a bare Linux
 * container still draws Arabic names, symbols and colour emoji instead of
 * empty boxes. Downloads are best-effort: a failure never breaks a render,
 * the card just falls back to the system font.
 */

const ASSETS_FONTS_DIR = path.join(__dirname, '..', '..', 'assets', 'fonts');
const DATA_FONTS_DIR = path.join(__dirname, '..', '..', 'data', 'fonts');

export interface FontDescriptor {
  /** File name inside the fonts folder. */
  file: string;
  /** Alias the font is registered under. */
  alias: string;
  /** Download URL — the font is fetched when it is missing locally. */
  url?: string;
  /** Extra system locations to look for before downloading. */
  systemPaths?: string[];
  /** Only used on these platforms. */
  platforms?: NodeJS.Platform[];
  /** Big fonts are only downloaded when `includeOptional` is set. */
  optional?: boolean;
}

const NOTO = 'https://cdn.jsdelivr.net/gh/notofonts/noto-fonts@main/hinted/ttf';

/**
 * The full font catalog. Everything here can be downloaded on demand and is
 * registered under the alias shown, which is then used by the font stack.
 */
export const FONT_CATALOG: FontDescriptor[] = [
  // --- Core latin / greek / cyrillic -------------------------------------
  {
    file: 'NotoSans-Regular.ttf',
    alias: 'NotoSans',
    url: `${NOTO}/NotoSans/NotoSans-Regular.ttf`,
    systemPaths: [
      '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
      '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
      '/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf',
      'C:/Windows/Fonts/arial.ttf',
      'C:/Windows/Fonts/segoeui.ttf',
      '/System/Library/Fonts/Helvetica.ttc',
    ],
  },
  {
    file: 'NotoSans-Bold.ttf',
    alias: 'NotoSansBold',
    url: `${NOTO}/NotoSans/NotoSans-Bold.ttf`,
    systemPaths: [
      '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
      '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
      'C:/Windows/Fonts/arialbd.ttf',
      'C:/Windows/Fonts/segoeuib.ttf',
    ],
  },
  {
    file: 'NotoSerif-Regular.ttf',
    alias: 'NotoSerif',
    url: `${NOTO}/NotoSerif/NotoSerif-Regular.ttf`,
    systemPaths: [
      '/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf',
      'C:/Windows/Fonts/georgia.ttf',
      'C:/Windows/Fonts/times.ttf',
    ],
  },
  {
    file: 'NotoSansMono-Regular.ttf',
    alias: 'NotoSansMono',
    url: `${NOTO}/NotoSansMono/NotoSansMono-Regular.ttf`,
    systemPaths: [
      '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf',
      'C:/Windows/Fonts/consola.ttf',
      'C:/Windows/Fonts/cour.ttf',
    ],
  },

  // --- Symbols, blocks and math ------------------------------------------
  {
    file: 'NotoSansSymbols2-Regular.ttf',
    alias: 'NotoSansSymbols2',
    url: `${NOTO}/NotoSansSymbols2/NotoSansSymbols2-Regular.ttf`,
  },
  {
    file: 'NotoSansSymbols-Regular.ttf',
    alias: 'NotoSansSymbols',
    url: `${NOTO}/NotoSansSymbols/NotoSansSymbols-Regular.ttf`,
  },
  {
    file: 'NotoSansMath-Regular.ttf',
    alias: 'NotoSansMath',
    url: `${NOTO}/NotoSansMath/NotoSansMath-Regular.ttf`,
  },

  // --- Scripts -----------------------------------------------------------
  {
    file: 'NotoSansArabic-Regular.ttf',
    alias: 'NotoSansArabic',
    url: `${NOTO}/NotoSansArabic/NotoSansArabic-Regular.ttf`,
    systemPaths: [
      '/usr/share/fonts/truetype/noto/NotoSansArabic-Regular.ttf',
      'C:/Windows/Fonts/tahoma.ttf',
      'C:/Windows/Fonts/segoeui.ttf',
    ],
  },
  {
    file: 'NotoSansArabic-Bold.ttf',
    alias: 'NotoSansArabicBold',
    url: `${NOTO}/NotoSansArabic/NotoSansArabic-Bold.ttf`,
    systemPaths: ['C:/Windows/Fonts/tahomabd.ttf'],
  },
  {
    file: 'NotoNaskhArabic-Regular.ttf',
    alias: 'NotoNaskhArabic',
    url: `${NOTO}/NotoNaskhArabic/NotoNaskhArabic-Regular.ttf`,
  },
  {
    file: 'NotoSansHebrew-Regular.ttf',
    alias: 'NotoSansHebrew',
    url: `${NOTO}/NotoSansHebrew/NotoSansHebrew-Regular.ttf`,
  },
  {
    file: 'NotoSansDevanagari-Regular.ttf',
    alias: 'NotoSansDevanagari',
    url: `${NOTO}/NotoSansDevanagari/NotoSansDevanagari-Regular.ttf`,
  },
  {
    file: 'NotoSansThai-Regular.ttf',
    alias: 'NotoSansThai',
    url: `${NOTO}/NotoSansThai/NotoSansThai-Regular.ttf`,
  },

  // --- Emoji -------------------------------------------------------------
  {
    file: 'NotoColorEmoji.woff',
    alias: 'NotoColorEmoji',
    url: 'https://cdn.jsdelivr.net/npm/@fontsource/noto-color-emoji@5.2.5/files/noto-color-emoji-emoji-400-normal.woff',
    optional: true,
  },
  {
    file: 'NotoEmoji.woff',
    alias: 'NotoEmoji',
    url: 'https://cdn.jsdelivr.net/npm/@fontsource/noto-emoji@5.2.5/files/noto-emoji-emoji-400-normal.woff',
    optional: true,
  },

  // --- Windows symbol fonts (nice when present) --------------------------
  {
    file: 'seguisym.ttf',
    alias: 'SegoeUISymbol',
    systemPaths: ['C:/Windows/Fonts/seguisym.ttf', 'C:/Windows/Fonts/seguissym.ttf'],
    platforms: ['win32'],
  },
  {
    file: 'segoeui-emoji.ttf',
    alias: 'SegoeUIEmoji',
    systemPaths: ['C:/Windows/Fonts/seguiemj.ttf'],
    platforms: ['win32'],
  },
];

/**
 * Fonts that ship with the repo (optional). They win over downloads because
 * they are always present.
 */
const BUNDLED: Array<[string, string]> = [
  ['NotoSans-Latin.ttf', 'AtlasSans'],
  ['NotoSans-LatinExt.ttf', 'AtlasSansExt'],
  ['NotoSans-Greek.ttf', 'AtlasGreek'],
  ['NotoSans-Cyrillic.ttf', 'AtlasCyrillic'],
  ['NotoSans-Vietnamese.ttf', 'AtlasVietnamese'],
  ['NotoSansArabic-Regular.ttf', 'AtlasArabic'],
];

/**
 * The stack every canvas render uses. The first font that has the glyph
 * wins, so the order goes: sans → symbols → emoji → scripts → system.
 */
export const FONT_STACK = [
  'NotoSans',
  'NotoSansBold',
  'NotoSerif',
  'NotoSansSymbols2',
  'NotoSansSymbols',
  'NotoSansMath',
  'NotoColorEmoji',
  'NotoEmoji',
  'SegoeUIEmoji',
  'SegoeUISymbol',
  'NotoSansArabic',
  'NotoSansArabicBold',
  'NotoNaskhArabic',
  'NotoSansHebrew',
  'NotoSansDevanagari',
  'NotoSansThai',
  'NotoSansMono',
  'AtlasSans',
  'AtlasSansExt',
  'AtlasGreek',
  'AtlasCyrillic',
  'AtlasVietnamese',
  'AtlasArabic',
  'Arial',
  'Tahoma',
  'DejaVu Sans',
  'Apple Color Emoji',
  'sans-serif',
].map((f) => (/\s/.test(f) ? `"${f}"` : f)).join(', ');

/** Emoji-only stack — used when an image should show a single glyph. */
export const EMOJI_STACK = [
  'NotoColorEmoji',
  'NotoEmoji',
  'SegoeUIEmoji',
  'Apple Color Emoji',
  'NotoSansSymbols2',
  'NotoSansSymbols',
  'sans-serif',
].map((f) => (/\s/.test(f) ? `"${f}"` : f)).join(', ');

let ready = false;
let downloadPromise: Promise<void> | null = null;

function fontDirs(): string[] {
  return [ASSETS_FONTS_DIR, DATA_FONTS_DIR];
}

function registerFile(file: string, alias: string): boolean {
  try {
    const full = file;
    if (!fs.existsSync(full)) return false;
    const result = GlobalFonts.registerFromPath(full, alias);
    return Boolean(result);
  } catch {
    return false;
  }
}

/**
 * Registers every font that is available locally: bundled assets, previously
 * downloaded fonts and system fonts. Synchronous and safe to call often.
 */
export function ensureFonts(): void {
  if (ready) return;
  ready = true;

  for (const [file, alias] of BUNDLED) {
    for (const dir of fontDirs()) {
      if (registerFile(path.join(dir, file), alias)) break;
    }
  }

  for (const font of FONT_CATALOG) {
    if (font.platforms && !font.platforms.includes(process.platform)) continue;

    // A downloaded copy first.
    for (const dir of fontDirs()) {
      if (registerFile(path.join(dir, font.file), font.alias)) break;
    }

    // Then any known system location.
    for (const candidate of font.systemPaths ?? []) {
      if (registerFile(candidate, font.alias)) break;
    }
  }
}

async function downloadFile(url: string, target: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'follow' });
    if (!response.ok) return false;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length < 1024) return false;
    const temp = `${target}.part`;
    fs.writeFileSync(temp, buffer);
    fs.renameSync(temp, target);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Downloads the fonts that are missing locally and registers them.
 *
 * Runs at most once per process — concurrent callers share the same promise.
 * Never throws: a missing font only means the canvas falls back to the next
 * font in the stack.
 */
export async function ensureFontsAsync(options?: {
  includeOptional?: boolean;
  logger?: { info?: (msg: string) => void; warn?: (msg: string) => void };
  timeoutMs?: number;
}): Promise<void> {
  ensureFonts();
  if (downloadPromise) return downloadPromise;

  const includeOptional = options?.includeOptional ?? false;
  const logger = options?.logger;

  downloadPromise = (async () => {
    try {
      fs.mkdirSync(DATA_FONTS_DIR, { recursive: true });
    } catch {
      return;
    }

    const missing = FONT_CATALOG.filter((font) => {
      if (!font.url) return false;
      if (font.optional && !includeOptional) return false;
      if (font.platforms && !font.platforms.includes(process.platform)) return false;
      return !fontDirs().some((dir) => fs.existsSync(path.join(dir, font.file)));
    });

    if (!missing.length) return;

    logger?.info?.(`Fonts: downloading ${missing.length} missing font(s)…`);

    // Small concurrency so a slow mirror does not block the whole queue.
    const queue = [...missing];
    const workers = Array.from({ length: Math.min(3, queue.length) }, async () => {
      while (queue.length) {
        const font = queue.shift();
        if (!font) return;
        const target = path.join(DATA_FONTS_DIR, font.file);
        const ok = await downloadFile(font.url as string, target);
        if (ok) {
          registerFile(target, font.alias);
          logger?.info?.(`Fonts: downloaded ${font.file}`);
        } else {
          logger?.warn?.(`Fonts: could not download ${font.file}`);
        }
      }
    });

    await Promise.all(workers);
  })().finally(() => {
    downloadPromise = null;
  });

  return downloadPromise;
}

export interface FontStatus {
  alias: string;
  file: string;
  available: boolean;
  optional: boolean;
}

/** Which fonts are ready — surfaced in the dashboard. */
export function fontStatus(): FontStatus[] {
  ensureFonts();
  return FONT_CATALOG.map((font) => ({
    alias: font.alias,
    file: font.file,
    available: fontDirs().some((dir) => fs.existsSync(path.join(dir, font.file)))
      || (font.systemPaths ?? []).some((candidate) => fs.existsSync(candidate)),
    optional: Boolean(font.optional),
  }));
}

export function ellipsize(measure: (text: string) => number, text: string, maxWidth: number): string {
  if (measure(text) <= maxWidth) return text;
  const chars = Array.from(text);
  let end = chars.length;
  while (end > 1 && measure(`${chars.slice(0, end).join('')}…`) > maxWidth) end--;
  return `${chars.slice(0, end).join('')}…`;
}

/* --------------------------------------------------------------------------
 * Canvas text safety
 *
 * The card fonts (Arial / Noto / DejaVu) do not contain the "mathematical
 * alphanumeric" block, so a display name like `𝓘𝓼𝓶𝓪𝓲𝓵` is drawn as a row
 * of empty boxes. NFKC compatibility normalisation folds every styled
 * letter (mathematical bold/italic/script/fraktur, fullwidth forms, …) back
 * to plain ASCII, so the name always renders.
 * ------------------------------------------------------------------------ */

/**
 * Folds fancy unicode that the card fonts cannot draw back to plain text:
 * mathematical letters/digits, fullwidth forms, zero-width characters.
 */
export function normalizeCanvasText(text: string): string {
  if (!text) return '';
  const folded = text.normalize('NFKC');
  let out = '';
  for (const char of Array.from(folded)) {
    const code = char.codePointAt(0) ?? 0;
    // Zero-width and invisible formatting characters.
    if (code === 0x200b || code === 0x200c || code === 0x200d || code === 0xfeff) continue;
    // Variation selectors (emoji presentation).
    if (code >= 0xfe00 && code <= 0xfe0f) continue;
    out += char;
  }
  return out;
}
