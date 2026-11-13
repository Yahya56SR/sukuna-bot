"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BRAND = void 0;
exports.brandedEmbed = brandedEmbed;
exports.progressBar = progressBar;
exports.formatNumber = formatNumber;
exports.formatUptime = formatUptime;
exports.successEmbed = successEmbed;
exports.errorEmbed = errorEmbed;
exports.infoEmbed = infoEmbed;
exports.userProfileEmbed = userProfileEmbed;
exports.levelingEmbed = levelingEmbed;
exports.moderationEmbed = moderationEmbed;
exports.economyEmbed = economyEmbed;
exports.gameEmbed = gameEmbed;
exports.musicQueueEmbed = musicQueueEmbed;
exports.leaderboardEmbed = leaderboardEmbed;
exports.aiEmbed = aiEmbed;
const discord_js_1 = require("discord.js");
/**
 * Sukuna Bot visual system — single source of truth for branded embeds.
 * All modules should use these helpers instead of hand-rolling EmbedBuilder
 * to keep the bot's Discord presence consistent.
 */
exports.BRAND = {
    red: '#ef4444',
    dark: '#0f172a',
    gold: '#ffd700',
    green: '#22c55e',
    blue: '#0099ff',
    purple: '#a855f7',
    orange: '#f97316',
    grey: '#94a3b8',
};
function brandedEmbed(color = exports.BRAND.red) {
    return new discord_js_1.EmbedBuilder()
        .setColor(color)
        .setFooter({ text: 'Sukuna Bot • Version 2.0' })
        .setTimestamp();
}
/** Visual progress bar: ███████░░░░░ 62% */
function progressBar(percentage, width = 14) {
    const pct = Math.max(0, Math.min(100, percentage));
    const filled = Math.round((pct / 100) * width);
    const empty = width - filled;
    return `${'█'.repeat(filled)}${'░'.repeat(empty)} ${pct}%`;
}
function formatNumber(n) {
    return Math.floor(n).toLocaleString('en-US');
}
function formatUptime(seconds) {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const parts = [];
    if (d > 0)
        parts.push(`${d}d`);
    if (h > 0)
        parts.push(`${h}h`);
    if (m > 0)
        parts.push(`${m}m`);
    parts.push(`${s}s`);
    return parts.join(' ');
}
function successEmbed(title, description) {
    return brandedEmbed(exports.BRAND.green)
        .setTitle(`✅ ${title}`)
        .setDescription(description);
}
function errorEmbed(title, description) {
    return brandedEmbed('#ef4444')
        .setTitle(`❌ ${title}`)
        .setDescription(description);
}
function infoEmbed(title, description, color = exports.BRAND.blue) {
    return brandedEmbed(color).setTitle(title).setDescription(description);
}
function userProfileEmbed(opts) {
    const embed = brandedEmbed(opts.color ?? exports.BRAND.red).setTitle(opts.title);
    const icon = opts.user.displayAvatarURL?.();
    if (icon)
        embed.setAuthor({ name: opts.user.username, iconURL: icon });
    else
        embed.setAuthor({ name: opts.user.username });
    if (opts.description)
        embed.setDescription(opts.description);
    if (opts.fields?.length)
        embed.addFields(opts.fields.map(f => f.inline !== undefined ? { name: f.name, value: f.value, inline: f.inline } : { name: f.name, value: f.value }));
    if (icon)
        embed.setThumbnail(icon);
    return embed;
}
function levelingEmbed(opts) {
    const bar = progressBar(opts.percentage);
    const leveled = opts.oldLevel !== undefined && opts.oldLevel !== opts.level;
    const title = opts.title ?? (leveled ? `🎉 Level Up! ${opts.oldLevel} → ${opts.level}` : `📈 Level ${opts.level}`);
    const embed = brandedEmbed(opts.rank === 1 ? exports.BRAND.gold : opts.rank && opts.rank <= 3 ? exports.BRAND.orange : exports.BRAND.red)
        .setTitle(title)
        .setDescription(`**${opts.user.username}** reached **Level ${opts.level}**\n\n` +
        `\`${bar}\`\n` +
        `\`${formatNumber(opts.currentXP)} / ${formatNumber(opts.neededXP)} XP\`\n` +
        `Total XP: **${formatNumber(opts.totalXP)}**` +
        (opts.rank ? `\nRank: **#${opts.rank}**` : ''));
    const icon = opts.user.displayAvatarURL?.();
    if (icon)
        embed.setAuthor({ name: opts.user.username, iconURL: icon });
    else
        embed.setAuthor({ name: opts.user.username });
    if (icon)
        embed.setThumbnail(icon);
    return embed;
}
function moderationEmbed(opts) {
    const colors = {
        warn: '#facc15',
        kick: '#f97316',
        ban: '#ef4444',
        mute: '#eab308',
        unmute: '#22c55e',
        unban: '#22c55e',
        timeout: '#eab308',
        clear: '#9ca3af',
    };
    const emoji = {
        warn: '⚠️', kick: '👢', ban: '🔨', mute: '🔇', unmute: '🔊', unban: '✅', timeout: '⏳', clear: '🧹',
    };
    const label = opts.action === 'mute' ? 'Timeout' : opts.action.toUpperCase();
    return brandedEmbed(colors[opts.action] ?? exports.BRAND.grey)
        .setTitle(`${emoji[opts.action] ?? '🛡️'} ${label} • Case ${opts.caseId}`)
        .addFields({ name: 'User', value: `<@${opts.target.id}> (${opts.target.username})`, inline: true }, { name: 'Moderator', value: `<@${opts.moderator.id}>`, inline: true }, ...(opts.duration ? [{ name: 'Duration', value: opts.duration, inline: true }] : []), { name: 'Reason', value: opts.reason || 'No reason provided' });
}
function economyEmbed(opts) {
    const currency = opts.currencyName ?? 'coins';
    const embed = brandedEmbed('#00d084')
        .setTitle(opts.title ?? `💰 Balance — ${opts.user.username}`)
        .setDescription(`**${formatNumber(opts.balance)}** ${currency}`);
    const icon = opts.user.displayAvatarURL?.();
    if (icon) {
        embed.setAuthor({ name: opts.user.username, iconURL: icon });
        embed.setThumbnail(icon);
    }
    else {
        embed.setAuthor({ name: opts.user.username });
    }
    return embed;
}
function gameEmbed(opts) {
    const currency = opts.currencyName ?? 'coins';
    const typeLabel = opts.type.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    return brandedEmbed(exports.BRAND.purple)
        .setTitle(`🎮 ${typeLabel} Game`)
        .setDescription(`**Prize:** ${formatNumber(opts.prize)} ${currency}\n` +
        `**Entry Fee:** ${formatNumber(opts.entryFee)} ${currency}\n` +
        `**Host:** <@${opts.hostId}>\n` +
        `**Players:** ${opts.players}\n` +
        `**Ends:** <t:${Math.floor(Date.now() / 1000 + opts.endsInSeconds)}:R>`)
        .addFields({ name: 'Join', value: `Click **Join Game** or run \`/joingame ${opts.gameId}\`` });
}
function musicQueueEmbed(opts) {
    const lines = opts.queue.slice(0, 10).map((t, i) => `**${i + 1}.** ${t}`).join('\n') || 'Queue is empty';
    return brandedEmbed(exports.BRAND.blue)
        .setTitle('🎵 Music Queue')
        .setDescription(`**Now Playing**\n${opts.current ?? 'Nothing — use `/play` to start'}\n\n**Up Next**\n${lines}`)
        .addFields({ name: 'Volume', value: `${opts.volume}%`, inline: true });
}
function leaderboardEmbed(opts) {
    const medals = ['🥇', '🥈', '🥉'];
    const lines = opts.entries.map((e, i) => {
        const prefix = medals[i] ?? `**${i + 1}.**`;
        return `${prefix} <@${e.userId}> — ${e.label}`;
    }).join('\n');
    return brandedEmbed(opts.color ?? exports.BRAND.gold).setTitle(opts.title).setDescription(lines || 'No data yet.');
}
function aiEmbed(opts) {
    return brandedEmbed(exports.BRAND.purple)
        .setTitle(`🧠 ${opts.displayName}`)
        .addFields({ name: 'You asked', value: opts.question.slice(0, 1000) || '—' }, { name: 'Answer', value: opts.answer.slice(0, 1000) || '—' });
}
