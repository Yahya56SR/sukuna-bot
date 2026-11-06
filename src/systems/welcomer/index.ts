import type { Guild, GuildMember, TextChannel } from 'discord.js';
import { Events, EmbedBuilder } from 'discord.js';
import { AttachmentBuilder } from 'discord.js';
import { WelcomerConfig } from '../../db/models/WelcomerConfig.js';
import EmbedBuilderUtil from '../../utils/shared-embeds.js';
import { getTextChannel } from '../../core/safety.js';
import { recordActivity } from '../../core/metrics.js';

/**
 * Welcomer system (ported from astralcraft).
 * Uses Mongoose (WelcomerConfig). Canvas-based welcome images fall back to
 * plain embeds when the canvas addon is unavailable.
 */

export interface WelcomerConfigI {
	welcomeChannelId: string | null;
	goodbyeChannelId: string | null;
	welcomeMessage: string | null;
	goodbyeMessage: string | null;
	welcomeImageEnabled: boolean;
	goodbyeImageEnabled: boolean;
	backgroundImagePath: string | null;
	goodbyeBackgroundImagePath: string | null;
}

export class WelcomerSystem {
	async getConfig(guildId: string): Promise<WelcomerConfigI> {
		const row = await WelcomerConfig.findOneAndUpdate(
			{ guildId },
			{ $setOnInsert: { guildId, welcomeImageEnabled: true, goodbyeImageEnabled: true } },
			{ upsert: true, new: true, setDefaultsOnInsert: true },
		).lean();
		const r = row as any;
		return {
			welcomeChannelId: r.welcomeChannelId ?? null,
			goodbyeChannelId: r.goodbyeChannelId ?? null,
			welcomeMessage: r.welcomeMessage ?? null,
			goodbyeMessage: r.goodbyeMessage ?? null,
			welcomeImageEnabled: r.welcomeImageEnabled !== undefined ? r.welcomeImageEnabled : true,
			goodbyeImageEnabled: r.goodbyeImageEnabled !== undefined ? r.goodbyeImageEnabled : true,
			backgroundImagePath: r.backgroundImagePath ?? null,
			goodbyeBackgroundImagePath: r.goodbyeBackgroundImagePath ?? null,
		};
	}

	async setConfig(guildId: string, data: Partial<WelcomerConfigI>): Promise<void> {
		if (!/^\d{5,25}$/.test(guildId)) throw new Error('Invalid guild id');
		// Explicit allowlist — `$set: data` previously let callers overwrite `guildId`.
		const allowed = new Set(['welcomeChannelId', 'goodbyeChannelId', 'welcomeMessage', 'goodbyeMessage', 'welcomeImageEnabled', 'goodbyeImageEnabled', 'backgroundImagePath', 'goodbyeBackgroundImagePath']);
		const updates: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(data ?? {})) {
			if (!allowed.has(key)) throw new Error(`Unknown setting: ${key}`);
			if (key.endsWith('ChannelId') && value !== null && value !== undefined && !/^\d{5,25}$/.test(String(value))) throw new Error(`Invalid ${key}`);
			if ((key === 'welcomeMessage' || key === 'goodbyeMessage') && typeof value === 'string' && value.length > 2000) throw new Error(`${key} too long`);
			updates[key] = value;
		}
		if (Object.keys(updates).length === 0) throw new Error('No settings supplied');
		await WelcomerConfig.findOneAndUpdate({ guildId }, { $set: updates }, { upsert: true, new: true, setDefaultsOnInsert: true });
	}

	renderMessage(template: string | null | undefined, member: GuildMember, guild: Guild, memberCount: number): string {
		const raw = template?.trim();
		if (!raw) return '';
		return raw
			.replace(/\{user\}/g, `<@${member.id}>`)
			.replace(/\{username\}/g, member.user.username)
			.replace(/\{displayname\}/g, member.displayName)
			.replace(/\{server\}/g, guild.name)
			.replace(/\{count\}/g, String(memberCount));
	}

	async sendWelcome(member: GuildMember): Promise<void> {
		const guild = member.guild as Guild;
		const cfg = await this.getConfig(guild.id);
		if (!cfg.welcomeChannelId) return;

		// Cache-then-fetch: `channels.cache` alone silently dropped welcomes on
		// a cold cache.
		const channel = await getTextChannel(guild, cfg.welcomeChannelId);
		if (!channel) return;

		const memberCount = guild.memberCount;
		const content = this.renderMessage(cfg.welcomeMessage, member, guild, memberCount);

		const embed = EmbedBuilderUtil.welcome?.(member, guild, memberCount) ?? new EmbedBuilder()
			.setColor('#5865F2')
			.setTitle('Welcome!')
			.setDescription(`Welcome to ${guild.name}, ${member}!`)
			.setTimestamp();

		await channel.send({ content: content ? content.slice(0, 1900) : undefined, embeds: [embed], allowedMentions: { parse: [] } }).catch(() => {});
		recordActivity('system', 'Welcome sent', { level: 'info', meta: { guildId: guild.id, userId: member.id } });
	}

	async sendGoodbye(member: GuildMember): Promise<void> {
		const guild = member.guild as Guild;
		const cfg = await this.getConfig(guild.id);
		if (!cfg.goodbyeChannelId) return;

		const channel = await getTextChannel(guild, cfg.goodbyeChannelId);
		if (!channel) return;

		const memberCount = guild.memberCount;
		const content = this.renderMessage(cfg.goodbyeMessage, member, guild, memberCount);

		const embed = EmbedBuilderUtil.goodbye?.(member, guild, memberCount) ?? new EmbedBuilder()
			.setColor('#ED4245')
			.setTitle('Goodbye')
			.setDescription(`${member.user.tag} left ${guild.name}.`)
			.setTimestamp();

		await channel.send({ content: content ? content.slice(0, 1900) : undefined, embeds: [embed], allowedMentions: { parse: [] } }).catch(() => {});
	}
}

export const welcomer = new WelcomerSystem();

export const guildMemberAddWelcomer = {
	name: Events.GuildMemberAdd as keyof import('discord.js').ClientEvents,
	execute: async (client: any, member: GuildMember) => {
		await welcomer.sendWelcome(member).catch((err) => client.logger?.warn({ err, userId: member.id }, 'welcomer welcome failed'));
	},
};

export const guildMemberRemoveWelcomer = {
	name: Events.GuildMemberRemove as keyof import('discord.js').ClientEvents,
	execute: async (client: any, member: GuildMember) => {
		await welcomer.sendGoodbye(member).catch((err) => client.logger?.warn({ err, userId: member.id }, 'welcomer goodbye failed'));
	},
};
