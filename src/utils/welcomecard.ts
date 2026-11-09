import { createCanvas, loadImage } from '@napi-rs/canvas';
import type { SKRSContext2D } from '@napi-rs/canvas';
import { ensureFonts, FONT_STACK, ellipsize } from './fonts';
import path from 'path';
import { DEFAULT_CARD_CONFIG, type WelcomeCardTemplate } from '../config/CardTemplates';

export interface WelcomeCardData {
  avatarUrl: string;
  displayName: string;
  guildName: string;
  memberCount: number;
  welcomeMessage: string;
  template?: Partial<WelcomeCardTemplate> | undefined;
}

/**
 * Sukuna welcome card — 1024x512 PNG.
 * Layout mirrors MEE6's welcome banner (centred avatar + message) but
 * uses the editable CardTemplate theme so the dashboard can restyle it.
 */
export class WelcomeCardCanvas {
  width = 1024;
  height = 512;

  async generate(data: WelcomeCardData): Promise<Buffer> {
    ensureFonts();
    const t: WelcomeCardTemplate = { ...DEFAULT_CARD_CONFIG.welcome, ...(data.template ?? {}) };

    const canvas = createCanvas(this.width, this.height);
    const ctx = canvas.getContext('2d');

    await this.drawBackground(ctx, t);
    await this.drawAvatar(ctx, data.avatarUrl, t);
    this.drawWelcomeText(ctx, data, t);
    if (t.showMemberCount) this.drawMemberCount(ctx, data.memberCount, t);

    return canvas.toBuffer('image/png');
  }

  private async drawBackground(ctx: SKRSContext2D, t: WelcomeCardTemplate): Promise<void> {
    const bgPath = (t.backgroundImage || '').trim();
    let drewImage = false;
    if (bgPath) {
      try {
        const candidates = [
          bgPath.startsWith('http') ? null : path.resolve(process.cwd(), bgPath),
          bgPath.startsWith('http') ? null : path.join(__dirname, '..', '..', bgPath),
        ].filter(Boolean) as string[];
        // Try remote URL first if http(s)
        if (bgPath.startsWith('http')) {
          try {
            const bgImage = await loadImage(bgPath);
            ctx.drawImage(bgImage, 0, 0, this.width, this.height);
            drewImage = true;
          } catch { /* fall through to gradient */ }
        } else {
          for (const p of candidates) {
            try {
              const bgImage = await loadImage(p);
              ctx.drawImage(bgImage, 0, 0, this.width, this.height);
              drewImage = true;
              break;
            } catch { /* try next */ }
          }
        }
      } catch {
        drewImage = false;
      }
    }

    if (!drewImage) {
      const gradient = ctx.createLinearGradient(0, 0, this.width, this.height);
      gradient.addColorStop(0, t.bgGradientStart);
      gradient.addColorStop(0.55, t.bgGradientEnd);
      gradient.addColorStop(1, t.bgGradientEnd);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, this.width, this.height);
    }

