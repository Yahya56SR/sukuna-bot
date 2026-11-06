import { EmbedBuilder, type User } from 'discord.js';
import { progressBar, progressPercent, type LevelInfo } from './level.js';

export interface RankCardOptions {
  user: User;
  info: LevelInfo;
  guildName: string;
  position?: number;
}

/**
 * Text fallback for the rank card — used when the canvas renderer fails.
 */
export function buildRankCard(opts: RankCardOptions): EmbedBuilder {
  const { user, info } = opts;
  const percent = progressPercent(info);
  const remaining = Math.max(0, info.xpForNext - info.xpInLevel);

  // Color based on level parity for fun visual variety
  const levelColor = info.level % 2 === 0 ? 0x5865f2 : 0xa033ff;

  // Clamp percent before using it for bar length — a >100 value would make
  // `'▱'.repeat(negative)` throw inside the fallback path itself.
  const safePercent = Math.max(0, Math.min(100, percent));
  const filled = Math.round(safePercent / 5);
  const bar25 = `[${'▰'.repeat(filled)}${'▱'.repeat(20 - filled)}] \`${safePercent}%\``;
  const bar = progressBar(safePercent, 15);

  const embed = new EmbedBuilder()
    .setColor(levelColor)
    .setAuthor({ name: user.username, iconURL: user.displayAvatarURL() })
    .setDescription(bar25)
    .setTitle(`🏆 Level ${info.level}`)
    .addFields(
      { name: 'Progress', value: `${info.xpInLevel.toLocaleString()} / ${info.xpForNext.toLocaleString()} XP`, inline: true },
      { name: 'Total XP', value: info.totalXp.toLocaleString(), inline: true },
    )
    .setTimestamp();

  if (opts.position && opts.position > 0) {
    embed.addFields({ name: 'Overall Rank', value: `#${opts.position}`, inline: true });
  }

  // Single footer carrying rank + progress bar + level (the old code called
  // `setFooter` twice and the second call silently dropped the rank).
  const rankPart = opts.position && opts.position > 0 ? `Rank #${opts.position} • ` : '';
  embed.setFooter({ text: `${rankPart}${opts.guildName} • ${bar} • Level ${info.level}` });

  return embed;
}

export interface LeaderboardEntry {
  userId: string;
  username: string;
  level: number;
  totalXp: number;
}

/**
 * Text fallback for the leaderboard.
 */
export function buildLeaderboardEmbed(
  entries: LeaderboardEntry[],
  guildName: string,
): EmbedBuilder {
  // `setDescription('')` throws a ValidationError — an empty leaderboard
  // (nobody has XP yet) must render a placeholder, not crash.
  const description =
    entries.length === 0
      ? '_Nobody has earned XP yet._'
      : entries
          .map((entry, i) => {
            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `**${i + 1}.**`;
            return `${medal} <@${entry.userId}> — level **${entry.level}** (\`${entry.totalXp.toLocaleString()}\` XP)`;
          })
          .join('\n');

  return new EmbedBuilder()
    .setColor(0xf59e0b)
    .setTitle('🏆 Top members')
    .setDescription(description)
    .setFooter({ text: guildName })
    .setTimestamp();
}
