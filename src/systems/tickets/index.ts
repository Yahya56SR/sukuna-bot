import type { Guild, TextChannel, User, GuildMember, ModalSubmitInteraction } from 'discord.js';
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
	AttachmentBuilder,
} from 'discord.js';
import { OpenTicket, TicketConfig } from '../../db/models/Ticket.js';
import { isDuplicateKeyError, withMutex } from '../../core/safety.js';
import { recordActivity } from '../../core/metrics.js';

interface TicketType {
	id: string;
	label: string;
	emoji: string;
	description: string;
}

interface TicketConfigI {
	categoryId?: string;
	staffRoleId?: string;
	logChannelId?: string;
	maxClaimsPerStaff?: number;
}

export interface TicketOutage {
	outage: boolean;
	maxClaims: number;
	perStaff: { staffId: string; claimed: number; atCap: boolean }[];
}

const priorityEmoji: Record<string, string> = { low: '🟢', medium: '🟡', high: '🟠', urgent: '🔴' };

export class TicketSystem {
	private ticketTypes: TicketType[] = [
		{ id: 'general', label: 'General Support', emoji: '🎫', description: 'General questions and support' },
		{ id: 'modpack', label: 'Modpack Help', emoji: '📦', description: 'Help installing/downloading modpacks' },
		{ id: 'report', label: 'Report Player', emoji: '🚨', description: 'Report a player for rule violations' },
		{ id: 'other', label: 'Other', emoji: '❓', description: 'Anything else' },
	];

	async getConfig(guildId: string): Promise<TicketConfigI> {
		const cfg = await TicketConfig.findOneAndUpdate(
			{ guildId },
			{ $setOnInsert: { guildId, maxTicketsPerUser: 3, cooldownSeconds: 60, autoCloseMinutes: 0, dmTranscript: true, staffRoleIds: [] } },
			{ upsert: true, new: true, setDefaultsOnInsert: true },
		).lean();
		return {
			categoryId: undefined,
			staffRoleId: (cfg as any).staffRoleIds?.[0] ?? undefined,
			logChannelId: (cfg as any).transcriptChannelId ?? undefined,
		};
	}

	async createTicketPanel(channel: TextChannel): Promise<void> {
		const embed = new EmbedBuilder()
			.setColor('#5865F2')
			.setTitle('🎫 Support Tickets')
			.setDescription('Select a category below to create a ticket. Our staff will assist you shortly.')
			.setTimestamp();

		const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder().setCustomId('ticket_create_general').setLabel('General Support').setEmoji('🎫').setStyle(ButtonStyle.Primary),
			new ButtonBuilder().setCustomId('ticket_create_modpack').setLabel('Modpack Help').setEmoji('📦').setStyle(ButtonStyle.Secondary),
			new ButtonBuilder().setCustomId('ticket_create_report').setLabel('Report Player').setEmoji('🚨').setStyle(ButtonStyle.Danger),
			new ButtonBuilder().setCustomId('ticket_create_other').setLabel('Other').setEmoji('❓').setStyle(ButtonStyle.Secondary),
		);

