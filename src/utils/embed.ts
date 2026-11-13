import { EmbedBuilder, ColorResolvable } from 'discord.js';

/**
 * Sukuna Bot visual system — single source of truth for branded embeds.
 * All modules should use these helpers instead of hand-rolling EmbedBuilder
 * to keep the bot's Discord presence consistent.
 */

export const BRAND = {
  red: '#ef4444' as ColorResolvable,
  dark: '#0f172a' as ColorResolvable,
  gold: '#ffd700' as ColorResolvable,
  green: '#22c55e' as ColorResolvable,
  blue: '#0099ff' as ColorResolvable,
  purple: '#a855f7' as ColorResolvable,
  orange: '#f97316' as ColorResolvable,
  grey: '#94a3b8' as ColorResolvable,
};

export function brandedEmbed(color: ColorResolvable = BRAND.red): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(color)
    .setFooter({ text: 'Sukuna Bot • Version 2.0' })
    .setTimestamp();
}

/** Visual progress bar: ███████░░░░░ 62% */
export function progressBar(percentage: number, width = 14): string {
  const pct = Math.max(0, Math.min(100, percentage));
  const filled = Math.round((pct / 100) * width);
  const empty = width - filled;
  return `${'█'.repeat(filled)}${'░'.repeat(empty)} ${pct}%`;
}

export function formatNumber(n: number): string {
  return Math.floor(n).toLocaleString('en-US');
}

export function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}

export function successEmbed(title: string, description: string): EmbedBuilder {
  return brandedEmbed(BRAND.green)
    .setTitle(`✅ ${title}`)
    .setDescription(description);
}

export function errorEmbed(title: string, description: string): EmbedBuilder {
  return brandedEmbed('#ef4444')
    .setTitle(`❌ ${title}`)
    .setDescription(description);
}

export function infoEmbed(title: string, description: string, color: ColorResolvable = BRAND.blue): EmbedBuilder {
  return brandedEmbed(color).setTitle(title).setDescription(description);
}

export function userProfileEmbed(opts: {
  user: { username: string; displayAvatarURL?: (() => string) | undefined; tag?: string | undefined };
  userId: string;
  title: string;
  description?: string | undefined;
  fields?: { name: string; value: string; inline?: boolean }[] | undefined;
  color?: ColorResolvable | undefined;
}): EmbedBuilder {
  const embed = brandedEmbed(opts.color ?? BRAND.red).setTitle(opts.title);
  const icon = opts.user.displayAvatarURL?.();
  if (icon) embed.setAuthor({ name: opts.user.username, iconURL: icon });
  else embed.setAuthor({ name: opts.user.username });
  if (opts.description) embed.setDescription(opts.description);
  if (opts.fields?.length) embed.addFields(opts.fields.map(f => f.inline !== undefined ? { name: f.name, value: f.value, inline: f.inline } : { name: f.name, value: f.value }));
  if (icon) embed.setThumbnail(icon);
  return embed;
}

export function levelingEmbed(opts: {
  user: { username: string; displayAvatarURL?: (() => string) | undefined; tag?: string | undefined };
  userId: string;
  level: number;
  oldLevel?: number | undefined;
  totalXP: number;
  currentXP: number;
  neededXP: number;
  percentage: number;
  rank?: number | undefined;
  title?: string | undefined;
}): EmbedBuilder {
  const bar = progressBar(opts.percentage);
  const leveled = opts.oldLevel !== undefined && opts.oldLevel !== opts.level;
  const title = opts.title ?? (leveled ? `🎉 Level Up! ${opts.oldLevel} → ${opts.level}` : `📈 Level ${opts.level}`);

  const embed = brandedEmbed(opts.rank === 1 ? BRAND.gold : opts.rank && opts.rank <= 3 ? BRAND.orange : BRAND.red)
    .setTitle(title)
    .setDescription(
      `**${opts.user.username}** reached **Level ${opts.level}**\n\n` +
      `\`${bar}\`\n` +
      `\`${formatNumber(opts.currentXP)} / ${formatNumber(opts.neededXP)} XP\`\n` +
      `Total XP: **${formatNumber(opts.totalXP)}**` +
      (opts.rank ? `\nRank: **#${opts.rank}**` : '')
    );
  const icon = opts.user.displayAvatarURL?.();
  if (icon) embed.setAuthor({ name: opts.user.username, iconURL: icon });
  else embed.setAuthor({ name: opts.user.username });
  if (icon) embed.setThumbnail(icon);
  return embed;
}

