import { describe, it, expect } from 'vitest';
import { ensureFontsAsync, fontStatus, normalizeCanvasText, FONT_CATALOG } from '../src/utils/fonts';
import { generatePanelBanner } from '../src/utils/panelBanner';
import { leaderboardPodium } from '../src/utils/rankcard';
import fs from 'node:fs';
import path from 'node:path';

const OUT_DIR = path.join(process.env.TEMP || process.cwd(), 'sukuna-font-preview');

describe('font system', () => {
  it('downloads missing fonts and renders them', async () => {
    await ensureFontsAsync({ includeOptional: true });
    const status = fontStatus();
    const noto = status.find((f) => f.alias === 'NotoSans');
    expect(noto?.available).toBe(true);
    console.log('fonts available:', status.filter((f) => f.available).length, '/', status.length);

    // Banner with an emoji — needs the colour emoji font.
    const banner = await generatePanelBanner({
      title: 'Staff Applications',
      subtitle: 'NGK - community',
      emoji: '🛡️',
      accent: '#ffd700',
    });

    // Podium with a fancy-maths username — must not be tofu.
    const podium = await leaderboardPodium.generate([
      { username: '𝓘𝓼𝓶𝓪𝓲𝓵', avatarUrl: '', level: 1, totalXp: 85, percent: 85 },
      { username: 'Kaven', avatarUrl: '', level: 2, totalXp: 120, percent: 60 },
      { username: 'مرحبا', avatarUrl: '', level: 1, totalXp: 24, percent: 24 },
    ] as any);

    try {
      fs.mkdirSync(OUT_DIR, { recursive: true });
      fs.writeFileSync(path.join(OUT_DIR, 'banner.png'), banner);
      fs.writeFileSync(path.join(OUT_DIR, 'podium.png'), podium);
    } catch { /* preview only */ }

    expect(banner.length).toBeGreaterThan(1000);
    expect(podium.length).toBeGreaterThan(1000);
  }, 120_000);

  it('folds mathematical letters back to ascii', () => {
    expect(normalizeCanvasText('𝓘𝓼𝓶𝓪𝓲𝓵')).toBe('Ismail');
    expect(normalizeCanvasText('𝐇𝐞𝐥𝐥𝐨')).toBe('Hello');
    expect(normalizeCanvasText('normal text')).toBe('normal text');
    expect(normalizeCanvasText('مرحبا')).toBe('مرحبا');
  });

  it('catalogs downloadable fonts', () => {
    const withUrl = FONT_CATALOG.filter((f) => f.url);
    expect(withUrl.length).toBeGreaterThan(5);
  });
});
