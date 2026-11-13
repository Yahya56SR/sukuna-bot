"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.leaderboardPodium = exports.leaderboardCard = exports.rankCard = exports.LeaderboardPodiumCanvas = exports.LeaderboardCanvas = exports.RankCardCanvas = void 0;
const canvas_1 = require("@napi-rs/canvas");
const fonts_1 = require("./fonts");
const path_1 = __importDefault(require("path"));
const CardTemplates_1 = require("../config/CardTemplates");
/**
 * MEE6-style rank card — 1000x300 PNG with avatar, username, rank/level,
 * XP progress bar. Branded for Sukuna (crimson gradient) but layout
 * mirrors MEE6's classic card.
 */
class RankCardCanvas {
    constructor() {
        this.width = 1000;
        this.height = 300;
    }
    async generate(data) {
        await (0, fonts_1.ensureFontsAsync)();
        const t = { ...CardTemplates_1.DEFAULT_CARD_CONFIG.rank, ...(data.template ?? {}) };
        const canvas = (0, canvas_1.createCanvas)(this.width, this.height);
        const ctx = canvas.getContext('2d');
        await this.drawBackground(ctx, t);
        await this.drawAvatar(ctx, data.avatarUrl, t);
        const textX = 310;
        const rightX = 960;
        // Username
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.font = `bold 44px ${fonts_1.FONT_STACK}`;
        ctx.fillStyle = t.textColor;
        ctx.fillText(this.fitText(ctx, data.username, 440), textX, 112);
        // Secondary line: total XP, or custom status
        const secondary = data.statusText || `Total XP: ${(data.totalXp ?? 0).toLocaleString()}`;
        ctx.font = `24px ${fonts_1.FONT_STACK}`;
        ctx.fillStyle = t.subTextColor;
        ctx.fillText(this.fitText(ctx, secondary, 440), textX, 152);
        // Rank (right) — gold like MEE6
        ctx.textAlign = 'right';
        ctx.font = `bold 40px ${fonts_1.FONT_STACK}`;
        ctx.fillStyle = t.rankColor;
        const rankLabel = data.rank
            ? `Rank #${data.rank}${data.totalRanked ? ` / ${data.totalRanked}` : ''}`
            : 'Unranked';
        ctx.fillText(rankLabel, rightX, 108);
        // Level (right) — cyan like MEE6
        ctx.font = `bold 34px ${fonts_1.FONT_STACK}`;
        ctx.fillStyle = t.levelColor;
        ctx.fillText(`Level ${data.level}`, rightX, 152);
        // XP labels
        const progress = data.xpNeeded > 0
            ? Math.min(1, Math.max(0, data.xpIntoLevel / data.xpNeeded))
            : 0;
        ctx.font = `24px ${fonts_1.FONT_STACK}`;
        ctx.fillStyle = t.subTextColor;
        ctx.textAlign = 'left';
        ctx.fillText(`${data.xpIntoLevel.toLocaleString()} / ${data.xpNeeded.toLocaleString()} XP`, textX, 212);
        ctx.textAlign = 'right';
        ctx.fillText(`${Math.round(progress * 100)}%`, rightX, 212);
        // Progress bar — uses editable accent gradient
        this.drawProgressBar(ctx, textX, 228, rightX - textX, 28, progress, t);
        // Guild name under the bar
        if (data.guildName && t.showGuildName) {
            ctx.textAlign = 'left';
            ctx.font = `20px ${fonts_1.FONT_STACK}`;
            ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
            ctx.fillText(this.fitText(ctx, data.guildName, 650), textX, 284);
        }
        this.roundedRect(ctx, 2, 2, this.width - 4, this.height - 4, 24);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
        ctx.lineWidth = 4;
        ctx.stroke();
        return canvas.toBuffer('image/png');
    }
    async drawBackground(ctx, t) {
        const bgPath = (t.backgroundImage || '').trim();
        let drewImage = false;
        if (bgPath) {
            try {
                if (bgPath.startsWith('http')) {
                    const bgImage = await (0, canvas_1.loadImage)(bgPath);
                    // Cover crop
                    this.roundedRect(ctx, 0, 0, this.width, this.height, 24);
                    ctx.fillStyle = t.bgGradientStart;
                    ctx.fill();
                    ctx.save();
                    ctx.clip();
                    const scale = Math.max(this.width / bgImage.width, this.height / bgImage.height);
                    const w = bgImage.width * scale;
                    const h = bgImage.height * scale;
                    ctx.drawImage(bgImage, (this.width - w) / 2, (this.height - h) / 2, w, h);
                    ctx.restore();
                    drewImage = true;
                }
                else {
                    const candidates = [
                        path_1.default.resolve(process.cwd(), bgPath),
                        path_1.default.join(__dirname, '..', '..', bgPath),
                    ];
                    for (const p of candidates) {
                        try {
                            const bgImage = await (0, canvas_1.loadImage)(p);
                            this.roundedRect(ctx, 0, 0, this.width, this.height, 24);
                            ctx.fillStyle = t.bgGradientStart;
                            ctx.fill();
                            ctx.save();
                            ctx.clip();
                            const scale = Math.max(this.width / bgImage.width, this.height / bgImage.height);
                            const w = bgImage.width * scale;
                            const h = bgImage.height * scale;
                            ctx.drawImage(bgImage, (this.width - w) / 2, (this.height - h) / 2, w, h);
                            ctx.restore();
                            drewImage = true;
                            break;
                        }
                        catch { /* try next */ }
                    }
                }
            }
            catch {
                drewImage = false;
            }
        }
        if (!drewImage) {
            this.roundedRect(ctx, 0, 0, this.width, this.height, 24);
            const gradient = ctx.createLinearGradient(0, 0, this.width, this.height);
            gradient.addColorStop(0, t.bgGradientStart);
            gradient.addColorStop(0.55, t.bgGradientEnd);
            gradient.addColorStop(1, t.bgGradientEnd);
            ctx.fillStyle = gradient;
            ctx.fill();
        }
        try {
            const glow = ctx.createRadialGradient(this.width - 60, 40, 10, this.width - 60, 40, 420);
            glow.addColorStop(0, this.hexToRgba(t.accent, 0.35));
            glow.addColorStop(1, this.hexToRgba(t.accent, 0));
            ctx.fillStyle = glow;
            // clip glow to rounded rect
            ctx.save();
            this.roundedRect(ctx, 0, 0, this.width, this.height, 24);
            ctx.clip();
            ctx.fillRect(0, 0, this.width, this.height);
            ctx.restore();
        }
        catch { /* decorative */ }
        // Overlay for readability
        if (t.overlayOpacity > 0) {
            ctx.save();
            this.roundedRect(ctx, 0, 0, this.width, this.height, 24);
            ctx.clip();
            ctx.fillStyle = `rgba(0,0,0,${Math.min(0.85, Math.max(0, t.overlayOpacity))})`;
            ctx.fillRect(0, 0, this.width, this.height);
            ctx.restore();
        }
    }
    async drawAvatar(ctx, avatarUrl, t) {
        const x = 170;
        const y = 150;
        const radius = 100;
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2, true);
        ctx.closePath();
        ctx.clip();
        try {
            if (avatarUrl) {
                const avatar = await (0, canvas_1.loadImage)(avatarUrl);
                const size = Math.max(avatar.width, avatar.height);
                ctx.drawImage(avatar, x - size / 2, y - size / 2, size, size);
            }
            else {
                throw new Error('no avatar');
            }
        }
        catch {
            const fallback = ctx.createLinearGradient(x - radius, y - radius, x + radius, y + radius);
            fallback.addColorStop(0, t.accent);
            fallback.addColorStop(1, t.accentSecondary);
            ctx.fillStyle = fallback;
            ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
        }
        ctx.restore();
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2, true);
        ctx.strokeStyle = t.textColor;
        ctx.lineWidth = 6;
        ctx.stroke();
    }
    drawProgressBar(ctx, x, y, width, height, progress, t) {
        this.roundedRect(ctx, x, y, width, height, height / 2);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
        ctx.fill();
        if (progress <= 0)
            return;
        const fillWidth = Math.max(height, width * progress);
        this.roundedRect(ctx, x, y, fillWidth, height, height / 2);
        const gradient = ctx.createLinearGradient(x, y, x + width, y);
        gradient.addColorStop(0, t?.accent ?? '#ef4444');
        gradient.addColorStop(1, t?.accentSecondary ?? '#f97316');
        ctx.fillStyle = gradient;
        ctx.fill();
    }
    hexToRgba(hex, alpha) {
        const h = hex.replace('#', '').trim();
        if (!/^[0-9a-fA-F]{3,8}$/.test(h))
            return `rgba(239,68,68,${alpha})`;
        let r = 0, g = 0, b = 0;
        if (h.length === 3) {
            r = parseInt(h[0] + h[0], 16);
            g = parseInt(h[1] + h[1], 16);
            b = parseInt(h[2] + h[2], 16);
        }
        else if (h.length >= 6) {
            r = parseInt(h.slice(0, 2), 16);
            g = parseInt(h.slice(2, 4), 16);
            b = parseInt(h.slice(4, 6), 16);
        }
        if (isNaN(r) || isNaN(g) || isNaN(b))
            return `rgba(239,68,68,${alpha})`;
        return `rgba(${r},${g},${b},${alpha})`;
    }
    roundedRect(ctx, x, y, width, height, radius) {
        const r = Math.min(radius, width / 2, height / 2);
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + width, y, x + width, y + height, r);
        ctx.arcTo(x + width, y + height, x, y + height, r);
        ctx.arcTo(x, y + height, x, y, r);
        ctx.arcTo(x, y, x + width, y, r);
        ctx.closePath();
    }
    fitText(ctx, text, maxWidth) {
        return (0, fonts_1.ellipsize)((t) => ctx.measureText(t).width, (0, fonts_1.normalizeCanvasText)(text), maxWidth);
    }
}
exports.RankCardCanvas = RankCardCanvas;
/**
 * MEE6-style leaderboard image — header + ranked rows.
 */
