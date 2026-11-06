import type { TextChannel, Guild, User, GuildMember, ButtonInteraction, ModalSubmitInteraction } from 'discord.js';
import {
	ChannelType,
	PermissionFlagsBits,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	EmbedBuilder,
	ModalBuilder,
	TextInputBuilder,
	TextInputStyle,
} from 'discord.js';
import { PresentationConfig, PresentationApplication } from '../../db/models/Presentation.js';
import EmbedBuilderUtil from '../../utils/shared-embeds.js';
import { getTextChannel, isDuplicateKeyError, safeDm, withMutex } from '../../core/safety.js';
import { recordActivity } from '../../core/metrics.js';

interface PresentationConfigI {
	categoryId?: string;
	staffChannelId?: string;
	staffRoleId?: string;
	questions?: string[];
}

export class PresentationSystem {
	getQuestions(): string[] {
		return [
			'What is your name?',
			'How old are you?',
			'Why do you want to be staff?',
			'Do you have previous moderation experience?',
			'What timezone are you in?',
			'How many hours can you dedicate per week?',
		];
	}

	async getConfig(guildId: string): Promise<PresentationConfigI> {
		const cfg = await PresentationConfig.findOneAndUpdate(
			{ guildId },
			{ $setOnInsert: { guildId, questions: [] } },
			{ upsert: true, new: true, setDefaultsOnInsert: true },
		).lean();
		return {
			categoryId: cfg.categoryId ?? undefined,
			staffChannelId: cfg.staffChannelId ?? undefined,
			staffRoleId: cfg.staffRoleId ?? undefined,
			questions: Array.isArray(cfg.questions) && cfg.questions.length ? cfg.questions : this.getQuestions(),
		};
	}

	async createPresentationPanel(channel: TextChannel): Promise<void> {
		const embed = new EmbedBuilder()
			.setColor('#5865F2')
			.setTitle('👮 Staff Applications')
			.setDescription(
				'We\'re looking for dedicated members to join our staff team!\n\n' +
				'**Requirements:**\n' +
				'• Be active in the community\n' +
				'• Know our rules and guidelines\n' +
				'• Have a mature and professional attitude\n' +
				'• Be able to dedicate time weekly\n\n' +
				'Click the button below to submit your application.',
			)
			.setFooter({ text: 'Staff Team' })
			.setTimestamp();

		const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder()
				.setCustomId('presentation_apply_button')
				.setLabel('Apply for Staff')
				.setEmoji('📝')
				.setStyle(ButtonStyle.Primary),
		);

