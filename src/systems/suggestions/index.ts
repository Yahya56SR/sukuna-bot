import type { ThreadChannel, User } from 'discord.js';
import { Events } from 'discord.js';
import {
	PermissionFlagsBits,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	EmbedBuilder,
	PartialGroupDMChannel,
} from 'discord.js';
import { Suggestion } from '../../db/models/Suggestion.js';
import EmbedBuilderUtil from '../../utils/shared-embeds.js';
import { clampInt, getTextChannel } from '../../core/safety.js';
import { Guild } from '../../db/models/Guild.js';

interface SuggestionConfig {
	forumChannelId?: string;
	staffChannelId?: string;
	reactionThreshold: number;
	approvedTagId?: string;
	deniedTagId?: string;
	notedTagId?: string;
	staffRoleId?: string;
}

export class SuggestionSystem {
	async getConfig(guildId: string): Promise<SuggestionConfig> {
		// Stored on the guild row under `sukuna.suggestions` so the forum
		// system is actually configurable instead of permanently dead.
		// Atomic upsert keeps first-use race-free.
		const row = await Guild.findOneAndUpdate(
			{ guildId },
			{ $setOnInsert: { guildId } },
			{ upsert: true, new: true, setDefaultsOnInsert: true },
		).lean();
		const stored = (row as any)?.sukuna?.suggestions ?? {};
		return {
			forumChannelId: typeof stored.forumChannelId === 'string' && /^\d{5,25}$/.test(stored.forumChannelId) ? stored.forumChannelId : undefined,
			staffChannelId: typeof stored.staffChannelId === 'string' && /^\d{5,25}$/.test(stored.staffChannelId) ? stored.staffChannelId : undefined,
			reactionThreshold: clampInt(stored.reactionThreshold, 5, 1, 1000),
			approvedTagId: typeof stored.approvedTagId === 'string' && /^\d{5,25}$/.test(stored.approvedTagId) ? stored.approvedTagId : undefined,
			deniedTagId: typeof stored.deniedTagId === 'string' && /^\d{5,25}$/.test(stored.deniedTagId) ? stored.deniedTagId : undefined,
			notedTagId: typeof stored.notedTagId === 'string' && /^\d{5,25}$/.test(stored.notedTagId) ? stored.notedTagId : undefined,
			staffRoleId: typeof stored.staffRoleId === 'string' && /^\d{5,25}$/.test(stored.staffRoleId) ? stored.staffRoleId : undefined,
		};
	}

