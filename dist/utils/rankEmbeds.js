"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildRankCard = buildRankCard;
exports.buildLeaderboardEmbed = buildLeaderboardEmbed;
const discord_js_1 = require("discord.js");
const level_1 = require("./level");
/**
 * Text fallback for the rank card — used only when the canvas renderer fails.
 */
function buildRankCard(opts) {
    const { user, info } = opts;
    const percent = (0, level_1.progressPercent)(info);
    const remaining = Math.max(0, info.xpForNext - info.xpInLevel);
    const embed = new discord_js_1.EmbedBuilder()
        .setColor(0xef4444)
        .setAuthor({ name: user.username, iconURL: user.displayAvatarURL() })
        .setDescription([
        `**Level ${info.level}**`,
        `${(0, level_1.progressBar)(percent)}  \`${percent}%\``,
        '',
        `\`${info.xpInLevel.toLocaleString()}\` / \`${info.xpForNext.toLocaleString()}\` XP`,
    ].join('\n'))
        .addFields({ name: 'XP to next level', value: `${remaining.toLocaleString()} XP`, inline: true }, { name: 'Total XP', value: info.totalXp.toLocaleString(), inline: true })
        .setFooter({ text: opts.guildName })
        .setTimestamp();
    if (opts.position && opts.position > 0) {
        embed.addFields({ name: 'Rank', value: `#${opts.position}`, inline: true });
    }
    return embed;
}
/**
 * Text fallback for the leaderboard.
 */
function buildLeaderboardEmbed(entries, guildName) {
    const description = entries
        .map((entry, i) => {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `**${i + 1}.**`;
        return `${medal} <@${entry.userId}> — level **${entry.level}** (\`${entry.totalXp.toLocaleString()}\` XP)`;
    })
        .join('\n');
    return new discord_js_1.EmbedBuilder()
        .setColor(0xf59e0b)
        .setTitle('🏆 Top members')
        .setDescription(description)
        .setFooter({ text: guildName })
        .setTimestamp();
}
