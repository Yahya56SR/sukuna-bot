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

  const embed = new EmbedBuilder()
    .setColor(levelColor)
    .setAuthor({ name: user.username, iconURL: user.displayAvatarURL() })
    .setDescription(`[${'▰'.repeat(Math.round(percent / 5))}${'▱'.repeat(20 - Math.round(percent / 5))}] \`${percent}%\``)
    .setTitle(`🏆 Level ${info.level}`)
    .addFields(
      { name: 'Progress', value: `${info.xpInLevel.toLocaleString()} / ${info.xpForNext.toLocaleString()} XP`, inline: true },
      { name: 'Total XP', value: info.totalXp.toLocaleString(), inline: true },
    )
    .setFooter({ text: `Rank #${opts.position || ''} • ${opts.guildName}` })
    .setTimestamp();

  if (opts.position && opts.position > 0) {
    embed.addFields({ name: 'Overall Rank', value: `#${opts.position}`, inline: true });
  }

  // Add level-up progress bar at the bottom as a description supplement
  const bar = progressBar(percent, 15);
  embed.setFooter({ text: `${opts.guildName} • ${bar} • Level ${info.level}` });

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
  const description = entries
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
