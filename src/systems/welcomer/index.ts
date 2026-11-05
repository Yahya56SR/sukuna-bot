import type { GuildMember, Guild, TextChannel } from 'discord.js';
import { Events } from 'discord.js';
import { WelcomerConfig } from '../../db/models/WelcomerConfig.js';
import { EmbedBuilder } from 'discord.js';

export class WelcomerSystem {
	async getConfig(guildId: string) {
		let cfg = await WelcomerConfig.findOne({ guildId }).lean();
		if (!cfg) {
			cfg = await WelcomerConfig.create({ guildId });
		}
		return cfg;
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
		const guild = member.guild;
		const cfg = await this.getConfig(guild.id);
		if (!cfg.welcomeChannelId) return;

		const channel = guild.channels.cache.get(cfg.welcomeChannelId) as TextChannel | undefined;
		if (!channel) return;

		const memberCount = guild.memberCount;
		const content = this.renderMessage(cfg.welcomeMessage, member, guild, memberCount);

		const embed = new EmbedBuilder()
			.setColor(0x57F287)
			.setTitle('👋 Welcome!')
			.setDescription(`Welcome ${member}, we're glad to have you!`)
			.setThumbnail(member.displayAvatarURL())
			.setFooter({ text: `Member #${memberCount}` })
			.setTimestamp();

		await channel.send({ content: content || undefined, embeds: [embed] }).catch(() => {});
	}

	async sendGoodbye(member: GuildMember): Promise<void> {
		const guild = member.guild;
		const cfg = await this.getConfig(guild.id);
		if (!cfg.goodbyeChannelId) return;

		const channel = guild.channels.cache.get(cfg.goodbyeChannelId) as TextChannel | undefined;
		if (!channel) return;

		const memberCount = guild.memberCount;
		const content = this.renderMessage(cfg.goodbyeMessage, member, guild, memberCount);

		const embed = new EmbedBuilder()
			.setColor(0xED4245)
			.setTitle('👋 Goodbye!')
			.setDescription(`**${member.user.tag}** has left the server.`)
			.setThumbnail(member.displayAvatarURL())
			.setFooter({ text: `Member count: ${memberCount}` })
			.setTimestamp();

		await channel.send({ content: content || undefined, embeds: [embed] }).catch(() => {});
	}
}

export const welcomer = new WelcomerSystem();

export const welcomeMemberAdd = {
	name: Events.GuildMemberAdd as keyof import('discord.js').ClientEvents,
	execute: async (_client: any, member: any) => {
		if (member.user?.bot) return;
		await welcomer.sendWelcome(member).catch(() => {});
	},
};

export const welcomeMemberRemove = {
	name: Events.GuildMemberRemove as keyof import('discord.js').ClientEvents,
	execute: async (_client: any, member: any) => {
		if (member.user?.bot) return;
		await welcomer.sendGoodbye(member).catch(() => {});
	},
};
