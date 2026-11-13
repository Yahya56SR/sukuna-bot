"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildRankCard = buildRankCard;
exports.buildLeaderboardPanel = buildLeaderboardPanel;
const discord_js_1 = require("discord.js");
const level_1 = require("./level");
const emoji_1 = require("./emoji");
/**
 * Text fallback for the rank card — used only when the canvas renderer fails.
 * Components v2 container (no embeds).
 */
function buildRankCard(opts) {
    const { user, info } = opts;
    const percent = (0, level_1.progressPercent)(info);
    const remaining = Math.max(0, info.xpForNext - info.xpInLevel);
    const container = new discord_js_1.ContainerBuilder().setAccentColor(0xef4444);
    container.addTextDisplayComponents((textDisplay) => textDisplay.setContent([
        `**${user.username}**`,
        `**Level ${info.level}**`,
        `${(0, level_1.progressBar)(percent)}  \`${percent}%\``,
        '',
        `\`${info.xpInLevel.toLocaleString()}\` / \`${info.xpForNext.toLocaleString()}\` XP`,
        '',
        `**XP to next level:** ${remaining.toLocaleString()} XP`,
        `**Total XP:** ${info.totalXp.toLocaleString()}`,
        ...(opts.position && opts.position > 0 ? [`**Rank:** #${opts.position}`] : []),
    ].join('\n')));
    container.addSeparatorComponents(new discord_js_1.SeparatorBuilder().setDivider(true).setSpacing(1));
    container.addTextDisplayComponents((textDisplay) => textDisplay.setContent(`-# ${opts.guildName}`));
    return container;
}
/**
 * Text fallback for the leaderboard. Components v2 container (no embeds).
 */
function buildLeaderboardPanel(entries, guildName) {
    const description = entries
        .map((entry, i) => {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `**${i + 1}.**`;
        return `${medal} <@${entry.userId}> — level **${entry.level}** (\`${entry.totalXp.toLocaleString()}\` XP)`;
    })
        .join('\n');
    const container = new discord_js_1.ContainerBuilder().setAccentColor(0xf59e0b);
    container.addTextDisplayComponents((textDisplay) => textDisplay.setContent(`# ${(0, emoji_1.resolveEmoji)('trophy')} Top members\n${description || 'No ranked members yet.'}`));
    container.addSeparatorComponents(new discord_js_1.SeparatorBuilder().setDivider(true).setSpacing(1));
    container.addTextDisplayComponents((textDisplay) => textDisplay.setContent(`-# ${guildName}`));
    return container;
}
