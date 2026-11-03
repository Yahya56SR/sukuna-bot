import { Guild } from "../database/models/Guild";
import { User } from "../database/models/User";

export async function getGuild(guildId: string) {
  let guild = await Guild.findOne({ guildId });
  if (!guild) {
    guild = await Guild.create({ guildId });
  }
  return guild;
}

export async function getUser(userId: string) {
  let user = await User.findOne({ userId });
  if (!user) {
    user = await User.create({ userId });
  }
  return user;
}

export function isOwner(client: any, userId: string): boolean {
  return client.owners.includes(userId);
}

export function hasPermission(member: any, permission: string): boolean {
  if (!member) return false;
  return member.permissions.has(permission) || member.permissions.has("Administrator");
}

export function formatNumber(num: number): string {
  return new Intl.NumberFormat().format(num);
}

export function formatTime(ms: number): string {
  const seconds = Math.floor((ms / 1000) % 60);
  const minutes = Math.floor((ms / (1000 * 60)) % 60);
  const hours = Math.floor((ms / (1000 * 60 * 60)) % 24);
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);
  return parts.join(" ");
}

export function xpForLevel(level: number): number {
  return Math.floor(5 * Math.pow(level, 2) + 50 * level + 100);
}
