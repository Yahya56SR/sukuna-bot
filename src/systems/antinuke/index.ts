import type { Guild, GuildMember, GuildAuditLogsEntry } from 'discord.js';
import { Events, AuditLogEvent, PermissionFlagsBits } from 'discord.js';
import { AntinukeConfig, AntinukeIncident } from '../../db/models/Antinuke.js';
import { EmbedBuilder } from 'discord.js';

/**
 * Anti-nuke system.
 * Uses Mongoose (AntinukeConfig, AntinukeIncident).
 * Note: Config snapshot/backup layer is not ported.
 */
const WATCHED: Record<number, string> = {
	[AuditLogEvent.MemberBanAdd]: 'ban',
	[AuditLogEvent.MemberKick]: 'kick',
	[AuditLogEvent.ChannelDelete]: 'channelDelete',
	[AuditLogEvent.ChannelOverwriteCreate]: 'channelOverwrite',
	[AuditLogEvent.ChannelOverwriteDelete]: 'channelOverwrite',
	[AuditLogEvent.RoleDelete]: 'roleDelete',
	[AuditLogEvent.WebhookDelete]: 'webhookDelete',
	[AuditLogEvent.MessageBulkDelete]: 'bulkDelete',
};

const DANGEROUS_PERMISSIONS: bigint[] = [
	PermissionFlagsBits.Administrator,
	PermissionFlagsBits.ManageGuild,
	PermissionFlagsBits.ManageRoles,
	PermissionFlagsBits.ManageChannels,
	PermissionFlagsBits.ManageWebhooks,
	PermissionFlagsBits.ManageMessages,
	PermissionFlagsBits.BanMembers,
	PermissionFlagsBits.KickMembers,
	PermissionFlagsBits.ManageThreads,
	PermissionFlagsBits.ManageNicknames,
	PermissionFlagsBits.MuteMembers,
	PermissionFlagsBits.ModerateMembers,
	PermissionFlagsBits.MoveMembers,
	PermissionFlagsBits.CreateInstantInvite,
	PermissionFlagsBits.ManageEvents,
];

const DEFAULT_THRESHOLDS = {
	ban: 3, kick: 5, channelDelete: 3, channelOverwrite: 8,
	roleDelete: 3, webhookDelete: 3, bulkDelete: 1, everyoneRole: 1,
};

export class AntiNukeSystem {
	private counters = new Map<string, Map<string, number[]>>();
	private locked = new Set<string>();

	async getConfig(guildId: string) {
		let cfg = await AntinukeConfig.findOne({ guildId }).lean();
		if (!cfg) {
			cfg = await AntinukeConfig.create({ guildId, enabled: false });
		}
		return {
			enabled: cfg.enabled === true,
			alertChannelId: cfg.alertChannelId ?? null,
			thresholds: { ...DEFAULT_THRESHOLDS, ...(cfg.thresholds || {}) },
			windowSec: cfg.windowSec ?? 60,
			timeoutMinutes: cfg.timeoutMinutes ?? 1440,
			autoStrip: cfg.autoStrip ?? true,
			exemptRoleIds: cfg.exemptRoleIds ?? [],
		};
	}

	isEnabled(cfg: any): boolean {
		return cfg.enabled === true;
	}

	async handleAuditEntry(entry: GuildAuditLogsEntry, guild: Guild): Promise<void> {
		const cfg = await this.getConfig(guild.id);
		if (!this.isEnabled(cfg)) return;

		const actorId = entry.executorId;
		if (!actorId) return;
		if (actorId === guild.ownerId) return;
		if (actorId === guild.client.user?.id) return;

		const exempt = cfg.exemptRoleIds || [];
		if (exempt.length) {
			const member = await guild.members.fetch(actorId).catch(() => null);
			if (member && exempt.some((id: string) => member.roles.cache.has(id))) return;
		}

		let action: string | null = null;
		if (WATCHED[entry.action] !== undefined) {
			action = WATCHED[entry.action];
		} else if (
			entry.action === AuditLogEvent.MemberRoleUpdate
			&& entry.changes?.some((c: any) => {
				const key = c.key as string;
				const newId = (c as any)?.new?.id;
				return (key === '$' || key === 'id') && newId === guild.id;
			})
		) {
			action = 'everyoneRole';
		}
		if (!action) return;

		const limit = (cfg.thresholds as any)[action];
		if (!Number.isFinite(limit)) return;

		const count = this.record(actorId, action, cfg.windowSec);
		if (count < limit) return;

		const lockKey = `${guild.id}:${actorId}`;
		if (this.locked.has(lockKey)) return;
		this.locked.add(lockKey);

		await this.lockdown(guild, actorId, action, count, cfg, entry);
		setTimeout(() => this.locked.delete(lockKey), Math.max(60_000, cfg.windowSec * 1000 * 4)).unref?.();
	}

	private record(actorId: string, action: string, windowSec: number): number {
		let byAction = this.counters.get(actorId);
		if (!byAction) {
			byAction = new Map();
			this.counters.set(actorId, byAction);
		}
		const now = Date.now();
		const cutoff = now - windowSec * 1000;
		const stamps = (byAction.get(action) || []).filter((t) => t > cutoff);
		stamps.push(now);
		byAction.set(action, stamps);
		return stamps.length;
	}

