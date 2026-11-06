import type { Guild, GuildMember, TextChannel } from 'discord.js';
import { Events, EmbedBuilder } from 'discord.js';
import { AttachmentBuilder } from 'discord.js';
import { WelcomerConfig } from '../../db/models/WelcomerConfig.js';
import EmbedBuilderUtil from '../../utils/shared-embeds.js';

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
		let row = await WelcomerConfig.findOne({ guildId }).lean();
		if (!row) {
			row = await WelcomerConfig.create({ guildId, welcomeImageEnabled: true, goodbyeImageEnabled: true });
		}
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
		await WelcomerConfig.findOneAndUpdate({ guildId }, { $set: data }, { upsert: true, new: true, setDefaultsOnInsert: true });
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

		const channel = guild.channels.cache.get(cfg.welcomeChannelId) as TextChannel;
		if (!channel) return;

		const memberCount = guild.memberCount;
		const content = this.renderMessage(cfg.welcomeMessage, member, guild, memberCount);

		const embed = EmbedBuilderUtil.welcome?.(member, guild, memberCount) ?? new EmbedBuilder()
			.setColor('#5865F2')
			.setTitle('Welcome!')
			.setDescription(`Welcome to ${guild.name}, ${member}!`)
			.setTimestamp();

		await channel.send({ content: content ?? undefined, embeds: [embed] });
	}

	async sendGoodbye(member: GuildMember): Promise<void> {
		const guild = member.guild as Guild;
		const cfg = await this.getConfig(guild.id);
		if (!cfg.goodbyeChannelId) return;

		const channel = guild.channels.cache.get(cfg.goodbyeChannelId) as TextChannel;
		if (!channel) return;

		const memberCount = guild.memberCount;
		const content = this.renderMessage(cfg.goodbyeMessage, member, guild, memberCount);

		const embed = EmbedBuilderUtil.goodbye?.(member, guild, memberCount) ?? new EmbedBuilder()
			.setColor('#ED4245')
			.setTitle('Goodbye')
			.setDescription(`${member.user.tag} left ${guild.name}.`)
			.setTimestamp();

		await channel.send({ content: content ?? undefined, embeds: [embed] });
	}
}

export const welcomer = new WelcomerSystem();

export const guildMemberAddWelcomer = {
	name: Events.GuildMemberAdd as keyof import('discord.js').ClientEvents,
	execute: async (_client: any, member: GuildMember) => {
		try { await welcomer.sendWelcome(member).catch(() => {}); } catch {}
	},
};

export const guildMemberRemoveWelcomer = {
	name: Events.GuildMemberRemove as keyof import('discord.js').ClientEvents,
	execute: async (_client: any, member: GuildMember) => {
		try { await welcomer.sendGoodbye(member).catch(() => {}); } catch {}
	},
};