		await channel.send({ embeds: [embed], components: [row] });
	}

	async createApplicationModal(): Promise<ModalBuilder> {
		const questions = this.getQuestions();

		const modal = new ModalBuilder()
			.setCustomId('presentation_apply')
			.setTitle('Staff Application');

		questions.slice(0, 5).forEach((q, i) => {
			const input = new TextInputBuilder()
				.setCustomId(`q${i + 1}`)
				.setLabel(q.length > 45 ? q.substring(0, 42) + '...' : q)
				.setStyle(TextInputStyle.Paragraph)
				.setPlaceholder('Your answer...')
				.setRequired(true)
				.setMaxLength(1000);
			modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
		});

		return modal;
	}

	async handleApply(interaction: ButtonInteraction): Promise<void> {
		const userId = interaction.user.id;
		const guildId = interaction.guildId!;
		// Scope the duplicate check to this guild (was global by userId only).
		const existing = await PresentationApplication.findOne({ guildId, userId, status: 'pending' });
		if (existing) {
			await interaction.reply({ content: '❌ You already have a pending application!', flags: 64 });
			return;
		}

		const modal = await this.createApplicationModal();
		await interaction.showModal(modal);
	}

	async handleModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
		const answers: any[] = [];
		const questions = this.getQuestions();
		const modalQuestions = questions.slice(0, 5);

		for (let i = 0; i < modalQuestions.length; i++) {
			const answer = interaction.fields.getTextInputValue(`q${i + 1}`) || '';
			answers.push({ question: modalQuestions[i], answer: answer.slice(0, 1000) });
		}

		// Re-check inside the mutex + partial unique index — the button handler
		// checked, but the modal submits minutes later (TOCTOU duplicates).
		const created = await withMutex(`present:${interaction.guildId}:${interaction.user.id}`, async () => {
			const raced = await PresentationApplication.findOne({ guildId: interaction.guildId!, userId: interaction.user.id, status: 'pending' });
			if (raced) return raced;
			try {
				return await PresentationApplication.create({
					guildId: interaction.guildId!,
					userId: interaction.user.id,
					answers: answers.slice(0, 20),
					status: 'pending',
				});
			} catch (err) {
				if (isDuplicateKeyError(err)) {
					return PresentationApplication.findOne({ guildId: interaction.guildId!, userId: interaction.user.id, status: 'pending' });
				}
				throw err;
			}
		});
		if (!created) {
			await interaction.reply({ content: '❌ You already have a pending application!', flags: 64 });
			return;
		}
		recordActivity('command', 'Staff application submitted', { level: 'info', meta: { guildId: interaction.guildId, userId: interaction.user.id } });

		const cfg = await this.getConfig(interaction.guildId!);
		if (cfg.staffChannelId) {
			const staffChannel = await getTextChannel(interaction.guild as Guild, cfg.staffChannelId).catch(() => null);
			if (staffChannel) {
				const embed = EmbedBuilderUtil.presentation?.({
					id: 'new',
					user_id: interaction.user.id,
					answers: JSON.stringify(answers),
					status: 'pending',
					created_at: new Date().toISOString(),
				}) ?? new EmbedBuilder()
					.setColor('#5865F2')
					.setTitle('New Staff Application')
					.setDescription(`New application from <@${interaction.user.id}>`)
					.addFields(answers.map((a) => ({ name: a.question, value: a.answer, inline: false })))
					.setTimestamp();

				const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
					new ButtonBuilder().setCustomId('presentation_approve').setLabel('✅ Approve').setStyle(ButtonStyle.Success),
					new ButtonBuilder().setCustomId('presentation_deny').setLabel('❌ Deny').setStyle(ButtonStyle.Danger),
					new ButtonBuilder().setCustomId('presentation_changes').setLabel('📝 Request Changes').setStyle(ButtonStyle.Secondary),
				);

				await staffChannel.send({
					content: `📝 New staff application from <@${interaction.user.id}>!`,
					embeds: [embed],
					components: [row],
				}).catch((err) => console.warn('[Presentation] Failed to post application:', (err as Error)?.message ?? err));
			}
		}

		await interaction.reply({ content: '✅ Your application has been submitted! Staff will review it shortly.', flags: 64 });
	}

	async handleReview(interaction: ButtonInteraction, action: string): Promise<void> {
		const cfg = await this.getConfig(interaction.guildId!);
		const staffRoleId = cfg.staffRoleId;
		const member = interaction.member as GuildMember | null;
		if (!member) return;
		const isStaff = Boolean(
			(staffRoleId && member.roles.cache.has(staffRoleId))
			|| member.permissions?.has(PermissionFlagsBits.Administrator)
			|| member.permissions?.has(PermissionFlagsBits.ManageGuild),
		);
		if (!isStaff) {
			await interaction.reply({ content: '❌ Only staff can review applications.', flags: 64 });
			return;
		}

		const message = interaction.message;
		const embed = message.embeds[0];
		if (!embed) return;

		const footerText = embed.footer?.text || '';
		const userIdMatch = footerText.match(/User: (\d+)/);
		if (!userIdMatch) { await interaction.reply({ content: '❌ Could not find applicant.', flags: 64 }); return; }

		const applicantId = userIdMatch[1];
		const presentation = await PresentationApplication.findOne({ guildId: interaction.guildId!, userId: applicantId, status: 'pending' });
		if (!presentation) { await interaction.reply({ content: '❌ Application not found.', flags: 64 }); return; }

		const reason = action === 'changes' ? 'Changes requested by staff' : null;

		if (action === 'approve') {
			await PresentationApplication.findByIdAndUpdate(presentation.id, {
				status: 'approved',
				reviewedBy: interaction.user.id,
				reviewedAt: new Date(),
			});

			if (staffRoleId) {
				try {
					const guild = interaction.guild as Guild;
					const targetMember = await guild.members.fetch(applicantId);
					await targetMember.roles.add(staffRoleId);
				} catch (e) {
					console.error('[Presentation] Error assigning role:', e);
				}
			}

			await safeDm(interaction.guild as Guild, applicantId, '🎉 Congratulations! Your staff application has been **APPROVED**! Welcome to the team!');
			recordActivity('command', 'Staff application approved', { level: 'success', meta: { guildId: interaction.guildId, applicantId, reviewerId: interaction.user.id } });

			await message.edit({
				embeds: [EmbedBuilderUtil.success?.('Approved', `Application approved by ${interaction.user}`) ?? new EmbedBuilder().setColor(0x57F287).setTitle('Approved').setDescription(`Application approved by ${interaction.user}`)],
				components: [],
			}).catch(() => {});
		}
		else if (action === 'deny') {
			const modal = new ModalBuilder()
				.setCustomId(`presentation_deny_reason_${presentation.id}`)
				.setTitle('Deny Application - Reason')
				.addComponents(
					new ActionRowBuilder<TextInputBuilder>().addComponents(
						new TextInputBuilder()
							.setCustomId('deny_reason')
							.setLabel('Reason for denial')
							.setStyle(TextInputStyle.Paragraph)
							.setRequired(true)
							.setMaxLength(1000),
					),
				);
			await interaction.showModal(modal);
		}
		else if (action === 'changes') {
			const modal = new ModalBuilder()
				.setCustomId(`presentation_changes_reason_${presentation.id}`)
				.setTitle('Request Changes - Feedback')
				.addComponents(
					new ActionRowBuilder<TextInputBuilder>().addComponents(
						new TextInputBuilder()
							.setCustomId('changes_reason')
							.setLabel('What needs to be changed?')
							.setStyle(TextInputStyle.Paragraph)
							.setRequired(true)
							.setMaxLength(1000),
					),
				);
			await interaction.showModal(modal);
		}
	}

	async handleDenyModal(interaction: ModalSubmitInteraction, presentationId: string): Promise<void> {
		await interaction.deferReply({ flags: 64 });

		const reason = interaction.fields.getTextInputValue('deny_reason');
		const presentation = await PresentationApplication.findById(presentationId);
		if (!presentation) return;

		await PresentationApplication.findByIdAndUpdate(presentation.id, {
			status: 'denied',
			reviewedBy: interaction.user.id,
			reviewedAt: new Date(),
			reviewReason: reason,
		});

		await safeDm(interaction.guild as Guild, presentation.userId, `❌ Your staff application was **DENIED**.\n**Reason:** ${reason}`.slice(0, 1900));

		const message = interaction.message;
		if (message) {
			await message.edit({
				embeds: [EmbedBuilderUtil.error?.('Denied', `Application denied by ${interaction.user}\nReason: ${reason}`) ?? new EmbedBuilder().setColor(0xED4245).setTitle('Denied').setDescription(`Application denied by ${interaction.user}\nReason: ${reason}`)],
				components: [],
			}).catch(() => {});
		}

		await interaction.editReply({ content: '✅ Application denied.' });
	}

	async handleChangesModal(interaction: ModalSubmitInteraction, presentationId: string): Promise<void> {
		await interaction.deferReply({ flags: 64 });

		const reason = interaction.fields.getTextInputValue('changes_reason');
		const presentation = await PresentationApplication.findById(presentationId);
		if (!presentation) return;

		await PresentationApplication.findByIdAndUpdate(presentation.id, {
			status: 'changes_requested',
			reviewedBy: interaction.user.id,
			reviewedAt: new Date(),
			reviewReason: reason,
		});

		await safeDm(interaction.guild as Guild, presentation.userId, `📝 Your staff application needs **CHANGES**.\n**Feedback:** ${reason}\n\nYou can re-apply with the improved answers.`.slice(0, 1900));

		const message = interaction.message;
		if (message) {
			await message.edit({
				embeds: [EmbedBuilderUtil.warning?.('Changes Requested', `Changes requested by ${interaction.user}\nFeedback: ${reason}`) ?? new EmbedBuilder().setColor(0xFEE75C).setTitle('Changes Requested').setDescription(`Changes requested by ${interaction.user}\nFeedback: ${reason}`)],
				components: [],
			}).catch(() => {});
		}

		await interaction.editReply({ content: '✅ Changes requested.' });
	}
}

