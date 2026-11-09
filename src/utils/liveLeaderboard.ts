/**
 * MEE6-style leaderboard embed — matches the reference design:
 * title + member count, Top 3 podium image, Top 3 list, then
 * Diamond / Gold / Silver zones with progress bars and gap headers.
 *
 * Data comes from LevelingService (Sukuna XP curve), visuals mirror
 * MEE6 + the L7aj live board.
 */
import {
  AttachmentBuilder,
  EmbedBuilder,
  escapeMarkdown,
  type Guild,
} from 'discord.js';
import { leaderboardPodium } from './rankcard';
import { progressBar } from './level';

export interface LiveEntry {
  rank: number;
  userId: string;
  username: string;
  avatarUrl: string;
  level: number;
  totalXp: number;
  xpInLevel: number;
  xpForNext: number;
  percent: number;
}

interface Zone {
  emoji: string;
  name: string;
  from: number;
  to: number;
}

const ZONES: Zone[] = [
  { emoji: '💎', name: 'Diamond Zone', from: 4, to: 10 },
  { emoji: '🏅', name: 'Gold Zone', from: 11, to: 18 },
  { emoji: '⚪', name: 'Silver Zone', from: 19, to: 25 },
];

const DIVIDER = '─'.repeat(46);
const MEDALS = ['🥇', '🥈', '🥉'];

function formatXp(value: number): string {
  return Math.floor(value).toLocaleString('en-US');
}

