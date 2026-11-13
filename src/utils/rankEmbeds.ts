import { ContainerBuilder, SeparatorBuilder, TextDisplayBuilder, User } from 'discord.js';
import { LevelInfo, progressBar, progressPercent } from './level';

export interface RankCardOptions {
  user: User;
  info: LevelInfo;
  guildName: string;
  position?: number | undefined;
}

/**
 * Text fallback for the rank card — used only when the canvas renderer fails.
 * Components v2 container (no embeds).
 */
export function buildRankCard(opts: RankCardOptions): ContainerBuilder {
  const { user, info } = opts;
  const percent = progressPercent(info);
  const remaining = Math.max(0, info.xpForNext - info.xpInLevel);

  const container = new ContainerBuilder().setAccentColor(0xef4444);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      [
        `**${user.username}**`,
        `**Level ${info.level}**`,
        `${progressBar(percent)}  \`${percent}%\``,
        '',
        `\`${info.xpInLevel.toLocaleString()}\` / \`${info.xpForNext.toLocaleString()}\` XP`,
        '',
        `**XP to next level:** ${remaining.toLocaleString()} XP`,
        `**Total XP:** ${info.totalXp.toLocaleString()}`,
        ...(opts.position && opts.position > 0 ? [`**Rank:** #${opts.position}`] : []),
      ].join('\n'),
    ),
  );
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${opts.guildName}`));

  return container;
}

export interface LeaderboardEntry {
  userId: string;
  username: string;
  level: number;
  totalXp: number;
}

/**
 * Text fallback for the leaderboard. Components v2 container (no embeds).
 */
export function buildLeaderboardPanel(
  entries: LeaderboardEntry[],
  guildName: string,
): ContainerBuilder {
  const description = entries
    .map((entry, i) => {
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `**${i + 1}.**`;
      return `${medal} <@${entry.userId}> — level **${entry.level}** (\`${entry.totalXp.toLocaleString()}\` XP)`;
    })
    .join('\n');

  const container = new ContainerBuilder().setAccentColor(0xf59e0b);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`# 🏆 Top members\n${description || 'No ranked members yet.'}`),
  );
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${guildName}`));

  return container;
}
