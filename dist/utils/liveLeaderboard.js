"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_THEME = void 0;
exports.freshnessLabel = freshnessLabel;
exports.buildContentPanel = buildContentPanel;
exports.collectEntries = collectEntries;
exports.buildMessagePayload = buildMessagePayload;
/**
 * MEE6-style leaderboard panel — matches the reference design:
 * title + member count, Top 3 podium image, Top 3 list, then
 * Diamond / Gold / Silver zones with progress bars and gap headers.
 *
 * Built on **Components v2**: a container with a media gallery (the podium
 * artwork) ABOVE the text, real separators between the zones, and the
 * `MessageFlags.IsComponentsV2` flag on the message.
 *
 * Two boards are rendered with this kit: the **members** leaderboard and
 * the **staff** leaderboard. Each one has its own theme (colour, emoji,
 * wording) so they can never be mistaken for one another.
 *
 * Data comes from LevelingService (Sukuna XP curve), visuals mirror
 * MEE6 + the L7aj live board.
 */
const discord_js_1 = require("discord.js");
const rankcard_1 = require("./rankcard");
const level_1 = require("./level");
const emoji_1 = require("./emoji");
const ZONES = [
    { emoji: 'diamond', name: 'Diamond Zone', from: 4, to: 10 },
    { emoji: 'gold', name: 'Gold Zone', from: 11, to: 18 },
    { emoji: 'silver', name: 'Silver Zone', from: 19, to: 25 },
];
const MEDALS = ['medal1', 'medal2', 'medal3'];
exports.DEFAULT_THEME = {
    accentColor: 0x2b2d63,
    titleEmoji: 'trophy',
    scopeEmoji: 'members',
    scopeLabel: 'members',
    countMode: 'guild',
    zones: true,
};
function formatXp(value) {
    return Math.floor(value).toLocaleString('en-US');
}
function clampText(text, max) {
    if (text.length <= max)
        return text;
    return `${text.slice(0, Math.max(0, max - 1))}…`;
}
function linkText(text) {
    return (0, discord_js_1.escapeMarkdown)(clampText(text, 16))
        .replace(/\[/g, '［')
        .replace(/\]/g, '］');
}
function userLink(entry) {
    return `[${linkText(entry.username)}](https://discord.com/users/${entry.userId})`;
}
function freshnessLabel(updatedAt, now = Date.now()) {
    if (!updatedAt)
        return 'just now';
    const minutes = Math.max(0, Math.floor((now - updatedAt) / 60_000));
    if (minutes < 1)
        return 'just now';
    if (minutes === 1)
        return '1 minute ago';
    if (minutes < 60)
        return `${minutes} minutes ago`;
    const hours = Math.floor(minutes / 60);
    return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
}
/**
 * Build the leaderboard container.
 *
 * The podium artwork is exposed through a media gallery so it renders ABOVE
 * the leaderboard text (an embed image would sit below the fields, and
 * markdown images are not rendered inside component text at all).
 */