	async setConfig(guildId: string, data: Partial<SuggestionConfig>): Promise<void> {
		if (!/^\d{5,25}$/.test(guildId)) throw new Error('Invalid guild id');
		const allowed = new Set(['forumChannelId', 'staffChannelId', 'approvedTagId', 'deniedTagId', 'notedTagId', 'staffRoleId', 'reactionThreshold']);
		const patch: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(data ?? {})) {
			if (!allowed.has(key)) throw new Error(`Unknown setting: ${key}`);
			if (key === 'reactionThreshold') patch[key] = clampInt(value, 5, 1, 1000);
			else if (value === null || value === undefined) patch[key] = null;
			else if (/^\d{5,25}$/.test(String(value))) patch[key] = String(value);
			else throw new Error(`Invalid ${key}`);
		}
		if (Object.keys(patch).length === 0) throw new Error('No settings supplied');
		await Guild.findOneAndUpdate(
			{ guildId },
			{ $set: { 'sukuna.suggestions': patch } },
			{ upsert: true, new: true, setDefaultsOnInsert: true },
		);
	}

	async handleThreadCreate(thread: ThreadChannel): Promise<void> {
		const cfg = await this.getConfig(thread.guild.id);
		if (!cfg.forumChannelId || thread.parentId !== cfg.forumChannelId) return;

		const existing = await Suggestion.findOne({ threadId: thread.id });
		if (existing) return;

		await new Promise((r) => setTimeout(r, 1000));

		try {
			const messages = await thread.messages.fetch({ limit: 1 });
			const firstMessage = messages.first();
			if (!firstMessage || firstMessage.author.bot) return;

			await Suggestion.create({
				guildId: thread.guild.id,
				channelId: thread.id,
				messageId: firstMessage.id,
				authorId: firstMessage.author.id,
				title: thread.name,
				description: firstMessage.content,
				status: 'pending',
				upvotes: [],
				downvotes: [],
			});

			await firstMessage.react('👍');
			await firstMessage.react('👎');

			await firstMessage.reply({
				content: `✅ Your suggestion has been submitted! Get ${cfg.reactionThreshold} 👍 reactions to have it reviewed by staff.`,
			});
		}
		catch (error) {
			console.error('[Suggestion] Error handling thread create:', error);
		}
	}

	async handleReactionAdd(reaction: any, user: User): Promise<void> {
		if (user.bot) return;
		if (reaction.partial) await reaction.fetch().catch(() => {});

		const message = reaction.message;
		const thread = message.channel as ThreadChannel;

		const cfg = await this.getConfig(thread.guild.id);
		if (!cfg.forumChannelId || thread.parentId !== cfg.forumChannelId) return;

		if (message.id !== thread.id) return;
		if (reaction.emoji.name !== '👍') return;

		const suggestion = await Suggestion.findOne({ channelId: thread.id });
		if (!suggestion) return;

		if (suggestion.status !== 'pending') return;

		// Atomic add-to-set: concurrent reactions cannot lose each other, and
		// the bot's own seeded 👍 is not counted as a vote.
		const updated = await Suggestion.findOneAndUpdate(
			{ _id: suggestion._id, status: 'pending' },
			{ $addToSet: { upvotes: user.id } },
			{ new: true },
		);
		if (!updated) return;
		// Note: never trust `reaction.count` (bot seed + removes race it).
		const upvotes = updated.upvotes?.length ?? 0;

		if (upvotes >= cfg.reactionThreshold) {
			await this.markAsNoted(thread, updated, cfg);
		}
	}

	async markAsNoted(thread: ThreadChannel, suggestion: any, cfg: SuggestionConfig): Promise<void> {
		// 'noted' is not a valid status in sukuna's schema; keep as pending
		// but notify staff that the threshold was reached.
		await suggestion.save();

		if (cfg.notedTagId) {
			try { await thread.setAppliedTags([cfg.notedTagId]); } catch (e) { console.error('[Suggestion] Error adding NOTED tag:', e); }
		}

		if (cfg.staffChannelId) {
			const staffChannel = thread.client.channels.cache.get(cfg.staffChannelId);
			if (staffChannel?.isTextBased() && !(staffChannel instanceof PartialGroupDMChannel)) {
				const embed = EmbedBuilderUtil.suggestionReview?.(suggestion) ?? new EmbedBuilder()
					.setColor('#FEE75C')
					.setTitle('Suggestion Under Review')
					.setDescription(suggestion.description)
					.setFooter({ text: `Suggestion ID: ${suggestion._id}` })
					.setTimestamp();

				const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
					new ButtonBuilder().setCustomId('suggestion_approve').setLabel('✅ APPROVED').setStyle(ButtonStyle.Success),
					new ButtonBuilder().setCustomId('suggestion_deny').setLabel('❌ DENIED').setStyle(ButtonStyle.Danger),
					new ButtonBuilder().setCustomId('suggestion_under_review').setLabel('⏸️ UNDER REVIEW').setStyle(ButtonStyle.Secondary),
				);

				await staffChannel.send({
					content: `📋 **Suggestion reached ${cfg.reactionThreshold} upvotes!**`,
					embeds: [embed],
					components: [row],
				});
			}
		}

		try {
			const user = await thread.client.users.fetch(suggestion.authorId);
			await user.send({ content: `🎉 Your suggestion "**${suggestion.title}**" reached ${cfg.reactionThreshold} upvotes and has been sent to staff for review!` }).catch(() => {});
		} catch (e) {}
	}

	async handleReview(interaction: any, action: string): Promise<void> {
		const cfg = await this.getConfig(interaction.guild.id);
		const staffRoleId = cfg.staffRoleId;
		const isStaff = staffRoleId && interaction.member.roles.cache.has(staffRoleId);
		if (!isStaff && !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
			return interaction.reply({ content: '❌ Only staff can review suggestions.', flags: 64 });
		}

		const message = interaction.message;
		const embed = message.embeds[0];
		if (!embed) return interaction.reply({ content: '❌ Invalid suggestion embed.', flags: 64 });

		const footerText = embed.footer?.text || '';
		const idMatch = footerText.match(/Suggestion ID: ([a-zA-Z0-9]+)/);
		if (!idMatch) return interaction.reply({ content: '❌ Could not find suggestion ID.', flags: 64 });

		const suggestionId = idMatch[1];
		// Validate ObjectId before the cast — findById(invalid) throws CastError.
		if (!/^[a-f\d]{24}$/i.test(suggestionId)) return interaction.reply({ content: '❌ Invalid suggestion ID.', flags: 64 });
		const suggestion = await Suggestion.findById(suggestionId);
		if (!suggestion) return interaction.reply({ content: '❌ Suggestion not found.', flags: 64 });

		const thread = interaction.client.channels.cache.get(suggestion.channelId) as ThreadChannel;

		let newStatus: string, tagId: string | null, notifyText: string;
		switch (action) {
		case 'approve':
			newStatus = 'approved';
			tagId = cfg.approvedTagId ?? null;
			notifyText = '🎉 Your suggestion has been **APPROVED**!';
			break;
		case 'deny':
			newStatus = 'denied';
			tagId = cfg.deniedTagId ?? null;
			notifyText = '❌ Your suggestion has been **DENIED**.';
			break;
		case 'under_review':
			newStatus = 'pending';
			tagId = null;
			notifyText = '⏸️ Your suggestion is **UNDER REVIEW** by staff.';
			break;
		default:
			return;
		}

		suggestion.status = newStatus as any;
		suggestion.reviewedBy = interaction.user.id;
		suggestion.reviewedAt = new Date();
		await suggestion.save();

		if (tagId && thread) {
			try { await thread.setAppliedTags([tagId]); } catch (e) { console.error('[Suggestion] Error updating tag:', e); }
		}

		if (thread) {
			try {
				const prefix = newStatus === 'approved' ? '✅ ' : newStatus === 'denied' ? '❌ ' : '⏸️ ';
				const cleanName = thread.name.replace(/^[✅❌⏸️] /, '');
				await thread.setName(`${prefix}${cleanName}`);
			} catch (e) {}
		}

		try {
			const user = await interaction.client.users.fetch(suggestion.authorId);
			await user.send({ content: `${notifyText}\n**Suggestion:** ${suggestion.title}` }).catch(() => {});
		} catch (e) {}

		const statusColors: Record<string, string> = { approved: '#57F287', denied: '#ED4245', pending: '#FEE75C' };
		await message.edit({
			embeds: [
				new EmbedBuilder()
					.setColor(statusColors[newStatus] as `#${string}`)
					.setTitle(`${action === 'approve' ? '✅' : action === 'deny' ? '❌' : '⏸️'} ${embed.title}`)
					.setDescription(embed.description)
					.addFields(
						{ name: 'Status', value: newStatus.toUpperCase(), inline: true },
						{ name: 'Reviewed by', value: `<@${interaction.user.id}>`, inline: true },
					)
					.setFooter({ text: embed.footer?.text })
					.setTimestamp(),
			],
			components: [],
		});

		await interaction.reply({ content: `✅ Suggestion ${action.toUpperCase()}!`, flags: 64 });
	}
}

export const suggestions = new SuggestionSystem();

export const threadCreateSuggestions = {
	name: Events.ThreadCreate as keyof import('discord.js').ClientEvents,
	execute: async (_client: any, thread: ThreadChannel) => {
		try { await suggestions.handleThreadCreate(thread).catch(() => {}); } catch {}
	},
};

export const messageReactionAddSuggestions = {
	name: Events.MessageReactionAdd as keyof import('discord.js').ClientEvents,
	execute: async (_client: any, reaction: any, user: User) => {
		try { await suggestions.handleReactionAdd(reaction, user).catch(() => {}); } catch {}
	},
};

export const interactionCreateSuggestions = {
	name: 'interactionCreate' as const,
	execute: async (_client: any, interaction: any) => {
		if (!interaction.isButton()) return;
		if (interaction.customId === 'suggestion_approve' || interaction.customId === 'suggestion_deny' || interaction.customId === 'suggestion_under_review') {
			const action = interaction.customId === 'suggestion_approve' ? 'approve' : interaction.customId === 'suggestion_deny' ? 'deny' : 'under_review';
			try { await suggestions.handleReview(interaction, action).catch(() => {}); } catch {}
		}
	},
};