	private async lockdown(
		guild: Guild,
		actorId: string,
		action: string,
		count: number,
		cfg: any,
		entry: GuildAuditLogsEntry,
	): Promise<void> {
		console.warn(`[AntiNuke] ${actorId} tripped ${action} (${count} in ${cfg.windowSec}s) in ${guild.id}`);
		const member = await guild.members.fetch(actorId).catch(() => null);
		if (!member) {
			await this.recordIncident(guild.id, actorId, undefined, action, count, cfg, [], 0, 'actor left the server before lockdown');
			return;
		}

		const stripped: string[] = [];
		if (cfg.autoStrip) {
			const me = guild.members.me;
			for (const role of member.roles.cache.values()) {
				if (role.id === guild.id) continue;
				if (role.managed) continue;
				if (me && role.position >= me.roles.highest.position) continue;
				if (!DANGEROUS_PERMISSIONS.some((p) => role.permissions.has(p))) continue;
				const ok = await member.roles.remove(role, 'Anti-nuke: destructive action spike').then(() => true).catch(() => false);
				if (ok) stripped.push(role.id);
			}
		}

		let timedOut = false;
		if (cfg.timeoutMinutes > 0) {
			timedOut = await member.timeout(cfg.timeoutMinutes * 60_000, `Anti-nuke: ${count}x ${action} in ${cfg.windowSec}s`)
				.then(() => true).catch(() => false);
		}

		const details = [
			`Audit action ${entry.action} (#${entry.id})`,
			entry.reason ? `reason: ${entry.reason}` : null,
			entry.targetId ? `target: ${entry.targetId}` : null,
		].filter(Boolean).join(' · ');

		await this.recordIncident(guild.id, actorId, member.user.tag, action, count, cfg, stripped, timedOut ? cfg.timeoutMinutes : 0, details);
		await this.alert(guild, member, action, count, cfg, stripped, timedOut, (cfg.thresholds as any)[action]);
	}

	private async recordIncident(
		guildId: string,
		actorId: string,
		actorTag: string | undefined,
		action: string,
		count: number,
		cfg: any,
		stripped: string[],
		timeoutMinutes: number,
		details: string,
	): Promise<void> {
		await AntinukeIncident.create({
			guildId,
			actorId,
			actorTag: actorTag ?? undefined,
			action,
			count,
			windowSec: cfg.windowSec,
			strippedRoles: stripped,
			timeoutMinutes: timeoutMinutes,
			status: 'locked',
			details,
		});
	}

	private async alert(
		guild: Guild,
		member: GuildMember,
		action: string,
		count: number,
		cfg: any,
		stripped: string[],
		timedOut: boolean,
		limit: number,
	): Promise<void> {
		if (!cfg.alertChannelId) return;
		try {
			const channel = await guild.channels.fetch(cfg.alertChannelId).catch(() => null);
			if (!channel || !channel.isTextBased()) return;
			const embed = new EmbedBuilder()
				.setColor(0xED4245)
				.setTitle('🛡️ Anti-nuke: staff member locked down')
				.setDescription(
					`<@${member.id}> performed **${count}×** \`${action}\` within ${cfg.windowSec}s (limit: ${limit}).\n`
					+ 'Treated as a compromised or malicious account.',
				)
				.addFields(
					{ name: 'Timeout', value: timedOut ? `⏱ ${cfg.timeoutMinutes} minutes` : '⚠️ could not apply', inline: true },
					{ name: 'Roles removed', value: stripped.length ? stripped.map((id) => `<@&${id}>`).join(' ') : 'None', inline: false },
				)
				.setFooter({ text: 'The server owner is never restricted. Review, then unlock if it was legitimate.' })
				.setTimestamp();
			await (channel as any).send({ content: '@here', embeds: [embed] });
		} catch (error: any) {
			console.error('[AntiNuke] Failed to send alert:', error?.message || error);
		}
	}

	async unlock(guild: Guild, userId: string): Promise<{ restored: string[]; skipped: string[]; resolved: number }> {
		const incidents = await AntinukeIncident.find({ guildId: guild.id, actorId: userId, status: 'locked' }).sort({ createdAt: 1 });
		if (!incidents.length) return { restored: [], skipped: [], resolved: 0 };

		const member = await guild.members.fetch(userId).catch(() => null);
		const restored: string[] = [];
		const skipped: string[] = [];

		if (member) {
			await member.timeout(null, 'Anti-nuke: reviewed and unlocked').catch(() => {});
			const me = guild.members.me;
			const roleIds = new Set<string>();
			for (const inc of incidents) {
				try { for (const id of (inc.strippedRoles ?? [])) roleIds.add(id); } catch {}
			}
			for (const id of roleIds) {
				const role = guild.roles.cache.get(id);
				if (!role) { skipped.push(`${id} (deleted)`); continue; }
				if (role.managed) { skipped.push(`${role.name} (managed)`); continue; }
				if (me && role.position >= me.roles.highest.position) { skipped.push(`${role.name} (above my highest role)`); continue; }
				if (member.roles.cache.has(id)) continue;
				const ok = await member.roles.add(role, 'Anti-nuke: roles restored after review').then(() => true).catch(() => false);
				(ok ? restored : skipped).push(ok ? role.name : `${role.name} (failed)`);
			}
		}

		await AntinukeIncident.updateMany({ guildId: guild.id, actorId: userId, status: 'locked' }, { status: 'unlocked' });
		return { restored, skipped, resolved: incidents.length };
	}
}

export const antinuke = new AntiNukeSystem();

export const guildAuditLogEntryCreate = {
	name: Events.GuildAuditLogEntryCreate as keyof import('discord.js').ClientEvents,
	execute: async (_client: any, entry: GuildAuditLogsEntry, guild: Guild) => {
		try { await antinuke.handleAuditEntry(entry, guild).catch(() => {}); } catch {}
	},
};
