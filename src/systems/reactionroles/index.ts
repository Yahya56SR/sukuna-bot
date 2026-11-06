import type { Guild, GuildMember, Message, MessageReaction, TextChannel, User } from 'discord.js';
import { Events } from 'discord.js';
import { Colors, EmbedBuilder } from 'discord.js';
import { ReactionRolePanel } from '../../db/models/ReactionRolePanel.js';
import { VerificationConfig } from '../../db/models/Verification.js';

/**
 * Reaction Roles system (ported from astralcraft).
 * Uses Mongoose (ReactionRolePanel). Options are embedded in the panel doc.
 */
export interface ReactionRoleOption {
	roleId: string;
	emoji: string;
	displayEmoji?: string;
	label?: string;
}

export interface ReactionRolePanelDoc {
	id: string;
	guildId: string;
	channelId: string;
	messageId?: string;
	title?: string | null;
	description?: string | null;
	enabled: boolean;
	requireVerified: boolean;
	options: ReactionRoleOption[];
}

function normalizeEmoji(input: string): string {
	const raw = input.trim();
	const custom = raw.match(/^<?(?:a)?:?(\w{2,32}):(\d{17,20})>?$/);
	if (custom) return `${custom[1]}:${custom[2]}`;
	return raw.replace(/\uFE0F/g, '');
}

export class ReactionRolesSystem {
	normalizeEmoji(input: string): string {
		return normalizeEmoji(input);
	}

	private resolveOption(panel: ReactionRolePanelDoc, emoji: string): ReactionRoleOption | undefined {
		const wanted = normalizeEmoji(emoji);
		return panel.options.find((option) => normalizeEmoji(option.emoji) === wanted);
	}

	async findPanelByMessage(messageId: string): Promise<ReactionRolePanelDoc | null> {
		const panel = await ReactionRolePanel.findOne({ messageId }).lean();
		if (!panel) return null;
		return this.toDoc(panel);
	}

	async findPanelByChannel(guildId: string, channelId: string): Promise<ReactionRolePanelDoc | null> {
		const panel = await ReactionRolePanel.findOne({ guildId, channelId }).sort({ createdAt: -1 }).lean();
		if (!panel) return null;
		return this.toDoc(panel);
	}

	private toDoc(panel: any): ReactionRolePanelDoc {
		return {
			id: panel._id.toString(),
			guildId: panel.guildId,
			channelId: panel.channelId,
			messageId: panel.messageId ?? undefined,
			title: panel.title ?? null,
			description: panel.description ?? null,
			enabled: panel.active ?? true,
			requireVerified: false,
			options: (panel.options ?? []).map((o: any) => ({
				roleId: o.roleId,
				emoji: o.emoji,
				displayEmoji: o.emoji,
				label: o.label ?? null,
			})),
		};
	}

	async createPanel(data: {
		guildId: string;
		channelId: string;
		title?: string | null;
		description?: string | null;
		createdBy: string;
		requireVerified?: boolean;
	}): Promise<ReactionRolePanelDoc> {
		const panel = await ReactionRolePanel.create({
			guildId: data.guildId,
			channelId: data.channelId,
			title: data.title ?? '🎭 Pick your roles',
			description: data.description ?? undefined,
			options: [],
			useButtons: false,
			active: true,
			dmUser: true,
		});
		return this.toDoc(panel);
	}

	async addOption(panelId: string, emoji: string, roleId: string, label: string | null): Promise<ReactionRoleOption> {
		const normalized = normalizeEmoji(emoji);
		if (!normalized) throw new Error('The emoji could not be read. Copy it from Discord and try again.');

		const panel = await ReactionRolePanel.findById(panelId);
		if (!panel) throw new Error('Panel not found');

		const existing = panel.options.find((o: any) => normalizeEmoji(o.emoji) === normalized);
		if (existing) {
			existing.roleId = roleId;
			existing.label = label ?? undefined;
			existing.emoji = normalized;
		} else {
			panel.options.push({ roleId, emoji: normalized, label: label ?? undefined });
		}
		await panel.save();

		const added = panel.options.find((o: any) => normalizeEmoji(o.emoji) === normalized)!;
		return { roleId: added.roleId, emoji: added.emoji, displayEmoji: added.emoji, label: added.label };
	}

