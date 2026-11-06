import type { GuildMember, Message } from 'discord.js';
import { User } from '../../db/models/User.js';
import { Guild } from '../../db/models/Guild.js';
import { addXp } from '../../db/utils.js';
import { clampInt, pruneMap } from '../../core/safety.js';

export interface LevelSettings {
	enabled: boolean;
	announce_enabled: boolean;
	announce_channel_id: string | null;
	announce_message: string;
	xp_min: number;
	xp_max: number;
	xp_multiplier: number;
	cooldown_seconds: number;
	stack_roles: boolean;
	ignored_channels: string[];
	vc_enabled: boolean;
	vc_interval_seconds: number;
	vc_xp_amount: number;
	ignored_voice_channels: string[];
}

export interface RankData {
	xp: number;
	total_messages: number;
	level: number;
	xp_into_level: number;
	xp_needed: number;
	rank: number | null;
	total_ranked: number;
	has_data: boolean;
}

export interface LeaderboardEntry {
	user_id: string;
	xp: number;
	level: number;
	xp_into_level: number;
	xp_needed: number;
	total_messages: number;
}

/** MEE6 level curve: XP required to advance FROM `level` to `level + 1`. */
export function xpForNextLevel(level: number): number {
	return 5 * level * level + 50 * level + 100;
}

/** Splits a total XP amount into the current level, progress inside it and the requirement. */
export function levelFromTotalXp(xp: number): { level: number; xpIntoLevel: number; xpNeeded: number } {
	let level = 0;
	let remaining = Math.max(0, Math.floor(xp));

	while (level < 10000) {
		const needed = xpForNextLevel(level);
		if (remaining < needed) break;
		remaining -= needed;
		level++;
	}

	return { level, xpIntoLevel: remaining, xpNeeded: xpForNextLevel(level) };
}

function randomInt(min: number, max: number): number {
	return Math.floor(Math.random() * (max - min + 1)) + min;
}

export class LevelingSystem {
	async getSettings(guildId: string): Promise<LevelSettings> {
		// Atomic upsert: concurrent first-use rows cannot throw duplicate-key.
		const row = await Guild.findOneAndUpdate(
			{ guildId },
			{ $setOnInsert: { guildId, xpEnabled: true, xpCooldown: 60, xpMin: 15, xpMax: 25 } },
			{ upsert: true, new: true, setDefaultsOnInsert: true },
		).lean();
		const r = row as any;

		return {
			enabled: r.xpEnabled !== false,
			announce_enabled: true,
			announce_channel_id: r.levelUpChannel ?? null,
			announce_message: r.levelUpMessage ?? '🎉 Congratulations {user}, you have reached **level {level}**!',
			xp_min: r.xpMin ?? 15,
			xp_max: r.xpMax ?? 25,
			xp_multiplier: 1,
			cooldown_seconds: r.xpCooldown ?? 60,
			stack_roles: true,
			ignored_channels: Array.isArray(r.disableXpChannels) ? r.disableXpChannels : [],
			vc_enabled: false,
			vc_interval_seconds: 300,
			vc_xp_amount: 10,
			ignored_voice_channels: [],
		};
	}

	private isSilent(member: GuildMember): boolean {
		const v = member.voice;
		if (!v) return true;
		return !!v.selfMute || !!v.serverMute || !!v.selfDeaf || !!v.serverDeaf || !!v.suppress;
	}

	/** guildId:userId -> interval handle awarding unmuted-time XP. */
	private voiceSessions = new Map<string, NodeJS.Timeout>();

	async handleVoiceChange(member: GuildMember, channelId: string | null): Promise<void> {
		const guild = member.guild;
		const key = `${guild.id}:${member.id}`;
		const settings = await this.getSettings(guild.id);

		if (!channelId || member.user.bot || !settings.enabled || !settings.vc_enabled) {
			const existing = this.voiceSessions.get(key);
			if (existing) {
				clearInterval(existing);
				this.voiceSessions.delete(key);
			}
			return;
		}

		if (settings.ignored_voice_channels.includes(channelId)) return;
		if (this.voiceSessions.has(key)) return;

		const intervalMs = Math.max(30, settings.vc_interval_seconds) * 1000;
		const startedAt = Date.now();
		const timer = setInterval(() => {
			void this.tickVoiceSession(member, key, channelId, startedAt, settings, intervalMs);
		}, intervalMs);
		timer.unref();
		this.voiceSessions.set(key, timer);
	}