function clampText(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

function linkText(text: string): string {
  return escapeMarkdown(clampText(text, 16))
    .replace(/\[/g, '［')
    .replace(/\]/g, '］');
}

function userLink(entry: LiveEntry): string {
  return `[${linkText(entry.username)}](https://discord.com/users/${entry.userId})`;
}

export function freshnessLabel(updatedAt: number, now: number = Date.now()): string {
  if (!updatedAt) return 'just now';
  const minutes = Math.max(0, Math.floor((now - updatedAt) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes === 1) return '1 minute ago';
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
}

/**
 * Build the content embed. The podium image is inlined at the TOP of the
 * description as `![Top 3](attachment://top-3.png)` so it renders above all
 * the text fields (setImage() always renders after the fields in Discord).
 */
export function buildContentEmbed(
  entries: LiveEntry[],
  guild: Guild,
  rows: number,
  titleOverride: string,
  podiumUrl?: string,
  updatedAt: number = Date.now(),
  rankChanges?: { movedUp: number; newOnList: number },
): EmbedBuilder {
  const title = (titleOverride || '').trim() || `🏆 ${guild.name} leaderboard`;
  const top = entries.slice(0, 3);

  const podiumMarkdown = podiumUrl ? `![Top 3 Podium](${podiumUrl})\n\n` : '';
  const description = `${podiumMarkdown}👥 **${guild.memberCount.toLocaleString('en-US')}** members ✨ *Ranked by experience*`;

  const embed = new EmbedBuilder()
    .setColor(0x2b2d63)
    .setTitle(clampText(title, 256))
    .setDescription(description)
    .addFields({ name: '​', value: DIVIDER, inline: false });

  const topLines = top.map(
    (entry, index) =>
      `${MEDALS[index]} ${userLink(entry)} — Lv ${entry.level} · ${formatXp(entry.totalXp)} XP ${progressBar(entry.percent, 6)} ${entry.percent}%`,
  );
  embed.addFields({
    name: '👑 Top 3',
    value: topLines.length > 0 ? topLines.join('\n') : 'No ranked members yet.',
    inline: false,
  });

  for (const zone of ZONES) {
    const from = zone.from;
    if (from > rows || from > entries.length + 1) continue;
    const to = Math.min(zone.to, rows);
    const zoneEntries = entries.filter((e) => e.rank >= from && e.rank <= to);
    if (zoneEntries.length === 0) continue;

    const above = entries[from - 2];
    const first = entries[from - 1];
    const gap = above && first ? Math.max(0, above.totalXp - first.totalXp) : 0;
    const target =
      from === 4 ? 'Top 3' : (ZONES.find((z) => z.to === from - 1)?.name ?? 'the next zone');
    const header =
      gap > 0
        ? `Ranks ${from} – ${to} ⚡ \`${formatXp(gap)} XP\` to pass #${from - 1} and enter ${target}`
        : `Ranks ${from} – ${to}`;

    const lines = zoneEntries.map((entry) => {
      const rankLabel = String(entry.rank).padStart(2, '0');
      const bar = progressBar(entry.percent, 6);
      return `\`${rankLabel}\` ${userLink(entry)} — Lv ${entry.level} · ${formatXp(entry.totalXp)} XP ${bar} ${entry.percent}%`;
    });

    embed.addFields(
      { name: '​', value: DIVIDER, inline: false },
      {
        name: `${zone.emoji} ${zone.name}`,
        value: clampText(`${header}\n${lines.join('\n')}`, 1024),
        inline: false,
      },
    );
  }

  const label = freshnessLabel(updatedAt);
  // Podium is already inlined at the top of the description (see above) —
  // do NOT setImage() here: Discord renders embed images AFTER the fields,
  // which would put the podium at the bottom again.

  let footerText = `🔄 Updates automatically · last update ${label}`;
  if (rankChanges && (rankChanges.movedUp > 0 || rankChanges.newOnList > 0)) {
    const parts: string[] = [];
    if (rankChanges.movedUp > 0) parts.push(`▲ ${rankChanges.movedUp} rank change${rankChanges.movedUp === 1 ? '' : 's'} in the last 24h`);
    if (rankChanges.newOnList > 0) parts.push(`🆕 ${rankChanges.newOnList} new on the list`);
    footerText = `${parts.join(' · ')}\n${footerText}`;
  }

  return embed
    .setFooter({ text: footerText })
    .setTimestamp(new Date(updatedAt || Date.now()));
}

/** Collect entries from LevelingService in MEE6 display shape. */
export async function collectEntries(
  service: any,
  guild: Guild,
  limit: number,
  client?: any,
): Promise<LiveEntry[]> {
  const rows = await service.getLeaderboard(guild.id, limit);
  const out: LiveEntry[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const userId = row.id;
    const member = guild.members.cache.get(userId);
    let user: any = member?.user ?? client?.users.cache.get(userId);
    if (!user && client) {
      try { user = await client.users.fetch(userId); } catch { user = undefined; }
    }
    const level = row.level || 1;
    const totalXp = row.total_xp || 0;
    const progress = service.getLevelProgress(totalXp, level);
    out.push({
      rank: i + 1,
      userId,
      username: member?.displayName ?? user?.globalName ?? user?.username ?? row.username ?? 'Unknown',
      avatarUrl: member
        ? member.displayAvatarURL({ extension: 'png', size: 256 })
        : user?.displayAvatarURL?.({ extension: 'png', size: 256 }) ?? '',
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
 * Build embed + podium attachment payload for a one-shot /leaderboard call.
 * Falls back to text-only if the podium render fails.
 */
export async function buildMessagePayload(
  entries: LiveEntry[],
  guild: Guild,
  rows: number,
  title: string,
  updatedAt: number = Date.now(),
): Promise<{ embeds: EmbedBuilder[]; files: AttachmentBuilder[] }> {
  try {
    const buffer = await leaderboardPodium.generate(
      entries.slice(0, 3).map((e) => ({
        username: e.username,
        avatarUrl: e.avatarUrl,
        level: e.level,
        totalXp: e.totalXp,
        percent: e.percent,
      })),
    );
    const file = new AttachmentBuilder(buffer, { name: 'top-3.png' });
    return {
      embeds: [buildContentEmbed(entries, guild, rows, title, 'attachment://top-3.png', updatedAt)],
      files: [file],
    };
  } catch {
    return { embeds: [buildContentEmbed(entries, guild, rows, title, undefined, updatedAt)], files: [] };
  }
}