export const presentations = new PresentationSystem();

export const presentationApplyButton = {
	name: 'interactionCreate' as const,
	execute: async (_client: any, interaction: any) => {
		if (!interaction.isButton()) return;
		if (interaction.customId === 'presentation_apply_button') {
			try { await presentations.handleApply(interaction).catch(() => {}); } catch {}
		}
		if (interaction.customId === 'presentation_approve' || interaction.customId === 'presentation_deny' || interaction.customId === 'presentation_changes') {
			const action = interaction.customId === 'presentation_approve' ? 'approve' : interaction.customId === 'presentation_deny' ? 'deny' : 'changes';
			try { await presentations.handleReview(interaction, action).catch(() => {}); } catch {}
		}
	},
};

export const presentationModalSubmit = {
	name: 'interactionCreate' as const,
	execute: async (_client: any, interaction: any) => {
		if (!interaction.isModalSubmit()) return;
		if (interaction.customId === 'presentation_apply') {
			try { await presentations.handleModalSubmit(interaction).catch(() => {}); } catch {}
		}
		if (interaction.customId.startsWith('presentation_deny_reason_')) {
			const presentationId = interaction.customId.replace('presentation_deny_reason_', '');
			try { await presentations.handleDenyModal(interaction, presentationId).catch(() => {}); } catch {}
		}
		if (interaction.customId.startsWith('presentation_changes_reason_')) {
			const presentationId = interaction.customId.replace('presentation_changes_reason_', '');
			try { await presentations.handleChangesModal(interaction, presentationId).catch(() => {}); } catch {}
		}
	},
};