function buildContentPanel(options) {
    const { entries, guild, updatedAt = Date.now(), podiumUrl, rankChanges, } = options;
    const theme = { ...exports.DEFAULT_THEME, ...(options.theme ?? {}) };
    const rows = Math.max(1, options.rows ?? entries.length);
    const title = (options.title ?? '').trim() || `${guild.name} leaderboard`;
    const top = entries.slice(0, 3);
    const scopeCount = theme.countMode === 'ranked' ? entries.length : guild.memberCount;
    const container = new discord_js_1.ContainerBuilder().setAccentColor(theme.accentColor);
    // 1. Header
    container.addTextDisplayComponents((textDisplay) => textDisplay.setContent(`# ${(0, emoji_1.resolveEmoji)(theme.titleEmoji)} ${title}\n${(0, emoji_1.resolveEmoji)(theme.scopeEmoji)} **${scopeCount.toLocaleString('en-US')}** ${theme.scopeLabel} · ${(0, emoji_1.resolveEmoji)('sparkles')} *Ranked by experience*`));
    // 2. Podium image (ABOVE the leaderboard text)
    if (podiumUrl) {
        container.addMediaGalleryComponents(new discord_js_1.MediaGalleryBuilder().addItems(new discord_js_1.MediaGalleryItemBuilder()
            .setURL(podiumUrl)
            .setDescription('Top three leaderboard members')));
    }
    // 3. Separator
    container.addSeparatorComponents(new discord_js_1.SeparatorBuilder().setDivider(true).setSpacing(1));
    // 4. Top 3
    const topLines = top.map((entry, index) => `${(0, emoji_1.resolveEmoji)(MEDALS[index] ?? 'medal1')} ${userLink(entry)} — Lv ${entry.level} · ${formatXp(entry.totalXp)} XP ${(0, level_1.progressBar)(entry.percent, 6)} ${entry.percent}%`);
    container.addTextDisplayComponents((textDisplay) => textDisplay.setContent(`## ${(0, emoji_1.resolveEmoji)('crown')} Top 3\n${topLines.length > 0 ? clampText(topLines.join('\n'), 900) : 'No ranked members yet.'}`));
    // 5. Zones
    let budget = 4000;
    if (theme.zones) {
        for (const zone of ZONES) {
            const from = zone.from;
            if (from > rows || from > entries.length + 1)
                continue;
            const to = Math.min(zone.to, rows);
            const zoneEntries = entries.filter((e) => e.rank >= from && e.rank <= to);
            if (zoneEntries.length === 0)
                continue;
            const above = entries[from - 2];
            const first = entries[from - 1];
            const gap = above && first ? Math.max(0, above.totalXp - first.totalXp) : 0;
            const target = from === 4 ? 'Top 3' : (ZONES.find((z) => z.to === from - 1)?.name ?? 'the next zone');
            const header = gap > 0
                ? `Ranks ${from} – ${to} ${(0, emoji_1.resolveEmoji)('bolt')} \`${formatXp(gap)} XP\` to pass #${from - 1} and enter ${target}`
                : `Ranks ${from} – ${to}`;
            const lines = zoneEntries.map((entry) => {
                const rankLabel = String(entry.rank).padStart(2, '0');
                const bar = (0, level_1.progressBar)(entry.percent, 6);
                return `\`${rankLabel}\` ${userLink(entry)} — Lv ${entry.level} · ${formatXp(entry.totalXp)} XP ${bar} ${entry.percent}%`;
            });
            const room = Math.min(1000, budget - zone.name.length - 20);
            if (room < 160)
                break;
            const body = clampText(`${header}\n${lines.join('\n')}`, room);
            budget -= body.length + zone.name.length + 20;
            container.addSeparatorComponents(new discord_js_1.SeparatorBuilder().setDivider(true).setSpacing(1));
            container.addTextDisplayComponents((textDisplay) => textDisplay.setContent(`## ${(0, emoji_1.resolveEmoji)(zone.emoji)} ${zone.name}\n${body}`));
        }
    }
    else {
        // Short boards (a small staff team) get a plain ranked list instead of
        // the zone layout — the zones only make sense on long boards.
        const listEntries = entries.filter((e) => e.rank > 3);
        if (listEntries.length > 0) {
            const lines = listEntries.map((entry) => {
                const rankLabel = String(entry.rank).padStart(2, '0');
                const bar = (0, level_1.progressBar)(entry.percent, 6);
                return `\`${rankLabel}\` ${userLink(entry)} — Lv ${entry.level} · ${formatXp(entry.totalXp)} XP ${bar} ${entry.percent}%`;
            });
            container.addSeparatorComponents(new discord_js_1.SeparatorBuilder().setDivider(true).setSpacing(1));
            container.addTextDisplayComponents((textDisplay) => textDisplay.setContent(`## ${(0, emoji_1.resolveEmoji)('list')} Full ranking\n${clampText(lines.join('\n'), 900)}`));
        }
    }
    // 6. Footer
    const label = freshnessLabel(updatedAt);
    let footerText = `${(0, emoji_1.resolveEmoji)('refresh')} Updates automatically · last update ${label}`;
    if (rankChanges && (rankChanges.movedUp > 0 || rankChanges.newOnList > 0)) {
        const parts = [];
        if (rankChanges.movedUp > 0)
            parts.push(`${(0, emoji_1.resolveEmoji)('upArrow')} ${rankChanges.movedUp} rank change${rankChanges.movedUp === 1 ? '' : 's'} in the last 24h`);
        if (rankChanges.newOnList > 0)
            parts.push(`${(0, emoji_1.resolveEmoji)('newBadge')} ${rankChanges.newOnList} new on the list`);
        footerText = `${parts.join(' · ')}\n${footerText}`;
    }
    container.addTextDisplayComponents((textDisplay) => textDisplay.setContent(`-# ${footerText}`));
    return container;
}
/**
 * Collect entries from LevelingService in MEE6 display shape.
 *
 * `track` picks the board: `member` (default) or `staff`.
 */
async function collectEntries(service, guild, limit, client, track) {
    const rows = await service.getLeaderboard(guild.id, limit, track ?? undefined);
    const out = [];
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const userId = row.id;
        const member = guild.members.cache.get(userId);
        let user = member?.user ?? client?.users.cache.get(userId);
        if (!user && client) {
            try {
                user = await client.users.fetch(userId);
            }
            catch {
                user = undefined;
            }
        }
        const level = row.level || 1;
        const totalXp = row.total_xp || 0;
        const progress = service.getLevelProgress(totalXp, level);
        out.push({
            rank: i + 1,
            userId,
            username: member?.displayName ?? user?.globalName ?? user?.username ?? row.username ?? 'Unknown',
            avatarUrl: member?.displayAvatarURL?.({ extension: 'png', size: 256 })
                ?? user?.displayAvatarURL?.({ extension: 'png', size: 256 })
                ?? '',
            level,
            totalXp,
            xpInLevel: progress.current,
            xpForNext: progress.needed,
            percent: progress.percentage,
        });
    }
    return out;
}
/**
 * Build the components + podium attachment payload for a leaderboard call.
 * Falls back to text-only if the podium render fails.
 */
async function buildMessagePayload(entries, guild, rows, title, updatedAt = Date.now(), theme) {
    const panel = (podiumUrl) => buildContentPanel({
        entries,
        guild,
        rows,
        title,
        updatedAt,
        podiumUrl,
        theme,
    });
    try {
        const buffer = await rankcard_1.leaderboardPodium.generate(entries.slice(0, 3).map((e) => ({
            username: e.username,
            avatarUrl: e.avatarUrl,
            level: e.level,
            totalXp: e.totalXp,
            percent: e.percent,
        })));
        const file = new discord_js_1.AttachmentBuilder(buffer, { name: 'top-3.png' });
        return {
            components: [panel('attachment://top-3.png')],
            files: [file],
            flags: discord_js_1.MessageFlags.IsComponentsV2,
        };
    }
    catch {
        return {
            components: [panel()],
            files: [],
            flags: discord_js_1.MessageFlags.IsComponentsV2,
        };
    }
}