class LeaderboardCanvas {
    constructor() {
        this.width = 1000;
        this.rowHeight = 56;
        this.headerHeight = 120;
    }
    async generate(rows, guildName, title = '🏆 Top members', template) {
        await (0, fonts_1.ensureFontsAsync)();
        const t = { ...CardTemplates_1.DEFAULT_CARD_CONFIG.leaderboard, ...(template ?? rows[0]?.template ?? {}) };
        const height = this.headerHeight + rows.length * this.rowHeight + 30;
        const canvas = (0, canvas_1.createCanvas)(this.width, height);
        const ctx = canvas.getContext('2d');
        this.drawBackground(ctx, height, t);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.font = `bold 40px ${fonts_1.FONT_STACK}`;
        ctx.fillStyle = t.textColor;
        ctx.fillText(title, 50, 62);
        ctx.textAlign = 'right';
        ctx.font = `24px ${fonts_1.FONT_STACK}`;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
        ctx.fillText(guildName, this.width - 50, 60);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.fillRect(50, 84, this.width - 100, 2);
        for (let i = 0; i < rows.length; i++) {
            await this.drawRow(ctx, rows[i], i, this.headerHeight + i * this.rowHeight, t);
        }
        this.roundedRect(ctx, 2, 2, this.width - 4, height - 4, 24);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
        ctx.lineWidth = 4;
        ctx.stroke();
        return canvas.toBuffer('image/png');
    }
    async drawRow(ctx, row, index, y, t) {
        const centerY = y + this.rowHeight / 2;
        ctx.textAlign = 'center';
        ctx.font = `bold 26px ${fonts_1.FONT_STACK}`;
        ctx.fillStyle =
            index === 0 ? t.gold : index === 1 ? t.silver : index === 2 ? t.bronze : '#8b93a7';
        ctx.fillText(`${index + 1}`, 56, centerY + 9);
        const avatarX = 120;
        const radius = 20;
        ctx.save();
        ctx.beginPath();
        ctx.arc(avatarX, centerY, radius, 0, Math.PI * 2, true);
        ctx.closePath();
        ctx.clip();
        try {
            const avatar = await (0, canvas_1.loadImage)(row.avatarUrl);
            const size = radius * 2;
            ctx.drawImage(avatar, avatarX - size / 2, centerY - size / 2, size, size);
        }
        catch {
            ctx.fillStyle = t.accent;
            ctx.fillRect(avatarX - radius, centerY - radius, radius * 2, radius * 2);
        }
        ctx.restore();
        ctx.beginPath();
        ctx.arc(avatarX, centerY, radius, 0, Math.PI * 2, true);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.textAlign = 'left';
        ctx.font = `26px ${fonts_1.FONT_STACK}`;
        ctx.fillStyle = t.textColor;
        ctx.fillText((0, fonts_1.ellipsize)((t2) => ctx.measureText(t2).width, (0, fonts_1.normalizeCanvasText)(row.username), 400), 160, centerY + 9);
        ctx.textAlign = 'right';
        ctx.font = `bold 24px ${fonts_1.FONT_STACK}`;
        ctx.fillStyle = '#00b0f4';
        ctx.fillText(`Level ${row.level}`, 760, centerY + 8);
        ctx.font = `22px ${fonts_1.FONT_STACK}`;
        ctx.fillStyle = t.subTextColor;
        ctx.fillText(`${row.totalXp.toLocaleString()} XP`, this.width - 50, centerY + 8);
    }
    drawBackground(ctx, height, t) {
        this.roundedRect(ctx, 0, 0, this.width, height, 24);
        const gradient = ctx.createLinearGradient(0, 0, this.width, height);
        gradient.addColorStop(0, t.bgGradientStart);
        gradient.addColorStop(0.55, t.bgGradientEnd);
        gradient.addColorStop(1, t.bgGradientEnd);
        ctx.fillStyle = gradient;
        ctx.fill();
        try {
            const glow = ctx.createRadialGradient(this.width - 60, 40, 10, this.width - 60, 40, 420);
            glow.addColorStop(0, this.hexToRgba(t.accent, 0.35));
            glow.addColorStop(1, this.hexToRgba(t.accent, 0));
            ctx.fillStyle = glow;
            ctx.fillRect(0, 0, this.width, height);
        }
        catch { /* decorative */ }
    }
    hexToRgba(hex, alpha) {
        const h = hex.replace('#', '').trim();
        if (!/^[0-9a-fA-F]{3,8}$/.test(h))
            return `rgba(239,68,68,${alpha})`;
        let r = 0, g = 0, b = 0;
        if (h.length === 3) {
            r = parseInt(h[0] + h[0], 16);
            g = parseInt(h[1] + h[1], 16);
            b = parseInt(h[2] + h[2], 16);
        }
        else if (h.length >= 6) {
            r = parseInt(h.slice(0, 2), 16);
            g = parseInt(h.slice(2, 4), 16);
            b = parseInt(h.slice(4, 6), 16);
        }
        if (isNaN(r) || isNaN(g) || isNaN(b))
            return `rgba(239,68,68,${alpha})`;
        return `rgba(${r},${g},${b},${alpha})`;
    }
    roundedRect(ctx, x, y, width, height, radius) {
        const r = Math.min(radius, width / 2, height / 2);
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + width, y, x + width, y + height, r);
        ctx.arcTo(x + width, y + height, x, y + height, r);
        ctx.arcTo(x, y + height, x, y, r);
        ctx.arcTo(x, y, x + width, y, r);
        ctx.closePath();
    }
}
exports.LeaderboardCanvas = LeaderboardCanvas;
const PODIUM_ACCENTS = {
    1: '#f0b232',
    2: '#c0c6cf',
    3: '#cd7f32',
};
/**
 * Top-3 podium — 1st in the centre (raised), 2nd left, 3rd right.
 */
