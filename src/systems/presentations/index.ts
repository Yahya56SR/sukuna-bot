import type { Guild, TextChannel, User, GuildMember } from 'discord.js';
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
import { Helpers } from '../../utils/shared-helpers.js';

/**
 * Staff Presentation system.
 * Uses Mongoose (PresentationConfig, PresentationApplication).
 */
export class PresentationSystem {
	async getConfig(guildId: string) {
		let cfg = await PresentationConfig.findOne({ guildId }).lean();
		if (!cfg) {
			cfg = await PresentationConfig.create({
				guildId,
				questions: [
					'What is your name?',
					'How old are you?',
					'Why do you want to be staff?',
					'Do you have previous moderation experience?',
					'What timezone are you in?',
					'How many hours can you dedicate per week?',
				],
			});
		}
		return cfg;
	}

	async getQuestions(guildId: string): Promise<string[]> {
		const cfg = await this.getConfig(guildId);
		return cfg.questions || [
			'What is your name?',
			'How old are you?',
			'Why do you want to be staff?',
			'Do you have previous moderation experience?',
			'What timezone are you in?',
			'How many hours can you dedicate per week?',
		];
	}

	async createPresentationPanel(channel: TextChannel, guildId: string): Promise<void> {
		const embed = new EmbedBuilder()
			.setColor(0x5865F2)
			.setTitle('👮 Staff Applications')
			.setDescription(
				"We're looking for dedicated members to join our staff team!\n\n" +
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

	async createApplicationModal(guildId: string): Promise<ModalBuilder> {
		const questions = await this.getQuestions(guildId);
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

	async handleApply(interaction: any, guildId: string): Promise<void> {
		const userId = interaction.user.id;
		const existing = await PresentationApplication.findOne({ guildId, userId, status: 'pending' });
		if (existing) {
			return interaction.reply({ content: '❌ You already have a pending application!', flags: 64 });
		}
		const modal = await this.createApplicationModal(guildId);
		await interaction.showModal(modal);
	}

	async handleModalSubmit(interaction: any, guildId: string): Promise<void> {
		const questions = await this.getQuestions(guildId);
		const modalQuestions = questions.slice(0, 5);
		const answers: any[] = [];
		for (let i = 0; i < modalQuestions.length; i++) {
			const answer = interaction.fields.getTextInputValue(`q${i + 1}`) || '';
			answers.push({ question: modalQuestions[i], answer });
		}

		const presentation = await PresentationApplication.create({
			guildId,
			userId: interaction.user.id,
			answers,
			status: 'pending',
		}) as any;

		const cfg = await this.getConfig(guildId);
		if (cfg.staffChannelId) {
			const staffChannel = interaction.client.channels.cache.get(cfg.staffChannelId) as TextChannel;
			if (staffChannel) {
				const embed = EmbedBuilderUtil.presentation({
					id: presentation.id,
					userId: interaction.user.id,
					answers: JSON.stringify(answers),
					status: 'pending',
					createdAt: new Date().toISOString(),
				});
				const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
					new ButtonBuilder().setCustomId('presentation_approve').setLabel('✅ Approve').setStyle(ButtonStyle.Success),
					new ButtonBuilder().setCustomId('presentation_deny').setLabel('❌ Deny').setStyle(ButtonStyle.Danger),
					new ButtonBuilder().setCustomId('presentation_changes').setLabel('📝 Request Changes').setStyle(ButtonStyle.Secondary),
				);
				await staffChannel.send({
					content: `📝 New staff application from <@${interaction.user.id}>!`,
					embeds: [embed],
					components: [row],
				});
			}
		}

		await interaction.reply({
			content: '✅ Your application has been submitted! Staff will review it shortly.',
			flags: 64,
		});
	}

	async handleReview(interaction: any, action: string, guildId: string): Promise<void> {
		const cfg = await this.getConfig(guildId);
		const staffRoleId = cfg.staffRoleId;
		const isStaff = staffRoleId && interaction.member.roles.cache.has(staffRoleId);
		if (!isStaff && !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
			return interaction.reply({ content: '❌ Only staff can review applications.', flags: 64 });
		}

		const message = interaction.message;
		const embed = message.embeds[0];
		if (!embed) return;

		const footerText = embed.footer?.text || '';
		const userIdMatch = footerText.match(/User: (\d+)/);
		if (!userIdMatch) return interaction.reply({ content: '❌ Could not find applicant.', flags: 64 });

		const applicantId = userIdMatch[1];
		const presentation = await PresentationApplication.findOne({ guildId, userId: applicantId, status: 'pending' });
		if (!presentation) return interaction.reply({ content: '❌ Application not found.', flags: 64 });

		if (!isStaff && !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
			return interaction.reply({ content: '❌ Only staff can review applications.', flags: 64 });
		}

		if (action === 'approve') {
			await PresentationApplication.findByIdAndUpdate(presentation.id, {
				status: 'approved',
				reviewedBy: interaction.user.id,
				reviewedAt: new Date(),
			});

			if (staffRoleId) {
				try {
					const member = await interaction.guild.members.fetch(applicantId);
					await member.roles.add(staffRoleId);
				} catch (e) {
					console.error('[Presentation] Error assigning role:', e);
				}
			}

			try {
				const user = await interaction.client.users.fetch(applicantId);
				await user.send({ content: '🎉 Congratulations! Your staff application has been **APPROVED**! Welcome to the team!' }).catch(() => {});
			} catch {}

			await message.edit({
				embeds: [EmbedBuilderUtil.success('Approved', `Application approved by ${interaction.user}`)],
				components: [],
			});
		} else if (action === 'deny' || action === 'changes') {
			const modal = new ModalBuilder()
				.setCustomId(`presentation_${action === 'deny' ? 'deny_reason' : 'changes_reason'}_${presentation.id}`)
				.setTitle(action === 'deny' ? 'Deny Application - Reason' : 'Request Changes - Feedback')
				.addComponents(
					new ActionRowBuilder<TextInputBuilder>().addComponents(
						new TextInputBuilder()
							.setCustomId(action === 'deny' ? 'deny_reason' : 'changes_reason')
							.setLabel(action === 'deny' ? 'Reason for denial' : 'What needs to be changed?')
							.setStyle(TextInputStyle.Paragraph)
							.setRequired(true)
							.setMaxLength(1000),
					),
				);
			await interaction.showModal(modal);
		}
	}

	async handleDenyModal(interaction: any, presentationId: string): Promise<void> {
		await interaction.deferReply({ flags: 64 });
		const reason = interaction.fields.getTextInputValue('deny_reason');
		const presentation = await PresentationApplication.findById(presentationId);
		if (!presentation) return;

		await PresentationApplication.findByIdAndUpdate(presentationId, {
			status: 'denied',
			reviewedBy: interaction.user.id,
			reviewedAt: new Date(),
			reviewReason: reason,
		});

		try {
			const user = await interaction.client.users.fetch(presentation.userId);
			await user.send({ content: `❌ Your staff application was **DENIED**.\n**Reason:** ${reason}` }).catch(() => {});
		} catch {}

		await interaction.message.edit({
			embeds: [EmbedBuilderUtil.error('Denied', `Application denied by ${interaction.user}\nReason: ${reason}`)],
			components: [],
		});
		await interaction.editReply({ content: '✅ Application denied.' });
	}

	async handleChangesModal(interaction: any, presentationId: string): Promise<void> {
		await interaction.deferReply({ flags: 64 });
		const reason = interaction.fields.getTextInputValue('changes_reason');
		const presentation = await PresentationApplication.findById(presentationId);
		if (!presentation) return;

		await PresentationApplication.findByIdAndUpdate(presentationId, {
			status: 'changes_requested',
			reviewedBy: interaction.user.id,
			reviewedAt: new Date(),
			reviewReason: reason,
		});

		try {
			const user = await interaction.client.users.fetch(presentation.userId);
			await user.send({ content: `📝 Your staff application needs **CHANGES**.\n**Feedback:** ${reason}\n\nYou can re-apply with the improved answers.` }).catch(() => {});
		} catch {}

		await interaction.message.edit({
			embeds: [EmbedBuilderUtil.warning('Changes Requested', `Changes requested by ${interaction.user}\nFeedback: ${reason}`)],
			components: [],
		});
		await interaction.editReply({ content: '✅ Changes requested.' });
	}
}

export const presentations = new PresentationSystem();
