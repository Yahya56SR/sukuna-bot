import type { Guild, GuildMember, Role, TextChannel, Message } from 'discord.js';
import { ChannelType, PermissionFlagsBits } from 'discord.js';

/**
 * Shared utilities for Discord bot systems — pure utility, no DB dependency.
 */
export class Helpers {
	static formatDuration(ms: number): string {
		if (ms < 1000) return `${ms}ms`;
		const seconds = Math.floor(ms / 1000);
		if (seconds < 60) return `${seconds}s`;
		const minutes = Math.floor(seconds / 60);
		if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
		const hours = Math.floor(minutes / 60);
		if (hours < 24) return `${hours}h ${minutes % 60}m`;
		const days = Math.floor(hours / 24);
		return `${days}d ${hours % 24}h`;
	}

	static ordinal(num: number): string {
		const s = ['th', 'st', 'nd', 'rd'];
		const v = num % 100;
		return num + (s[(v - 20) % 10] || s[v] || s[0]);
	}

	static truncate(str: string, length = 100): string {
		if (str.length <= length) return str;
		return str.substring(0, length - 3) + '...';
	}

	static cleanContent(content: string): string {
		return content
			.replace(/@everyone/g, '@\u200beveryone')
			.replace(/@here/g, '@\u200bhere')
			.replace(/<@&?\d+>/g, '');
	}

	static parseTimeString(str: string): number | null {
		const regex = /(\d+)([smhd])/g;
		let totalMs = 0;
		let match: RegExpExecArray | null;
		while ((match = regex.exec(str)) !== null) {
			const value = parseInt(match[1]);
			const unit = match[2];
			switch (unit) {
				case 's': totalMs += value * 1000; break;
				case 'm': totalMs += value * 60 * 1000; break;
				case 'h': totalMs += value * 60 * 60 * 1000; break;
				case 'd': totalMs += value * 24 * 60 * 60 * 1000; break;
			}
		}
		return totalMs > 0 ? totalMs : null;
	}

	static generateTicketId(): string {
		return (
			Date.now().toString(36).toUpperCase() +
			Math.random().toString(36).substring(2, 6).toUpperCase()
		);
	}

	static hasPermission(member: GuildMember, permissions: bigint[]): boolean {
		if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
		return permissions.every((p) => member.permissions.has(p));
	}

	static describeRoles(guild: Guild, roleIds: string[]): { text: string; missing: string[] } {
		const roles = roleIds
			.map((id) => guild.roles.cache.get(id))
			.filter((role): role is Role => !!role);
		const missing = roleIds.filter((id) => !guild.roles.cache.has(id));
		const text = roles.map((role) => `<@&${role.id}>`).join(', ');
		return { text, missing };
	}

	static describeRole(guild: Guild, roleId: string | null): string | null {
		if (!roleId) return null;
		return guild.roles.cache.has(roleId) ? `<@&${roleId}>` : null;
	}

	static async createTranscript(channel: TextChannel, messages: any[]): Promise<string> {
		const lines = messages.map((m) => {
			const time = new Date(m.created_at || m.createdAt).toLocaleString();
			const author = m.user_id ?? m.author?.id ?? 'unknown';
			const content = m.content || '';
			return `[${time}] ${author}: ${content}`;
		});
		return lines.join('\n');
	}

	static chunkArray<T>(array: T[], size: number): T[][] {
		const chunks: T[][] = [];
		for (let i = 0; i < array.length; i += size) chunks.push(array.slice(i, i + size));
		return chunks;
	}

	static randomColor(): number {
		return Math.floor(Math.random() * 16777215);
	}

	static sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	static buildPermissionOverwrites(
		guild: any,
		allowedRoles: string[] = [],
		deniedRoles: string[] = [],
		allowedUsers: string[] = [],
		deniedUsers: string[] = [],
	): any[] {
		const overwrites: any[] = [
			{ id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
		];
		for (const roleId of allowedRoles) overwrites.push({ id: roleId, allow: [PermissionFlagsBits.ViewChannel] });
		for (const roleId of deniedRoles) overwrites.push({ id: roleId, deny: [PermissionFlagsBits.ViewChannel] });
		for (const userId of allowedUsers) overwrites.push({ id: userId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] });
		for (const userId of deniedUsers) overwrites.push({ id: userId, deny: [PermissionFlagsBits.ViewChannel] });
		return overwrites;
	}
}