    // Accent glow — top-right, uses the editable accent color
    try {
      const glow = ctx.createRadialGradient(this.width - 80, 40, 10, this.width - 80, 40, 500);
      glow.addColorStop(0, this.hexToRgba(t.accent, 0.32));
      glow.addColorStop(1, this.hexToRgba(t.accent, 0));
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, this.width, this.height);
    } catch { /* glow is decorative */ }

    // Dark overlay for readability
    const overlay = ctx.createLinearGradient(0, 0, 0, this.height);
    overlay.addColorStop(0, `rgba(0,0,0,${Math.max(0, t.overlayOpacity - 0.2)})`);
    overlay.addColorStop(0.5, `rgba(0,0,0,${t.overlayOpacity})`);
    overlay.addColorStop(1, `rgba(0,0,0,${Math.min(0.9, t.overlayOpacity + 0.2)})`);
    ctx.fillStyle = overlay;
    ctx.fillRect(0, 0, this.width, this.height);
  }

  private async drawAvatar(ctx: SKRSContext2D, avatarUrl: string, t: WelcomeCardTemplate): Promise<void> {
    const centerX = this.width / 2;
    const centerY = this.height / 2 - 20;
    const radius = 100;

    ctx.save();
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2, true);
    ctx.closePath();
    ctx.clip();

    try {
      if (avatarUrl) {
        const avatar = await loadImage(avatarUrl);
        const size = Math.max(avatar.width, avatar.height);
        const scale = (radius * 2) / size;
        ctx.drawImage(
          avatar,
          centerX - (avatar.width * scale) / 2,
          centerY - (avatar.height * scale) / 2,
          avatar.width * scale,
          avatar.height * scale,
        );
      } else {
        throw new Error('no avatar');
      }
    } catch {
      const fallback = ctx.createLinearGradient(centerX - radius, centerY - radius, centerX + radius, centerY + radius);
      fallback.addColorStop(0, t.accent);
      fallback.addColorStop(1, t.accentSecondary);
      ctx.fillStyle = fallback;
      ctx.fillRect(centerX - radius, centerY - radius, radius * 2, radius * 2);
    }
    ctx.restore();

    ctx.beginPath();
    ctx.arc(centerX, centerY, radius + Math.max(0, t.avatarRingWidth), 0, Math.PI * 2, true);
    ctx.strokeStyle = t.textColor;
    ctx.lineWidth = Math.max(0, t.avatarRingWidth);
    ctx.stroke();
  }

  private drawWelcomeText(ctx: SKRSContext2D, data: WelcomeCardData, t: WelcomeCardTemplate): void {
    const centerX = this.width / 2;
    const avatarCenterY = this.height / 2 - 20;
    const avatarRadius = 100;
    const textY = avatarCenterY + avatarRadius + 90;

    const message = (data.welcomeMessage || 'Welcome {username} to {server}!')
      .replace(/{user}/g, data.displayName)
      .replace(/{username}/g, data.displayName)
      .replace(/{server}/g, data.guildName)
      .replace(/{memberCount}/g, String(data.memberCount))
      .replace(/{tag}/g, data.displayName);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.font = `bold 46px ${FONT_STACK}`;
    ctx.fillStyle = t.textColor;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 2;
    ctx.fillText(this.fitText(ctx, message, this.width - 120), centerX, textY);
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
  }

  private drawMemberCount(ctx: SKRSContext2D, memberCount: number, t: WelcomeCardTemplate): void {
    const centerX = this.width / 2;
    const textY = this.height - 48;
    const memberText = `Member #${memberCount.toLocaleString()}`;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold 20px ${FONT_STACK}`;
    ctx.fillStyle = t.subTextColor;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
    ctx.shadowBlur = 3;
    ctx.shadowOffsetY = 1;
    ctx.fillText(memberText, centerX, textY);
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
  }

  private fitText(ctx: SKRSContext2D, text: string, maxWidth: number): string {
    return ellipsize((t) => ctx.measureText(t).width, text, maxWidth);
  }

  private hexToRgba(hex: string, alpha: number): string {
    const h = hex.replace('#', '').trim();
    if (!/^[0-9a-fA-F]{3,8}$/.test(h)) return `rgba(239,68,68,${alpha})`;
    let r = 0, g = 0, b = 0;
    if (h.length === 3) {
      r = parseInt(h[0]! + h[0]!, 16);
      g = parseInt(h[1]! + h[1]!, 16);
      b = parseInt(h[2]! + h[2]!, 16);
    } else if (h.length >= 6) {
      r = parseInt(h.slice(0, 2), 16);
      g = parseInt(h.slice(2, 4), 16);
      b = parseInt(h.slice(4, 6), 16);
    }
    if (isNaN(r) || isNaN(g) || isNaN(b)) return `rgba(239,68,68,${alpha})`;
    return `rgba(${r},${g},${b},${alpha})`;
  }
}

export const welcomeCard = new WelcomeCardCanvas();
export default welcomeCard;
