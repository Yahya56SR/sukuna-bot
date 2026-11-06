import type { Client, Guild, GuildMember, Presence } from 'discord.js';
import { Events, EmbedBuilder } from 'discord.js';
import { PresentationConfig } from '../../db/models/Presentation.js';

/**
 * Automatic presentation open/close announcements (ported from astralcraft).
 * Persists panel message id + state in PresentationConfig instead of config.json.
 */
export interface AutoStatusConfig {
	enabled: boolean;
	announcementsChannelId?: string;
	debounceSec?: number;
	pingRoleId?: string;
	panelMessageId?: string;
}

class PresentationAutoStatus {
	/** guildId -> staff user ids currently counted as available. */
	private available = new Map<string, Set<string>>();
	/** guildId -> pending close-announcement timer. */
	private closeTimers = new Map<string, NodeJS.Timeout>();
	/** guildId -> last announced state. */
	private lastAnnounced = new Map<string, boolean>();

	private async getCfg(guildId: string): Promise<AutoStatusConfig> {
		let cfg = await PresentationConfig.findOne({ guildId }).lean();
		if (!cfg) {
			cfg = await PresentationConfig.create({ guildId, questions: [] });
		}
		return (cfg as any).autoStatus ?? { enabled: false };
	}

	private async saveCfg(guildId: string, autoStatus: AutoStatusConfig): Promise<void> {
		await PresentationConfig.findOneAndUpdate(
			{ guildId },
			{ $set: { autoStatus } },
			{ upsert: true, new: true, setDefaultsOnInsert: true },
		);
	}

	private staffRoleId(cfg: any): string | null {
		return cfg.staffRoleId ?? null;
	}

	private isAvailable(status: string | null | undefined): boolean {
		return status === 'online' || status === 'idle' || status === 'dnd';
	}

	/** Silent baseline at startup — never announce on (re)start. */
	async initialize(client: Client): Promise<void> {
		// Process all guilds that have autostatus enabled.
		const cfgs = await PresentationConfig.find({ 'autoStatus.enabled': true }).lean();
		for (const cfg of cfgs) {
			const guildId = (cfg as any).guildId;
			try {
				const guild = await client.guilds.fetch(guildId).catch(() => null);
				if (!guild) continue;
				await this.resync(guild, false);
				console.log('[Presentations] Auto open/close baseline set (silent)');
			} catch (error: any) {
				console.error('[Presentations] Autostatus init failed:', error?.message || error);
			}
		}
	}

	/** Rebuild the available set from current presences. */
	private async resync(guild: Guild, announce: boolean): Promise<void> {
		const cfg = await this.getCfg(guild.id);
		const roleId = this.staffRoleId(cfg);
		if (!roleId) return;
		const role = await guild.roles.fetch(roleId).catch(() => null);
		if (!role) return;
		await guild.members.fetch().catch(() => null);
		const set = new Set<string>();
		for (const [, member] of role.members) {
			if (member.user.bot) continue;
			if (this.isAvailable(member.presence?.status)) set.add(member.id);
		}
		this.available.set(guild.id, set);
		if (announce) await this.evaluate(guild);
		else this.lastAnnounced.set(guild.id, set.size > 0);
	}

	async handlePresenceUpdate(_old: Presence | null, cur: Presence): Promise<void> {
		const guild = cur.guild;
		if (!guild) return;
		const cfg = await this.getCfg(guild.id);
		if (!cfg.enabled) return;
		const roleId = this.staffRoleId(cfg);
		if (!roleId) return;

		let member: GuildMember | null = cur.member as GuildMember | null;
		if (!member && cur.userId) {
			member = await guild.members.fetch(cur.userId).catch(() => null);
		}
		if (!member || member.user.bot) return;
		if (!member.roles.cache.has(roleId)) return;

		let set = this.available.get(guild.id);
		if (!set) {
			set = new Set();
			this.available.set(guild.id, set);
		}
		if (this.isAvailable(cur.status)) set.add(member.id);
		else set.delete(member.id);

		await this.evaluate(guild);
	}

	private async evaluate(guild: Guild): Promise<void> {
		const cfg = await this.getCfg(guild.id);
		const open = (this.available.get(guild.id)?.size ?? 0) > 0;
		const last = this.lastAnnounced.get(guild.id);

		if (open) {
			const timer = this.closeTimers.get(guild.id);
			if (timer) {
				clearTimeout(timer);
				this.closeTimers.delete(guild.id);
			}
			if (last !== true) {
				this.lastAnnounced.set(guild.id, true);
				await this.announce(guild, true, cfg);
			}
			return;
		}

		if (last === false || this.closeTimers.has(guild.id)) return;
		const waitMs = Math.max(10, cfg.debounceSec ?? 120) * 1000;
		const timer = setTimeout(async () => {
			this.closeTimers.delete(guild.id);
			const stillEmpty = (this.available.get(guild.id)?.size ?? 0) === 0;
			if (!stillEmpty) return;
			this.lastAnnounced.set(guild.id, false);
			await this.announce(guild, false, cfg);
		}, waitMs);
		timer.unref?.();
		this.closeTimers.set(guild.id, timer);
	}

	private async announce(guild: Guild, open: boolean, cfg: AutoStatusConfig): Promise<void> {
		if (!cfg.announcementsChannelId) return;
		try {
			const channel = await guild.channels.fetch(cfg.announcementsChannelId).catch(() => null);
			if (!channel || !channel.isTextBased() || channel.isThread()) return;
			const count = this.available.get(guild.id)?.size ?? 0;

			const embed = open
				? new EmbedBuilder()
					.setColor(0x57F287)
					.setTitle('🟢 Presentations are OPEN')
					.setDescription(`Staff ${count === 1 ? 'is' : 'are'} online — staff applications are now being reviewed!\n\nSubmit yours with the application panel.`)
					.setFooter({ text: `Updated ${new Date().toLocaleString()} · ${count} staff available` })
				: new EmbedBuilder()
					.setColor(0xED4245)
					.setTitle('🔴 Presentations are CLOSED')
					.setDescription('No staff members are online right now.\n\nYou can still submit an application — it will be reviewed as soon as staff return!')
					.setFooter({ text: `Updated ${new Date().toLocaleString()}` });

			const payload = {
				embeds: [embed],
				content: open && cfg.pingRoleId ? `<@&${cfg.pingRoleId}>` : '',
				allowedMentions: { roles: cfg.pingRoleId ? [cfg.pingRoleId] : [] },
			};

			if (cfg.panelMessageId) {
				const existing = await (channel as any).messages.fetch(cfg.panelMessageId).catch(() => null);
				if (existing) {
					await existing.edit(payload);
					return;
				}
			}

			const sent = await (channel as any).send(payload);
			await this.saveCfg(guild.id, { ...cfg, panelMessageId: sent.id });
		} catch (error: any) {
			console.error('[Presentations] Autostatus announce failed:', error?.message || error);
		}
	}

	status(guildId: string): { open: boolean; available: number } | null {
		const set = this.available.get(guildId);
		if (!set) return null;
		return { open: set.size > 0, available: set.size };
	}
}

export const presentationAutoStatus = new PresentationAutoStatus();

export const presentationPresenceUpdate = {
	name: Events.PresenceUpdate as keyof import('discord.js').ClientEvents,
	execute: async (_client: any, _old: Presence | null, cur: Presence) => {
		try { await presentationAutoStatus.handlePresenceUpdate(_old, cur).catch(() => {}); } catch {}
	},
};