	private async tickVoiceSession(
		member: GuildMember,
		key: string,
		channelId: string,
		startedAt: number,
		settings: LevelSettings,
		intervalMs: number,
	): Promise<void> {
		try {
			if (member.voice.channelId !== channelId || !settings.enabled || !settings.vc_enabled) {
				const timer = this.voiceSessions.get(key);
				if (timer) clearInterval(timer);
				this.voiceSessions.delete(key);
				return;
			}
			if (settings.ignored_voice_channels.includes(channelId)) return;
			if (this.isSilent(member)) return;

			const connectedMs = Date.now() - startedAt;
			const ticks = Math.floor(connectedMs / intervalMs);
			const gain = Math.max(1, Math.round(settings.vc_xp_amount * Math.max(1, ticks)));

			await this.grantXp(member, gain, settings);
		} catch (error) {
			console.error('[Levels] Voice XP tick failed:', error);
		}
	}

	private async grantXp(member: GuildMember, gain: number, settings: LevelSettings): Promise<boolean> {
		// Atomic $inc via addXp — the old read-modify-save lost awards under
		// concurrent message+voice XP (last writer won).
		const result = await addXp(member.id, gain, 'voice');
		if (result.leveledUp) {
			await this.onLevelUpForMember(member, result.newLevel, settings);
		}
		return true;
	}

	stopAllVoiceSessions(): void {
		for (const timer of this.voiceSessions.values()) clearInterval(timer);
		this.voiceSessions.clear();
	}

	async setSettings(guildId: string, data: any): Promise<void> {
		if (!/^\d{5,25}$/.test(guildId)) throw new Error('Invalid guild id');
		const updates: any = {};
		if (data.enabled !== undefined) updates.xpEnabled = Boolean(data.enabled);
		if (data.cooldown_seconds !== undefined) {
			updates.xpCooldown = clampInt(data.cooldown_seconds, 60, 0, 86400);
		}
		if (data.xp_min !== undefined) updates.xpMin = clampInt(data.xp_min, 15, 0, 10000);
		if (data.xp_max !== undefined) updates.xpMax = clampInt(data.xp_max, 25, 0, 10000);
		if (updates.xpMin !== undefined && updates.xpMax !== undefined && updates.xpMin > updates.xpMax) {
			throw new Error('Minimum XP cannot exceed maximum XP');
		}
		if (data.announce_channel_id !== undefined) {
			if (data.announce_channel_id !== null && !/^\d{5,25}$/.test(String(data.announce_channel_id))) throw new Error('Invalid announce channel id');
			updates.levelUpChannel = data.announce_channel_id;
		}
		if (data.announce_message !== undefined) {
			const msg = String(data.announce_message).slice(0, 2000);
			updates.levelUpMessage = msg;
		}
		if (Object.keys(updates).length === 0) throw new Error('No settings supplied');
		await Guild.findOneAndUpdate({ guildId }, { $set: updates }, { upsert: true, new: true, setDefaultsOnInsert: true });
	}

	async processMessage(message: Message): Promise<boolean> {
		try {
			if (!message.guild || message.author.bot || !message.content) return false;

			const settings = await this.getSettings(message.guild.id);
			if (!settings.enabled) return false;
			if (settings.ignored_channels.includes(message.channel.id)) return false;

			const now = Date.now();
			const user = await User.findOne({ userId: message.author.id }).lean();
			if (user?.lastMessageAt) {
				const last = user.lastMessageAt.getTime();
				if (now - last < settings.cooldown_seconds * 1000) {
					return false;
				}
			}

			const min = Math.min(settings.xp_min, settings.xp_max);
			const max = Math.max(settings.xp_min, settings.xp_max);
			const gain = Math.max(1, Math.round(randomInt(min, max) * settings.xp_multiplier));

			// Atomic award — never read-modify-save here (see grantXp note).
			const result = await addXp(message.author.id, gain, 'message');
			if (result.leveledUp) {
				let member = message.member;
				if (!member) {
					member = await message.guild.members.fetch(message.author.id).catch(() => null as any);
				}
				if (member) await this.onLevelUp(message, member, result.newLevel, settings);
			}

			return true;
		} catch (error) {
			console.error('[Levels] Failed to process message XP:', error);
			return false;
		}
	}

	async getRankData(guildId: string, userId: string): Promise<RankData> {
		const user = await User.findOne({ userId });
		const progress = levelFromTotalXp(user?.xp ?? 0);

		const totalRanked = await User.countDocuments({ xp: { $gt: 0 } });
		const rank = user && (user.xp ?? 0) > 0
			? (await User.countDocuments({ xp: { $gt: (user.xp ?? 0) } })) + 1
			: null;

		return {
			xp: user?.xp ?? 0,
			total_messages: 0,
			level: progress.level,
			xp_into_level: progress.xpIntoLevel,
			xp_needed: progress.xpNeeded,
			rank,
			total_ranked: totalRanked,
			has_data: !!user,
		};
	}

