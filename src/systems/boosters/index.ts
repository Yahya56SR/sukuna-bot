import type { GuildMember, Guild } from 'discord.js';
import { Events } from 'discord.js';
import { EmbedBuilder } from 'discord.js';
import { BoosterConfig } from '../../db/models/BoosterConfig.js';

/**
 * Boosters system (ported from astralcraft).
 * Uses Mongoose (BoosterConfig).
 */
export class BoosterSystem {
	async getConfig(guildId: string) {
		return BoosterConfig.findOneAndUpdate(
			{ guildId },
			{ $setOnInsert: { guildId, enabled: false } },
			{ upsert: true, new: true, setDefaultsOnInsert: true },
		).lean();
	}

	async handleMemberUpdate(oldMember: GuildMember, newMember: GuildMember): Promise<void> {
		const cfg = await this.getConfig(newMember.guild.id);
		if (!cfg.enabled) return;
		if (!newMember.guild) return;
		if (oldMember.partial) return;

		const wasBoosting = oldMember.premiumSinceTimestamp !== null;
		const isBoosting = newMember.premiumSinceTimestamp !== null;
		try {
			if (!wasBoosting && isBoosting) await this.onBoostStart(newMember, cfg);
			else if (wasBoosting && !isBoosting) await this.onBoostEnd(newMember, cfg);
		} catch (error: any) {
			console.error('[Boosters] Error handling boost update:', error?.message || error);
		}
	}

	private async onBoostStart(member: GuildMember, cfg: any): Promise<void> {
		const guild = member.guild;
		if (cfg.roleId) {
			const role = await guild.roles.fetch(cfg.roleId).catch(() => null);
			if (!role) {
				console.warn(`[Boosters] Reward role ${cfg.roleId} not found — skipping role grant.`);
			}
			else if (role.managed) {
				console.warn(`[Boosters] Reward role ${role.name} is managed by an integration.`);
			}
			else if (role.position >= guild.members.me!.roles.highest.position) {
				console.warn(`[Boosters] Reward role ${role.name} sits above my highest role — cannot grant it.`);
			}
			else if (!member.roles.cache.has(role.id)) {
				await member.roles.add(role, 'Server boost reward').catch((e: any) => {
					console.error('[Boosters] Failed to grant reward role:', e?.message || e);
				});
			}
		}
		if (cfg.channelId) {
			const channel = await guild.channels.fetch(cfg.channelId).catch(() => null);
			if (!channel || !channel.isTextBased() || channel.isThread()) {
				console.warn(`[Boosters] Announcement channel ${cfg.channelId} not found or not a text channel.`);
				return;
			}
			const boosts = guild.premiumSubscriptionCount ?? 0;
			const embed = new EmbedBuilder()
				.setColor(0xF47FFF)
				.setTitle('💎 New Server Boost!')
				.setDescription(`Huge thanks to ${member} for boosting **${guild.name}**!${cfg.roleId ? `\nThey've received the <@&${cfg.roleId}> role as a reward.` : ''}`)
				.setThumbnail(member.user.displayAvatarURL({ size: 256 }))
				.addFields(
					{ name: 'Booster', value: `${member.user.tag}`, inline: true },
					{ name: 'Total boosts', value: `${boosts}`, inline: true },
					{ name: 'Server level', value: `Level ${guild.premiumTier}`, inline: true },
				)
				.setTimestamp();
			await (channel as any).send({
				...(cfg.pingRoleId ? { content: `<@&${cfg.pingRoleId}>`, allowedMentions: { roles: [cfg.pingRoleId] } } : {}),
				embeds: [embed],
			}).catch((e: any) => console.error('[Boosters] Failed to send announcement:', e?.message || e));
		}
	}

	private async onBoostEnd(member: GuildMember, cfg: any): Promise<void> {
		if (!cfg.roleId || !member.roles.cache.has(cfg.roleId)) return;
		await member.roles.remove(cfg.roleId, 'Server boost ended').catch((e: any) =>
			console.error('[Boosters] Failed to remove reward role:', e?.message || e));
	}
}

export const boosters = new BoosterSystem();

export const guildMemberUpdateBoosters = {
	name: Events.GuildMemberUpdate as keyof import('discord.js').ClientEvents,
	execute: async (_client: any, oldMember: GuildMember, newMember: GuildMember) => {
		try { await boosters.handleMemberUpdate(oldMember, newMember).catch(() => {}); } catch {}
	},
};