	async removeOption(panelId: string, emoji: string): Promise<number> {
		const normalized = normalizeEmoji(emoji);
		const panel = await ReactionRolePanel.findById(panelId);
		if (!panel) return 0;
		const before = panel.options.length;
		panel.options = panel.options.filter((o: any) => normalizeEmoji(o.emoji) !== normalized);
		await panel.save();
		return before - panel.options.length;
	}

	async clearOptions(panelId: string): Promise<number> {
		const panel = await ReactionRolePanel.findById(panelId);
		if (!panel) return 0;
		const before = panel.options.length;
		panel.options = [];
		await panel.save();
		return before;
	}

	private displayEmoji(guild: Guild | undefined, option: ReactionRoleOption): string {
		if (option.displayEmoji) return option.displayEmoji;
		const custom = option.emoji.match(/^(\w{2,32}):(\d{17,20})$/);
		if (!custom) return option.emoji;
		const animated = guild?.emojis.cache.get(custom[2])?.animated ?? false;
		return `<${animated ? 'a' : ''}:${custom[1]}:${custom[2]}>`;
	}

	buildEmbed(panel: ReactionRolePanelDoc, guild?: Guild): EmbedBuilder {
		const intro = panel.description?.trim()
			|| 'React with an emoji below to get a role, and remove your reaction to give it back.';

		const lines = panel.options.length
			? panel.options.map((option) => {
				const role = guild?.roles.cache.get(option.roleId);
				const label = role ? `<@&${role.id}>` : '⚠️ missing role';
				return `## ${this.displayEmoji(guild, option)} ${label}${option.label ? ` — ${option.label}` : ''}`;
			})
			: ['*No roles configured yet — an admin needs to add some.*'];

		const embed = new EmbedBuilder()
			.setColor(Colors.Purple)
			.setTitle(panel.title || '🎭 Pick your roles');

		const asDescription = `${intro}\n\n${lines.join('\n')}`;
		if (asDescription.length <= 4000) {
			embed.setDescription(asDescription);
		}
		else {
			embed.setDescription(intro);
			let current = '';
			for (const line of lines) {
				const plain = line.replace(/^## /, '');
				if (current && current.length + plain.length + 1 > 1000) {
					embed.addFields({ name: 'Roles', value: current, inline: false });
					current = '';
				}
				current += current ? `\n${plain}` : plain;
			}
			if (current) embed.addFields({ name: 'Roles', value: current, inline: false });
		}

		return embed
			.setFooter({ text: `Panel #${panel.id} • ${panel.enabled ? 'Active' : 'Disabled'}` })
			.setTimestamp();
	}

	async postPanel(panel: ReactionRolePanelDoc, channel: TextChannel): Promise<string> {
		const message = await channel.send({
			embeds: [this.buildEmbed(panel, channel.guild as Guild)],
		});

		await ReactionRolePanel.findByIdAndUpdate(panel.id, { messageId: message.id });
		panel.messageId = message.id;

		for (const option of panel.options) {
			await message.react(this.displayEmoji(channel.guild as Guild, option)).catch(() => {});
		}

		return message.id;
	}

	async refreshPanel(panel: ReactionRolePanelDoc, channel: TextChannel): Promise<void> {
		const embed = this.buildEmbed(panel, channel.guild as Guild);

		if (!panel.messageId) {
			await this.postPanel(panel, channel);
			return;
		}

		const existing = await channel.messages.fetch(panel.messageId).catch(() => null);
		if (!existing) {
			await this.postPanel(panel, channel);
			return;
		}

		await existing.edit({ embeds: [embed] });
		for (const option of panel.options) {
			await existing.react(this.displayEmoji(channel.guild as Guild, option)).catch(() => {});
		}
	}

	async handleReactionAdd(reaction: MessageReaction, user: User): Promise<void> {
		await this.processReaction(reaction, user, true);
	}

	async handleReactionRemove(reaction: MessageReaction, user: User): Promise<void> {
		await this.processReaction(reaction, user, false);
	}

	private async processReaction(reaction: MessageReaction, user: User, add: boolean): Promise<void> {
		try {
			if (reaction.partial) await reaction.fetch();
			if (user.bot) return;

			const message = reaction.message as Message;
			if (!message?.guild) return;

			const panel = await this.findPanelByMessage(message.id);
			if (!panel || !panel.enabled) return;

			const option = this.resolveOption(panel, reaction.emoji.identifier || reaction.emoji.name || '');
			if (!option) return;

			const guild = message.guild as Guild;
			const member = await guild.members.fetch(user.id).catch(() => null as GuildMember | null);
			if (!member) return;

			const role = guild.roles.cache.get(option.roleId);
			if (!role) {
				if (add) {
					await user.send('⚠️ One of the roles on that panel no longer exists. Please tell an admin.').catch(() => {});
				}
				return;
			}

			if (panel.requireVerified) {
				const verificationCfg = await VerificationConfig.findOne({ guildId: guild.id }).lean();
				const unverifiedRoleId = (verificationCfg as any)?.unverifiedRoleId ?? null;
				const verifiedRoleId = (verificationCfg as any)?.verifiedRoleId ?? null;
				const isVerified = (verifiedRoleId && member.roles.cache.has(verifiedRoleId)) || (!unverifiedRoleId) || !member.roles.cache.has(unverifiedRoleId);
				if (!isVerified) {
					if (add) {
						await user.send('🔒 You need to verify your account before you can pick roles. Use the verification panel in the rules channel.').catch(() => {});
					}
					return;
				}
			}

			if (!role.editable) {
				if (add) {
					await user.send(`⚠️ I can't assign the **${role.name}** role myself — please contact an admin.`).catch(() => {});
				}
				return;
			}

			if (add) {
				if (member.roles.cache.has(role.id)) return;
				await member.roles.add(role, 'Reaction role');
				await user.send(`✅ You now have the **${role.name}** role.`).catch(() => {});
			}
			else {
				if (!member.roles.cache.has(role.id)) return;
				await member.roles.remove(role, 'Reaction role removed');
				await user.send(`🗑️ Removed the **${role.name}** role.`).catch(() => {});
			}
		}
		catch (error) {
			console.error('[ReactionRoles] Failed to process reaction:', error);
		}
	}

	async staleRoles(panel: ReactionRolePanelDoc, guild: Guild): Promise<string[]> {
		return panel.options.filter((option) => !guild.roles.cache.has(option.roleId)).map((option) => option.roleId);
	}

	async editPanel(panelId: string, channel: TextChannel, data: { title?: string | null; description?: string | null }): Promise<void> {
		const panel = await ReactionRolePanel.findById(panelId);
		if (!panel) return;
		if (data.title !== undefined) panel.title = data.title ?? panel.title;
		if (data.description !== undefined) panel.description = data.description ?? panel.description;
		await panel.save();
		const updated = this.toDoc(panel);
		await this.refreshPanel(updated, channel);
	}
}

export const reactionRoles = new ReactionRolesSystem();

export const reactionAdd = {
	name: Events.MessageReactionAdd as keyof import('discord.js').ClientEvents,
	execute: async (_client: any, reaction: MessageReaction, user: User) => {
		try { await reactionRoles.handleReactionAdd(reaction, user).catch(() => {}); } catch {}
	},
};

export const reactionRemove = {
	name: Events.MessageReactionRemove as keyof import('discord.js').ClientEvents,
	execute: async (_client: any, reaction: MessageReaction, user: User) => {
		try { await reactionRoles.handleReactionRemove(reaction, user).catch(() => {}); } catch {}
	},
};