	getLeaderboard(guildId: string, limit: number = 10): Promise<LeaderboardEntry[]> {
		return User.find({ xp: { $gt: 0 } })
			.sort({ xp: -1, level: -1 })
			.limit(limit)
			.lean()
			.then((rows) => rows.map((row) => {
				const progress = levelFromTotalXp(row.xp ?? 0);
				return {
					user_id: row.userId,
					xp: row.xp ?? 0,
					level: progress.level,
					xp_into_level: progress.xpIntoLevel,
					xp_needed: progress.xpNeeded,
					total_messages: 0,
				};
			}));
	}

	async applyRoleRewards(member: GuildMember, level: number, settings?: LevelSettings): Promise<void> {
		try {
			const cfg = settings ?? await this.getSettings(member.guild.id);
			const levelRoles: Record<string, string> = (member.guild as any).levelRoles ?? {};
			const roleEntries = Object.entries(levelRoles).map(([levelStr, roleId]) => ({ level: parseInt(levelStr, 10), roleId }));

			const manageable = roleEntries.filter((reward) => {
				const role = member.guild.roles.cache.get(reward.roleId);
				return role && role.editable;
			});
			if (!manageable.length) return;

			const eligible = manageable
				.filter((reward) => reward.level <= level)
				.sort((a, b) => b.level - a.level);
			const keep = cfg.stack_roles ? eligible : eligible.slice(0, 1);
			const keepIds = new Set(keep.map((reward) => reward.roleId));

			const toAdd = [...keepIds].filter((roleId) => !member.roles.cache.has(roleId));
			const toRemove = manageable
				.map((reward) => reward.roleId)
				.filter((roleId) => !keepIds.has(roleId) && member.roles.cache.has(roleId));

			if (toAdd.length) await member.roles.add(toAdd, 'Level reward');
			if (toRemove.length) await member.roles.remove(toRemove, 'Level reward no longer earned');
		} catch (error) {
			console.warn('[Levels] Failed to apply role rewards:', (error as Error)?.message ?? error);
		}
	}

	private async onLevelUpForMember(member: GuildMember, level: number, settings: LevelSettings): Promise<void> {
		const guild = member.guild;
		await this.applyRoleRewards(member, level, settings);

		if (!settings.announce_enabled || !settings.announce_message) return;

		let channel: any = null;
		if (settings.announce_channel_id) {
			channel = guild.channels.cache.get(settings.announce_channel_id) ?? (await guild.channels.fetch(settings.announce_channel_id).catch(() => null));
		}
		if (!channel || typeof channel.send !== 'function') return;

		const content = settings.announce_message
			.replace(/\{user\}/g, `<@${member.id}>`)
			.replace(/\{username\}/g, member.user.username)
			.replace(/\{level\}/g, String(level))
			.replace(/\{server\}/g, guild.name)
			.replace(/\{channel\}/g, member.voice.channelId ? `<#${member.voice.channelId}>` : 'voice');

		try { await channel.send({ content, allowedMentions: { users: [member.id] } }); } catch (error) {
			console.warn('[Levels] Failed to send level-up message:', (error as Error)?.message ?? error);
		}
	}

	private async onLevelUp(message: Message, member: GuildMember | null, level: number, settings: LevelSettings): Promise<void> {
		const guild = message.guild;
		if (!guild) return;

		if (member) {
			await this.applyRoleRewards(member, level, settings);
		}

		if (!settings.announce_enabled || !settings.announce_message) return;

		let channel: any = message.channel;
		if (settings.announce_channel_id && settings.announce_channel_id !== message.channel.id) {
			channel = guild.channels.cache.get(settings.announce_channel_id) ?? (await guild.channels.fetch(settings.announce_channel_id).catch(() => null));
		}
		if (!channel || typeof channel.send !== 'function') return;

		const content = settings.announce_message
			.replace(/\{user\}/g, `<@${message.author.id}>`)
			.replace(/\{username\}/g, message.author.username)
			.replace(/\{level\}/g, String(level))
			.replace(/\{server\}/g, guild.name)
			.replace(/\{channel\}/g, `<#${message.channel.id}>`);

		try { await channel.send({ content, allowedMentions: { users: [message.author.id] } }); } catch (error) {
			console.warn('[Levels] Failed to send level-up message:', (error as Error)?.message ?? error);
		}
	}
}

export const levels = new LevelingSystem();

export const messageCreateLevels = {
	name: 'messageCreate' as const,
	execute: async (_client: any, message: Message) => {
		try { await levels.processMessage(message).catch(() => {}); } catch {}
	},
};

export const voiceStateUpdateLevels = {
	name: 'voiceStateUpdate' as const,
	execute: async (_client: any, oldState: any, newState: any) => {
		if (!newState.member || newState.member.user.bot) return;
		try { await levels.handleVoiceChange(newState.member, newState.channelId ?? null).catch(() => {}); } catch {}
		try { await levels.handleVoiceChange(oldState.member, oldState.channelId ?? null).catch(() => {}); } catch {}
	},
};
