/**
 * MEE6-style leaderboard panel — matches the reference design:
 * title + member count, Top 3 podium image, Top 3 list, then
 * Diamond / Gold / Silver zones with progress bars and gap headers.
 *
 * Built on **Components v2**: a container with a media gallery (the podium
 * artwork) ABOVE the text, real separators between the zones, and the
 * `MessageFlags.IsComponentsV2` flag on the message.
 *
 * Data comes from LevelingService (Sukuna XP curve), visuals mirror
 * MEE6 + the L7aj live board.
 */
import {
  AttachmentBuilder,
  ContainerBuilder,
  escapeMarkdown,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  SeparatorBuilder,
  TextDisplayBuilder,
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
 * Build the leaderboard container.
 *
 * The podium artwork is exposed through a media gallery so it renders ABOVE
 * the leaderboard text (an embed image would sit below the fields, and
 * markdown images are not rendered inside component text at all).
 */
export function buildContentPanel(
  entries: LiveEntry[],
  guild: Guild,
  rows: number,
  titleOverride: string,
  updatedAt: number = Date.now(),
  rankChanges?: { movedUp: number; newOnList: number },
  podiumUrl?: string,
): ContainerBuilder {
  const title = (titleOverride || '').trim() || `${guild.name} leaderboard`;
  const top = entries.slice(0, 3);

  const container = new ContainerBuilder().setAccentColor(0x2b2d63);

  // 1. Header
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `# 🏆 ${title}\n👥 **${guild.memberCount.toLocaleString('en-US')}** members · ✨ *Ranked by experience*`,
    ),
  );

  // 2. Podium image (ABOVE the leaderboard text)
  if (podiumUrl) {
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder()
          .setURL(podiumUrl)
          .setDescription('Top three leaderboard members'),
      ),
    );
  }

  // 3. Separator
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));

  // 4. Top 3
  const topLines = top.map(
    (entry, index) =>
      `${MEDALS[index]} ${userLink(entry)} — Lv ${entry.level} · ${formatXp(entry.totalXp)} XP ${progressBar(entry.percent, 6)} ${entry.percent}%`,
  );
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## 👑 Top 3\n${topLines.length > 0 ? clampText(topLines.join('\n'), 900) : 'No ranked members yet.'}`,
    ),
  );

  // 5. Zones
  let budget = 4000;

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

    const room = Math.min(1000, budget - zone.name.length - 20);
    if (room < 160) break;
    const body = clampText(`${header}\n${lines.join('\n')}`, room);
    budget -= body.length + zone.name.length + 20;

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`## ${zone.emoji} ${zone.name}\n${body}`),
    );
  }

  // 6. Footer
  const label = freshnessLabel(updatedAt);
  let footerText = `🔄 Updates automatically · last update ${label}`;
  if (rankChanges && (rankChanges.movedUp > 0 || rankChanges.newOnList > 0)) {
    const parts: string[] = [];
    if (rankChanges.movedUp > 0) parts.push(`▲ ${rankChanges.movedUp} rank change${rankChanges.movedUp === 1 ? '' : 's'} in the last 24h`);
    if (rankChanges.newOnList > 0) parts.push(`🆕 ${rankChanges.newOnList} new on the list`);
    footerText = `${parts.join(' · ')}\n${footerText}`;
  }
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${footerText}`));

  return container;
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
 * Build the components + podium attachment payload for a /leaderboard call.
 * Falls back to text-only if the podium render fails.
 */
export async function buildMessagePayload(
  entries: LiveEntry[],
  guild: Guild,
  rows: number,
  title: string,
  updatedAt: number = Date.now(),
): Promise<{ components: any[]; files: AttachmentBuilder[]; flags: MessageFlags.IsComponentsV2 }> {
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
      components: [buildContentPanel(entries, guild, rows, title, updatedAt, undefined, 'attachment://top-3.png')],
      files: [file],
      flags: MessageFlags.IsComponentsV2,
    };
  } catch {
    return {
      components: [buildContentPanel(entries, guild, rows, title, updatedAt)],
      files: [],
      flags: MessageFlags.IsComponentsV2,
    };
  }
}