class LeaderboardPodiumCanvas {
    constructor() {
        this.width = 1000;
        this.height = 360;
    }
    async generate(entries) {
        await (0, fonts_1.ensureFontsAsync)();
        const canvas = (0, canvas_1.createCanvas)(this.width, this.height);
        const ctx = canvas.getContext('2d');
        this.drawBackground(ctx);
        const slots = [
            { entry: entries[1], x: 56, y: 62, width: 276, height: 272, rank: 2, avatarRadius: 42 },
            { entry: entries[0], x: 352, y: 18, width: 296, height: 316, rank: 1, avatarRadius: 52 },
            { entry: entries[2], x: 668, y: 62, width: 276, height: 272, rank: 3, avatarRadius: 42 },
        ];
        for (const slot of slots)
            this.drawPanel(ctx, slot);
        for (const slot of slots) {
            if (slot.entry)
                await this.drawEntry(ctx, slot, slot.entry);
        }
        return canvas.toBuffer('image/png');
    }
    drawBackground(ctx) {
        const gradient = ctx.createLinearGradient(0, 0, this.width, this.height);
        gradient.addColorStop(0, '#1e1f3a');
        gradient.addColorStop(0.55, '#2b2d63');
        gradient.addColorStop(1, '#171831');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, this.width, this.height);
        const glow = ctx.createRadialGradient(this.width / 2, 40, 10, this.width / 2, 40, 500);
        glow.addColorStop(0, 'rgba(239, 68, 68, 0.28)');
        glow.addColorStop(1, 'rgba(239, 68, 68, 0)');
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, this.width, this.height);
    }
    drawPanel(ctx, slot) {
        const accent = PODIUM_ACCENTS[slot.rank] ?? '#c0c6cf';
        this.roundedRect(ctx, slot.x, slot.y, slot.width, slot.height, 22);
        const gradient = ctx.createLinearGradient(slot.x, slot.y, slot.x, slot.y + slot.height);
        gradient.addColorStop(0, 'rgba(255, 255, 255, 0.09)');
        gradient.addColorStop(1, 'rgba(255, 255, 255, 0.02)');
        ctx.fillStyle = gradient;
        ctx.fill();
        ctx.strokeStyle = slot.rank === 1 ? 'rgba(240, 178, 50, 0.5)' : 'rgba(255, 255, 255, 0.13)';
        ctx.lineWidth = slot.rank === 1 ? 3 : 2;
        ctx.stroke();
        this.roundedRect(ctx, slot.x + slot.width * 0.2, slot.y, slot.width * 0.6, 5, 2.5);
        ctx.fillStyle = accent;
        ctx.fill();
    }
    async drawEntry(ctx, slot, entry) {
        const accent = PODIUM_ACCENTS[slot.rank] ?? '#c0c6cf';
        const centerX = slot.x + slot.width / 2;
        const hero = slot.rank === 1;
        const badgeCy = slot.y + (hero ? 42 : 36);
        this.drawCrown(ctx, centerX, badgeCy, hero ? 46 : 26, accent);
        const avatarY = slot.y + (hero ? 110 : 88);
        const nameY = avatarY + slot.avatarRadius + (hero ? 32 : 30);
        const xpY = nameY + (hero ? 23 : 21);
        const barY = xpY + (hero ? 14 : 13);
        const barHeight = hero ? 10 : 9;
        await this.drawAvatar(ctx, entry.avatarUrl, centerX, avatarY, slot.avatarRadius, accent);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.font = `bold ${hero ? 26 : 24}px ${fonts_1.FONT_STACK}`;
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText((0, fonts_1.ellipsize)((t) => ctx.measureText(t).width, (0, fonts_1.normalizeCanvasText)(entry.username), slot.width - 36), centerX, nameY);
        ctx.font = `${hero ? 18 : 16}px ${fonts_1.FONT_STACK}`;
        ctx.fillStyle = '#b9bbbe';
        ctx.fillText(`Lv ${entry.level} · ${Math.floor(entry.totalXp).toLocaleString('en-US')} XP`, centerX, xpY);
        const contentWidth = slot.width - 48;
        const pctWidth = 46;
        const barWidth = contentWidth - pctWidth;
        const barX = slot.x + 24;
        this.drawProgressBar(ctx, barX, barY, barWidth, barHeight, entry.percent);
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.font = `15px ${fonts_1.FONT_STACK}`;
        ctx.fillStyle = '#b9bbbe';
        ctx.fillText(`${entry.percent}%`, barX + contentWidth, barY + barHeight / 2);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.font = `bold ${hero ? 30 : 26}px ${fonts_1.FONT_STACK}`;
        ctx.fillStyle = accent ?? '#ffffff';
        ctx.fillText(`${slot.rank}`, centerX, slot.y + slot.height - 16);
    }
    drawProgressBar(ctx, x, y, width, height, percent) {
        const segments = 12;
        const gap = 3;
        const segmentWidth = (width - gap * (segments - 1)) / segments;
        const filled = Math.round((Math.max(0, Math.min(100, percent)) / 100) * segments);
        for (let i = 0; i < segments; i++) {
            this.roundedRect(ctx, x + i * (segmentWidth + gap), y, segmentWidth, height, height / 2);
            ctx.fillStyle = i < filled ? '#ef4444' : 'rgba(255, 255, 255, 0.14)';
            ctx.fill();
        }
    }
    async drawAvatar(ctx, avatarUrl, x, y, radius, ringColor) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2, true);
        ctx.closePath();
        ctx.clip();
        try {
            if (!avatarUrl)
                throw new Error('no avatar');
            const avatar = await (0, canvas_1.loadImage)(avatarUrl);
            const side = Math.min(avatar.width, avatar.height);
            ctx.drawImage(avatar, (avatar.width - side) / 2, (avatar.height - side) / 2, side, side, x - radius, y - radius, radius * 2, radius * 2);
        }
        catch {
            const fallback = ctx.createLinearGradient(x - radius, y - radius, x + radius, y + radius);
            fallback.addColorStop(0, '#ef4444');
            fallback.addColorStop(1, '#f97316');
            ctx.fillStyle = fallback;
            ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
        }
        ctx.restore();
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2, true);
        ctx.strokeStyle = ringColor;
        ctx.lineWidth = Math.max(4, Math.round(radius / 12));
        ctx.stroke();
    }
    drawCrown(ctx, cx, cy, width, color) {
        const half = width / 2;
        const height = width * 0.55;
        const top = cy - height / 2;
        const bottom = cy + height / 2;
        ctx.beginPath();
        ctx.moveTo(cx - half, bottom);
        ctx.lineTo(cx - half, top + height * 0.22);
        ctx.lineTo(cx - half * 0.45, top + height * 0.68);
        ctx.lineTo(cx, top);
        ctx.lineTo(cx + half * 0.45, top + height * 0.68);
        ctx.lineTo(cx + half, top + height * 0.22);
        ctx.lineTo(cx + half, bottom);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
        ctx.fillRect(cx - half, bottom - 2, width, 7);
    }
    roundedRect(ctx, x, y, width, height, radius) {
        const r = Math.min(radius, width / 2, height / 2);
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + width, y, x + width, y + height, r);
        ctx.arcTo(x + width, y + height, x, y + height, r);
        ctx.arcTo(x, y + height, x, y, r);
        ctx.arcTo(x, y, x + width, y, r);
        ctx.closePath();
    }
}
exports.LeaderboardPodiumCanvas = LeaderboardPodiumCanvas;
exports.rankCard = new RankCardCanvas();
exports.leaderboardCard = new LeaderboardCanvas();
exports.leaderboardPodium = new LeaderboardPodiumCanvas();
exports.default = exports.rankCard;
