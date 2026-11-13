import { createCanvas } from '@napi-rs/canvas';
import type { SKRSContext2D } from '@napi-rs/canvas';
import { ensureFontsAsync, FONT_STACK, EMOJI_STACK, ellipsize } from './fonts';

/**
 * Panel banner artwork — the full-width image that makes a Discord panel
 * look big. Rendered with @napi-rs/canvas so it works without any external
 * image host, and degrades gracefully (the panel simply has no banner) if
 * the canvas runtime is unavailable.
 */

export interface PanelBannerOptions {
  /** Big headline, e.g. `Staff Applications`. */
  title: string;
  /** Small line under the headline, e.g. the server name. */
  subtitle?: string | undefined;
  /** Emoji drawn above the headline. */
  emoji?: string | undefined;
  /** Main accent colour (hex, no `#` needed). */
  accent?: string | undefined;
  /** Secondary accent colour for the glow. */
  accentSecondary?: string | undefined;
  width?: number | undefined;
  height?: number | undefined;
}

const DEFAULT_ACCENT = '#ef4444';
const DEFAULT_ACCENT_SECONDARY = '#f97316';

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '').trim();
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const parsed = Number.parseInt(full.slice(0, 6), 16);
  if (!Number.isFinite(parsed)) return { r: 239, g: 68, b: 68 };
  return { r: (parsed >> 16) & 255, g: (parsed >> 8) & 255, b: parsed & 255 };
}

function rgba(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export async function generatePanelBanner(opts: PanelBannerOptions): Promise<Buffer> {
  await ensureFontsAsync();

  const width = opts.width ?? 1024;
  const height = opts.height ?? 300;
  const accent = opts.accent ?? DEFAULT_ACCENT;
  const accentSecondary = opts.accentSecondary ?? DEFAULT_ACCENT_SECONDARY;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  drawBackground(ctx, width, height, accent, accentSecondary);
  drawDecorations(ctx, width, height, accent, accentSecondary);
  drawText(ctx, opts, width, accent);

  return canvas.toBuffer('image/png');
}

function drawBackground(
  ctx: SKRSContext2D,
  width: number,
  height: number,
  accent: string,
  accentSecondary: string,
): void {
  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, '#0a0f1f');
  bg.addColorStop(0.5, '#111830');
  bg.addColorStop(1, '#080c18');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  // Accent glow — top right.
  const glow = ctx.createRadialGradient(width * 0.86, height * 0.12, 0, width * 0.86, height * 0.12, width * 0.55);
  glow.addColorStop(0, rgba(accent, 0.42));
  glow.addColorStop(0.45, rgba(accentSecondary, 0.16));
  glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  // Bottom accent bar.
  const bar = ctx.createLinearGradient(0, 0, width, 0);
  bar.addColorStop(0, rgba(accent, 0));
  bar.addColorStop(0.5, accent);
  bar.addColorStop(1, rgba(accentSecondary, 0));
  ctx.fillStyle = bar;
  ctx.fillRect(0, height - 6, width, 6);
}

function drawDecorations(
  ctx: SKRSContext2D,
  width: number,
  height: number,
  accent: string,
  accentSecondary: string,
): void {
  ctx.save();

  // Diagonal light streaks.
  ctx.globalAlpha = 0.07;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5;
  for (let i = -6; i < 22; i++) {
    const x = i * 64;
    ctx.beginPath();
    ctx.moveTo(x, height);
    ctx.lineTo(x + height * 0.6, 0);
    ctx.stroke();
  }

  // Dot grid on the right.
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = accentSecondary;
  for (let row = 0; row < 7; row++) {
    for (let col = 0; col < 10; col++) {
      const x = width - 210 + col * 20;
      const y = 46 + row * 20;
      if (x > width - 20) continue;
      ctx.beginPath();
      ctx.arc(x, y, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Soft corner ring.
  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(width - 120, height / 2 + 20, 92, 0, Math.PI * 2);
  ctx.stroke();

  ctx.restore();
}

function drawText(
  ctx: SKRSContext2D,
  opts: PanelBannerOptions,
  width: number,
  accent: string,
): void {
  const centerX = width / 2;
  const maxWidth = width - 140;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Emoji badge.
  let cursorY = 66;
  if (opts.emoji) {
    ctx.font = `54px ${EMOJI_STACK}`;
    ctx.fillText(opts.emoji, centerX, cursorY);
    cursorY += 62;
  }

  // Headline.
  ctx.font = `bold 62px ${FONT_STACK}`;
  const title = ellipsize((t) => ctx.measureText(t).width, opts.title, maxWidth);
  ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
  ctx.shadowBlur = 14;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(title, centerX, cursorY);
  ctx.shadowBlur = 0;

  // Accent underline.
  const underlineWidth = Math.min(maxWidth, Math.max(180, ctx.measureText(title).width * 0.55));
  const underline = ctx.createLinearGradient(centerX - underlineWidth / 2, 0, centerX + underlineWidth / 2, 0);
  underline.addColorStop(0, rgba(accent, 0));
  underline.addColorStop(0.5, accent);
  underline.addColorStop(1, rgba(accent, 0));
  ctx.fillStyle = underline;
  ctx.fillRect(centerX - underlineWidth / 2, cursorY + 44, underlineWidth, 3);

  // Subtitle.
  if (opts.subtitle) {
    ctx.font = `26px ${FONT_STACK}`;
    ctx.fillStyle = '#b7c0d6';
    const subtitle = ellipsize((t) => ctx.measureText(t).width, opts.subtitle, maxWidth);
    ctx.fillText(subtitle, centerX, cursorY + 82);
  }
}
