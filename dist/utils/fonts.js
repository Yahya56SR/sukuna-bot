"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FONT_STACK = void 0;
exports.ensureFonts = ensureFonts;
exports.ellipsize = ellipsize;
const canvas_1 = require("@napi-rs/canvas");
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
/**
 * Font handling for canvas rank cards — MEE6-style.
 *
 * We try (in order):
 *  1. Bundled fonts in assets/fonts (if present)
 *  2. Runtime fonts in data/fonts
 *  3. System fonts (Arial on Windows, Liberation/DejaVu on Linux)
 *
 * Rendering degrades gracefully: if no custom fonts are present the
 * card still renders with the host's default sans-serif.
 */
const FONTS_DIR = node_path_1.default.join(__dirname, '..', '..', 'assets', 'fonts');
const DATA_FONTS_DIR = node_path_1.default.join(__dirname, '..', '..', 'data', 'fonts');
let ready = false;
const BUNDLED = [
    ['NotoSans-Latin.ttf', 'AtlasSans'],
    ['NotoSans-LatinExt.ttf', 'AtlasSansExt'],
    ['NotoSans-Greek.ttf', 'AtlasGreek'],
    ['NotoSans-Cyrillic.ttf', 'AtlasCyrillic'],
    ['NotoSans-Vietnamese.ttf', 'AtlasVietnamese'],
    ['NotoSansArabic-Regular.ttf', 'AtlasArabic'],
];
const SYSTEM = [
    ['/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf', 'Arial'],
    ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 'Arial'],
    ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 'DejaVu Sans'],
    ['C:/Windows/Fonts/arial.ttf', 'Arial'],
    ['C:/Windows/Fonts/tahoma.ttf', 'Tahoma'],
    ['C:/Windows/Fonts/seguisym.ttf', 'Segoe UI Symbol'],
    ['C:/Windows/Fonts/seguisym.ttf', 'Segoe UI Emoji'],
];
exports.FONT_STACK = [
    'Arial',
    'AtlasSans', 'AtlasSansExt', 'AtlasGreek', 'AtlasCyrillic', 'AtlasVietnamese',
    'AtlasArabic',
    'Tahoma',
    'DejaVu Sans',
    'Segoe UI Emoji',
    'Segoe UI Symbol',
].map((f) => (/\s/.test(f) ? `"${f}"` : f)).join(', ');
function ensureFonts() {
    if (ready)
        return;
    ready = true;
    for (const [file, alias] of [...BUNDLED, ...SYSTEM]) {
        const isSystem = file.startsWith('/') || /^[A-Za-z]:/.test(file);
        const candidates = isSystem
            ? [file]
            : [node_path_1.default.join(FONTS_DIR, file), node_path_1.default.join(DATA_FONTS_DIR, file)];
        try {
            const full = candidates.find((p) => node_fs_1.default.existsSync(p));
            if (full) {
                canvas_1.GlobalFonts.registerFromPath(full, alias);
            }
        }
        catch {
            // best-effort: canvas falls back to system sans-serif
        }
    }
}
function ellipsize(measure, text, maxWidth) {
    if (measure(text) <= maxWidth)
        return text;
    const chars = Array.from(text);
    let end = chars.length;
    while (end > 1 && measure(`${chars.slice(0, end).join('')}…`) > maxWidth)
        end--;
    return `${chars.slice(0, end).join('')}…`;
}