		await channel.send({ embeds: [embed], components: [row] });
	}

	async createTicket(interaction: any, type: string): Promise<void> {
		// Legacy panel path. The modern department flow (interactionCreate)
		// is canonical; this path only exists for the old `ticket_create_*`
		// buttons and has no category field in TicketConfig — fail closed with
		// an actionable message instead of a misleading "not configured".
		const guild = interaction.guild as Guild;
		const user = interaction.user as User;

		const cfg: TicketConfigI = await this.getConfig(guild.id);
		const categoryId = cfg.categoryId;

		if (!categoryId) {
			return interaction.reply({ content: '❌ This legacy ticket panel is retired — please use the department buttons (🎫) to open a ticket. If none exist, ask an admin to run /ticket setup.', flags: 64 });
		}

		const existingOpen = await OpenTicket.find({ guildId: guild.id, userId: user.id, closedAt: null });
		if (existingOpen.length > 0) {
			return interaction.reply({ content: `❌ You already have an open ticket: <#${existingOpen[0].channelId}>`, flags: 64 });
		}

		await interaction.deferReply({ flags: 64 });

		const category = guild.channels.cache.get(categoryId);
		if (!category || category.type !== ChannelType.GuildCategory) {
			return interaction.editReply({ content: '❌ Ticket category not found.' });
		}

		const ticketId = Math.random().toString(36).substring(2, 8).toUpperCase();
		const channelName = `ticket-${type}-${user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, '');

		const overwrites = [
			{ id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
			{ id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks] },
		];

		if (cfg.staffRoleId) {
			overwrites.push({ id: cfg.staffRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages] });
		}

		const ticketChannel = await guild.channels.create({
			name: channelName,
			type: ChannelType.GuildText,
			parent: category,
			permissionOverwrites: overwrites,
			topic: `Ticket #${ticketId} | Type: ${type} | Owner: ${user.id}`,
		});

		try {
			await OpenTicket.create({
				guildId: guild.id,
				channelId: ticketChannel.id,
				userId: user.id,
				departmentId: type,
				departmentName: this.getTypeLabel(type),
			});
		} catch (err) {
			// Never orphan a channel without a ticket row (locks the user out).
			await ticketChannel.delete('Ticket setup failed').catch(() => {});
			if (isDuplicateKeyError(err)) {
				const existing = await OpenTicket.findOne({ guildId: guild.id, userId: user.id, closedAt: null }).lean();
				return interaction.reply({ content: `❌ You already have an open ticket: <#${existing?.channelId ?? '?'}>`, flags: 64 });
			}
			throw err;
		}

		const ticketEmbed = new EmbedBuilder()
			.setColor('#5865F2')
			.setTitle(`🎫 Ticket #${ticketId} - ${this.getTypeLabel(type)}`)
			.setDescription(`**Created by:** ${user}\n**Type:** ${this.getTypeLabel(type)}\n\nPlease describe your issue. Staff will be with you shortly.`)
			.setFooter({ text: `Ticket ID: ${ticketId} | User: ${user.id}` })
			.setTimestamp();

		const controlRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder().setCustomId('ticket_claim').setLabel('Claim').setEmoji('👮').setStyle(ButtonStyle.Primary),
			new ButtonBuilder().setCustomId('ticket_close').setLabel('Close').setEmoji('🔒').setStyle(ButtonStyle.Danger),
			new ButtonBuilder().setCustomId('ticket_add_user').setLabel('Add User').setEmoji('➕').setStyle(ButtonStyle.Secondary),
			new ButtonBuilder().setCustomId('ticket_priority').setLabel('Priority').setEmoji('⚡').setStyle(ButtonStyle.Secondary),
		);

		const pingContent = cfg.staffRoleId ? `<@&${cfg.staffRoleId}>` : 'Staff';
		await ticketChannel.send({
			content: `${pingContent} ${user} created a ticket!`,
			embeds: [ticketEmbed],
			components: [controlRow],
		});

		await interaction.editReply({ content: `✅ Ticket created: ${ticketChannel}` });
	}

	getTypeLabel(type: string): string {
		const t = this.ticketTypes.find((x) => x.id === type);
		return t ? `${t.emoji} ${t.label}` : type;
	}

	async checkOutage(guild: Guild, cfg: TicketConfigI): Promise<TicketOutage> {
		const maxClaims = cfg.maxClaimsPerStaff ?? 5;
		const empty: TicketOutage = { outage: false, maxClaims, perStaff: [] };
		if (!cfg.staffRoleId || maxClaims <= 0) return empty;

		let role = guild.roles.cache.get(cfg.staffRoleId) ?? await guild.roles.fetch(cfg.staffRoleId).catch(() => null);
		if (!role) return empty;
		let staff = [...role.members.values()].filter((m) => !m.user.bot);
		if (!staff.length) {
			await guild.members.fetch().catch(() => null);
			role = guild.roles.cache.get(cfg.staffRoleId!) ?? role;
			staff = [...role.members.values()].filter((m) => !m.user.bot);
		}
		if (!staff.length) return { outage: true, maxClaims, perStaff: [] };

		const claimedTickets = await OpenTicket.find({ guildId: guild.id, claimedBy: { $ne: null }, closedAt: null }).lean();
		const claimed = new Map<string, number>();
		for (const t of claimedTickets) {
			if (t.claimedBy) claimed.set(t.claimedBy, (claimed.get(t.claimedBy) ?? 0) + 1);
		}
		const perStaff = staff.map((m) => {
			const count = claimed.get(m.id) ?? 0;
			return { staffId: m.id, claimed: count, atCap: count >= maxClaims };
		});
		return { outage: perStaff.every((s) => s.atCap), maxClaims, perStaff };
	}

	async handleButton(interaction: any): Promise<any> {
		const customId = interaction.customId;
		const channel = interaction.channel as TextChannel;
		const user = interaction.user as User;

		const topic = channel.topic || '';
		const ticketIdMatch = topic.match(/Ticket #(\w+)/);
		if (!ticketIdMatch) {
			return interaction.reply({ content: '❌ Not a valid ticket channel.', flags: 64 });
		}

		const ticket = await OpenTicket.findOne({ channelId: channel.id, closedAt: null });
		if (!ticket) return interaction.reply({ content: '❌ Ticket not found in database.', flags: 64 });

		const cfg: TicketConfigI = await this.getConfig(interaction.guild.id);
		const staffRoleId = cfg.staffRoleId;
		const member = interaction.member as GuildMember;
		const isStaff = Boolean(
			(staffRoleId && member.roles?.cache.has(staffRoleId))
			|| member.permissions?.has(PermissionFlagsBits.ManageGuild)
			|| member.permissions?.has(PermissionFlagsBits.Administrator),
		);

		switch (customId) {
		case 'ticket_claim': {
			if (!isStaff) return interaction.reply({ content: '❌ Only staff can claim tickets.', flags: 64 });
			// Atomic claim: only one staff member wins the race.
			const claimed = await OpenTicket.findOneAndUpdate(
				{ _id: ticket._id, closedAt: null, $or: [{ claimedBy: null }, { claimedBy: { $exists: false } }] },
				{ $set: { claimedBy: user.id, claimedAt: new Date() } },
				{ new: true },
			);
			if (!claimed) return interaction.reply({ content: `❌ Already claimed by <@${ticket.claimedBy ?? 'another staff member'}>.`, flags: 64 });
			await channel.send({ content: `👮 **${user}** claimed this ticket!` });
			recordActivity('command', 'Ticket claimed', { level: 'info', meta: { guildId: interaction.guild.id, ticketId: ticket._id.toString(), claimedBy: user.id } });
			await interaction.reply({ content: '✅ Ticket claimed!', flags: 64 });
			break;
		}

		case 'ticket_close': {
			if (!isStaff && ticket.userId !== user.id) return interaction.reply({ content: '❌ Only staff or ticket owner can close.', flags: 64 });

			const modal = new ModalBuilder()
				.setCustomId(`ticket_close_modal_${ticket._id}`)
				.setTitle('Close Ticket')
				.addComponents(
					new ActionRowBuilder<TextInputBuilder>().addComponents(
						new TextInputBuilder()
							.setCustomId('close_reason')
							.setLabel('Reason for closing')
							.setStyle(TextInputStyle.Paragraph)
							.setPlaceholder('Issue resolved, duplicate, etc.')
							.setRequired(true)
							.setMaxLength(500),
					),
				);
			await interaction.showModal(modal);
			break;
		}

		case 'ticket_add_user': {
			if (!isStaff && ticket.userId !== user.id) return interaction.reply({ content: '❌ Only staff or ticket owner can add users.', flags: 64 });

			const modal = new ModalBuilder()
				.setCustomId(`ticket_add_user_modal_${ticket._id}`)
				.setTitle('Add User to Ticket')
				.addComponents(
					new ActionRowBuilder<TextInputBuilder>().addComponents(
						new TextInputBuilder()
							.setCustomId('user_id')
							.setLabel('User ID or mention')
							.setStyle(TextInputStyle.Short)
							.setPlaceholder('123456789012345678 or @user')
							.setRequired(true),
					),
				);
			await interaction.showModal(modal);
			break;
		}

		case 'ticket_priority': {
			if (!isStaff) return interaction.reply({ content: '❌ Only staff can change priority.', flags: 64 });
			await interaction.reply({ content: '✅ Priority updated.', flags: 64 });
			break;
		}

		case 'ticket_modpack_helped_yes': {
			await channel.send({ content: `✅ ${user} confirmed the modpack tutorial helped!` });
			await interaction.reply({ content: 'Great! Ticket will be closed shortly.', flags: 64 });
			await this.closeTicket(ticket._id.toString(), channel, user, 'Modpack tutorial helped');
			break;
		}

		case 'ticket_modpack_helped_no': {
			await channel.send({ content: `❌ ${user} needs further assistance. Notifying staff...` });
			await interaction.reply({ content: 'Staff has been notified.', flags: 64 });
			break;
		}
		}
	}

	async handleModal(interaction: ModalSubmitInteraction): Promise<any> {
		const customId = interaction.customId;
		const channel = interaction.channel as TextChannel;
		const user = interaction.user as User;

		if (customId.startsWith('ticket_close_modal_')) {
			const ticketId = customId.replace('ticket_close_modal_', '');
			const reason = interaction.fields.getTextInputValue('close_reason');
			await this.closeTicket(ticketId, channel, user, reason);
			await interaction.reply({ content: '✅ Ticket closed!', flags: 64 });
		}
		else if (customId.startsWith('ticket_add_user_modal_')) {
			const ticketId = customId.replace('ticket_add_user_modal_', '');
			const input = interaction.fields.getTextInputValue('user_id');
			const userId = input.replace(/[<@!>]/g, '');

			const targetUser = await interaction.client.users.fetch(userId).catch(() => null);
			if (!targetUser) {
				return interaction.reply({ content: '❌ User not found.', flags: 64 });
				return;
			}

			await channel.permissionOverwrites.edit(userId, {
				ViewChannel: true,
				SendMessages: true,
				AttachFiles: true,
				EmbedLinks: true,
			});

			await channel.send({ content: `➕ **${targetUser}** was added to the ticket by ${user}.` });
			await interaction.reply({ content: `✅ Added ${targetUser} to ticket!`, flags: 64 });
		}
	}

	async closeTicket(ticketId: string, channel: TextChannel, closer: User, reason: string): Promise<void> {
		const cfg: TicketConfigI = await this.getConfig(channel.guild.id);
		const logChannelId = cfg.logChannelId || '';

		// Mark closed FIRST so a transcript send failure can never leave the
		// ticket open. Idempotent: a second close is a no-op.
		const ticket = await OpenTicket.findOneAndUpdate(
			{ _id: ticketId, closedAt: null },
			{ $set: { closedAt: new Date(), closedBy: closer.id, closeReason: reason } },
			{ new: true },
		);
		if (!ticket) {
			await channel.delete(`Ticket closed by ${closer.tag}: ${reason}`).catch(() => {});
			return;
		}
		recordActivity('command', 'Ticket closed', { level: 'info', meta: { guildId: channel.guild.id, ticketId, closedBy: closer.id } });

		if (logChannelId) {
			try {
				const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
				if (messages) {
					const transcript = messages
						.reverse()
						.map((m: any) => `[${m.createdAt.toLocaleString()}] ${m.author?.tag ?? m.author?.id ?? 'unknown'}: ${(m.content ?? '').slice(0, 1000)}${m.attachments?.size > 0 ? ` [${m.attachments.size} attachment(s)]` : ''}`)
						.join('\n');
					const transcriptChannel = channel.guild.channels.cache.get(logChannelId);
					if (transcriptChannel && transcriptChannel.isTextBased()) {
						const embed = new EmbedBuilder()
							.setTitle(`📝 Ticket Transcript - #${ticketId}`)
							.setColor('#ED4245')
							.addFields(
								{ name: 'Closed by', value: closer.tag ?? closer.id, inline: true },
								{ name: 'Reason', value: reason.slice(0, 200) || '—', inline: true },
								{ name: 'Messages', value: messages.size.toString(), inline: true },
							)
							.setTimestamp();
						const attachment = new AttachmentBuilder(Buffer.from(transcript.slice(0, 500_000)), { name: `ticket-${ticketId}.txt` });
						await transcriptChannel.send({ embeds: [embed], files: [attachment] });
					}
				}
			} catch (err) {
				// Transcript is best-effort — the ticket is already closed.
				console.warn('[Tickets] Transcript failed:', (err as Error)?.message ?? err);
			}
		}

		await channel.delete(`Ticket closed by ${closer.tag ?? closer.id}: ${reason}`.slice(0, 300)).catch(() => {});
	}
}

export const tickets = new TicketSystem();

export const interactionCreateTickets = {
	name: 'interactionCreate' as const,
	execute: async (_client: any, interaction: any) => {
		if (!interaction.isButton() && !interaction.isModalSubmit()) return;
		if (interaction.isButton() && interaction.customId.startsWith('ticket_create_')) {
			const type = interaction.customId.replace('ticket_create_', '');
			await tickets.createTicket(interaction, type).catch((err) => console.warn('[Tickets] create failed:', (err as Error)?.message ?? err));
		}
		if (interaction.isButton() && interaction.customId.startsWith('ticket_')) {
			await tickets.handleButton(interaction).catch((err) => console.warn('[Tickets] handleButton failed:', (err as Error)?.message ?? err));
		}
		if (interaction.isModalSubmit() && interaction.customId.startsWith('ticket_')) {
			await tickets.handleModal(interaction).catch((err) => console.warn('[Tickets] handleModal failed:', (err as Error)?.message ?? err));
		}
	},
};