export function moderationEmbed(opts: {
  action: 'warn' | 'kick' | 'ban' | 'mute' | 'unmute' | 'unban' | 'timeout' | 'clear';
  target: { username: string; tag?: string | undefined; id: string };
  moderator: { username: string; tag?: string | undefined; id: string };
  reason: string;
  caseId: string;
  duration?: string | undefined;
}): EmbedBuilder {
  const colors: Record<string, ColorResolvable> = {
    warn: '#facc15',
    kick: '#f97316',
    ban: '#ef4444',
    mute: '#eab308',
    unmute: '#22c55e',
    unban: '#22c55e',
    timeout: '#eab308',
    clear: '#9ca3af',
  };
  const emoji: Record<string, string> = {
    warn: '⚠️', kick: '👢', ban: '🔨', mute: '🔇', unmute: '🔊', unban: '✅', timeout: '⏳', clear: '🧹',
  };
  const label = opts.action === 'mute' ? 'Timeout' : opts.action.toUpperCase();

  return brandedEmbed(colors[opts.action] ?? BRAND.grey)
    .setTitle(`${emoji[opts.action] ?? '🛡️'} ${label} • Case ${opts.caseId}`)
    .addFields(
      { name: 'User', value: `<@${opts.target.id}> (${opts.target.username})`, inline: true },
      { name: 'Moderator', value: `<@${opts.moderator.id}>`, inline: true },
      ...(opts.duration ? [{ name: 'Duration', value: opts.duration, inline: true }] : []),
      { name: 'Reason', value: opts.reason || 'No reason provided' },
    );
}

export function economyEmbed(opts: {
  user: { username: string; displayAvatarURL?: (() => string) | undefined; tag?: string | undefined };
  userId: string;
  balance: number;
  currencyName?: string | undefined;
  title?: string | undefined;
}): EmbedBuilder {
  const currency = opts.currencyName ?? 'coins';
  const embed = brandedEmbed('#00d084')
    .setTitle(opts.title ?? `💰 Balance — ${opts.user.username}`)
    .setDescription(`**${formatNumber(opts.balance)}** ${currency}`);
  const icon = opts.user.displayAvatarURL?.();
  if (icon) {
    embed.setAuthor({ name: opts.user.username, iconURL: icon });
    embed.setThumbnail(icon);
  } else {
    embed.setAuthor({ name: opts.user.username });
  }
  return embed;
}

export function gameEmbed(opts: {
  type: string;
  prize: number;
  entryFee: number;
  hostId: string;
  endsInSeconds: number;
  players: number;
  gameId: string;
  currencyName?: string | undefined;
}): EmbedBuilder {
  const currency = opts.currencyName ?? 'coins';
  const typeLabel = opts.type.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return brandedEmbed(BRAND.purple)
    .setTitle(`🎮 ${typeLabel} Game`)
    .setDescription(
      `**Prize:** ${formatNumber(opts.prize)} ${currency}\n` +
      `**Entry Fee:** ${formatNumber(opts.entryFee)} ${currency}\n` +
      `**Host:** <@${opts.hostId}>\n` +
      `**Players:** ${opts.players}\n` +
      `**Ends:** <t:${Math.floor(Date.now() / 1000 + opts.endsInSeconds)}:R>`
    )
    .addFields({ name: 'Join', value: `Click **Join Game** or run \`/joingame ${opts.gameId}\`` });
}

export function musicQueueEmbed(opts: {
  current: string | null;
  queue: string[];
  volume: number;
}): EmbedBuilder {
  const lines = opts.queue.slice(0, 10).map((t, i) => `**${i + 1}.** ${t}`).join('\n') || 'Queue is empty';
  return brandedEmbed(BRAND.blue)
    .setTitle('🎵 Music Queue')
    .setDescription(`**Now Playing**\n${opts.current ?? 'Nothing — use `/play` to start'}\n\n**Up Next**\n${lines}`)
    .addFields({ name: 'Volume', value: `${opts.volume}%`, inline: true });
}

export function leaderboardEmbed(opts: {
  title: string;
  entries: { userId: string; label: string }[];
  color?: ColorResolvable | undefined;
}): EmbedBuilder {
  const medals = ['🥇', '🥈', '🥉'];
  const lines = opts.entries.map((e, i) => {
    const prefix = medals[i] ?? `**${i + 1}.**`;
    return `${prefix} <@${e.userId}> — ${e.label}`;
  }).join('\n');
  return brandedEmbed(opts.color ?? BRAND.gold).setTitle(opts.title).setDescription(lines || 'No data yet.');
}

export function aiEmbed(opts: {
  question: string;
  answer: string;
  displayName: string;
}): EmbedBuilder {
  return brandedEmbed(BRAND.purple)
    .setTitle(`🧠 ${opts.displayName}`)
    .addFields(
      { name: 'You asked', value: opts.question.slice(0, 1000) || '—' },
      { name: 'Answer', value: opts.answer.slice(0, 1000) || '—' },
    );
}
