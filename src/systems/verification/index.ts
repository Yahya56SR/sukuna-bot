import type { ButtonInteraction, Guild, GuildMember, ModalSubmitInteraction, Role, TextChannel } from 'discord.js';
import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	Colors,
	EmbedBuilder,
	ModalBuilder,
	TextInputBuilder,
	TextInputStyle,
} from 'discord.js';
import { VerificationConfig, VerificationRequest } from '../../db/models/Verification.js';
import EmbedBuilderUtil from '../../utils/shared-embeds.js';

export interface VerificationSettings {
	enabled: boolean;
	unverifiedRoleId: string | null;
	verifiedRoleId: string | null;
	rulesChannelId: string | null;
	panelMessageId: string | null;
	autoRoleIds: string[];
	requireApproval: boolean;
	logChannelId: string | null;
	minAccountAgeDays: number;
	voiceChannelId: string | null;
	staffRoleId: string | null;
}

export interface JoinRoleResult {
	granted: string[];
	ungranted: string[];
	unverifiedGranted: boolean;
}

function parseRoleIds(raw: string | null | undefined): string[] {
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw);
		if (Array.isArray(parsed)) {
			return parsed.filter((id): id is string => typeof id === 'string');
		}
	} catch {}
	return [];
}

export class VerificationSystem {
	async getSettings(guildId: string): Promise<VerificationSettings> {
		let row = await VerificationConfig.findOne({ guildId }).lean();
		if (!row) {
			row = await VerificationConfig.create({ guildId, enabled: false, autoRoleIds: [], requireApproval: false, minAccountAgeDays: 0 });
		}
		const r = row as any;
		return {
			enabled: r.enabled === true,
			unverifiedRoleId: r.unverifiedRoleId ?? null,
			verifiedRoleId: r.verifiedRoleId ?? null,
			rulesChannelId: r.rulesChannelId ?? null,
			panelMessageId: r.panelMessageId ?? null,
			autoRoleIds: Array.isArray(r.autoRoleIds) ? r.autoRoleIds : [],
			requireApproval: r.requireApproval === true,
			logChannelId: r.logChannelId ?? null,
			minAccountAgeDays: r.minAccountAgeDays ?? 0,
			voiceChannelId: r.voiceChannelId ?? null,
			staffRoleId: r.staffRoleId ?? null,
		};
	}

	async setSettings(guildId: string, data: Partial<any>): Promise<void> {
		await VerificationConfig.findOneAndUpdate({ guildId }, { $set: data }, { upsert: true, new: true, setDefaultsOnInsert: true });
	}

	async setPanelMessage(guildId: string, messageId: string | null): Promise<void> {
		await this.setSettings(guildId, { panelMessageId: messageId });
	}

	async setAutoRoles(guildId: string, roleIds: string[]): Promise<void> {
		await this.setSettings(guildId, { autoRoleIds: [...new Set(roleIds)] });
	}

	async addAutoRole(guildId: string, roleId: string): Promise<boolean> {
		const settings = await this.getSettings(guildId);
		if (settings.autoRoleIds.includes(roleId)) return false;
		await this.setAutoRoles(guildId, [...settings.autoRoleIds, roleId]);
		return true;
	}

	async removeAutoRole(guildId: string, roleId: string): Promise<boolean> {
		const settings = await this.getSettings(guildId);
		if (!settings.autoRoleIds.includes(roleId)) return false;
		await this.setAutoRoles(guildId, settings.autoRoleIds.filter((id) => id !== roleId));
		return true;
	}

	isConfigured(settings: VerificationSettings): boolean {
		return !!settings.unverifiedRoleId;
	}

	isVerified(member: GuildMember, settings: VerificationSettings): boolean {
		if (settings.verifiedRoleId && member.roles.cache.has(settings.verifiedRoleId)) return true;
		if (!settings.unverifiedRoleId) return true;
		return !member.roles.cache.has(settings.unverifiedRoleId);
	}

	private manageableRoles(member: GuildMember, roleIds: string[]): Role[] {
		return roleIds
			.map((id) => member.guild.roles.cache.get(id))
			.filter((role): role is Role => !!role && role.editable);
	}

	async handleMemberAdd(member: GuildMember): Promise<JoinRoleResult> {
		const result: JoinRoleResult = { granted: [], ungranted: [], unverifiedGranted: false };
		const settings = await this.getSettings(member.guild.id);
		if (!settings.enabled || !settings.unverifiedRoleId) return result;
		if (member.user.bot) return result;
		if (settings.verifiedRoleId && member.roles.cache.has(settings.verifiedRoleId)) return result;

		const autoRoles = settings.autoRoleIds.filter(
			(id) => id !== settings.unverifiedRoleId && id !== settings.verifiedRoleId,
		);
		const toAdd = this.manageableRoles(member, autoRoles).filter((role) => !member.roles.cache.has(role.id));
		result.granted = toAdd.map((role) => role.id);
		result.ungranted = autoRoles.filter((id) => !this.manageableRoles(member, [id]).length);

		if (toAdd.length) {
			await member.roles.add(toAdd, 'Automatic newbie roles').catch(() => {});
		}

		const unverifiedRole = member.guild.roles.cache.get(settings.unverifiedRoleId);
		if (unverifiedRole?.editable && !member.roles.cache.has(unverifiedRole.id)) {
			await member.roles.add(unverifiedRole, 'Awaiting newbie verification').catch(() => {});
			result.unverifiedGranted = true;
		}

		return result;
	}

	missingAutoRoles(member: GuildMember, settings: VerificationSettings): string[] {
		return settings.autoRoleIds.filter(
			(roleId) =>
				roleId !== settings.unverifiedRoleId &&
				roleId !== settings.verifiedRoleId &&
				!member.roles.cache.has(roleId),
		);
	}

	private accountAgeBlock(member: GuildMember, settings: VerificationSettings): string | null {
		if (settings.minAccountAgeDays <= 0) return null;
		const ageDays = (Date.now() - member.user.createdTimestamp) / 86_400_000;
		if (ageDays >= settings.minAccountAgeDays) return null;
		const remaining = Math.ceil(settings.minAccountAgeDays - ageDays);
		return `Your account must be at least **${settings.minAccountAgeDays} day(s)** old — try again in about **${remaining} day(s)**.`;
	}

	buildPanel(guild: Guild, settings: VerificationSettings): EmbedBuilder {
		const unverified = guild.roles.cache.get(settings.unverifiedRoleId ?? '');
		const rulesTarget = settings.rulesChannelId ? `in <#${settings.rulesChannelId}>` : 'in the rules channel';

		const steps = [
			`1️⃣ Read the rules ${rulesTarget}.`,
			'2️⃣ Press **Verify me** below.',
			'3️⃣ A staff member joins you in a short private voice call to confirm you are a real person and agree to the rules.',
			'4️⃣ On approval you instantly get access to the rest of the server.',
		].join('\n');

		const embed = new EmbedBuilder()
			.setColor(Colors.Blue)
			.setTitle(`🔐 Welcome to ${guild.name}`)
			.setDescription(
				`Before you can chat you need to accept our rules.\n\n${steps}` +
				(unverified ? `\n\nRight now you have ${unverified}, so you can only see the rules channels.` : ''),
			)
			.addFields({
				name: '⚠️ By verifying you agree to',
				value: 'Follow the server rules, stay respectful, and no spam or NSFW content.',
				inline: false,
			});

		return embed.setFooter({ text: `Verification • ${guild.name}` }).setTimestamp();
	}

	buildPanelRow(_guild: Guild, _settings: VerificationSettings): ActionRowBuilder<ButtonBuilder> {
		const buttons: ButtonBuilder[] = [
			new ButtonBuilder()
				.setCustomId('verification_agree')
				.setLabel('Verify me')
				.setEmoji('✅')
				.setStyle(ButtonStyle.Success),
		];
		return new ActionRowBuilder<ButtonBuilder>().addComponents(buttons);
	}

	async postPanel(channel: TextChannel): Promise<string> {
		const guild = channel.guild as Guild;
		const settings = await this.getSettings(guild.id);
		if (!settings.unverifiedRoleId) {
			throw new Error('No unverified role configured. Run `/verify setup` first.');
		}

		await guild.roles.fetch().catch(() => {});

		if (settings.panelMessageId) {
			const old = await channel.messages.fetch(settings.panelMessageId).catch(() => null);
			await old?.delete().catch(() => {});
		}

		const message = await channel.send({
			embeds: [this.buildPanel(guild, settings)],
			components: [this.buildPanelRow(guild, settings)],
		});

		await this.setPanelMessage(guild.id, message.id);
		return message.id;
	}

	async handleVerifyButton(interaction: ButtonInteraction): Promise<void> {
		await interaction.deferReply({ flags: 64 });
		const guild = interaction.guild as Guild;
		const member = interaction.member as GuildMember;
		const settings = await this.getSettings(guild.id);

		if (!settings.enabled) {
			await interaction.editReply({ embeds: [EmbedBuilderUtil.error?.('Verification disabled', 'Verification is currently disabled.') ?? new EmbedBuilder().setColor(0xED4245).setTitle('Verification disabled').setDescription('Verification is currently disabled.')] });
			return;
		}
		if (!settings.unverifiedRoleId) {
			await interaction.editReply({ embeds: [EmbedBuilderUtil.error?.('Not configured', 'No unverified role is set.') ?? new EmbedBuilder().setColor(0xED4245).setTitle('Not configured').setDescription('No unverified role is set.')] });
			return;
		}
		if (this.isVerified(member, settings)) {
			await interaction.editReply({ embeds: [EmbedBuilderUtil.success?.('Already verified', 'You already have full access.') ?? new EmbedBuilder().setColor(0x57F287).setTitle('Already verified').setDescription('You already have full access.')] });
			return;
		}

		const ageBlock = this.accountAgeBlock(member, settings);
		if (ageBlock) {
			await interaction.editReply({ embeds: [EmbedBuilderUtil.error?.('Account too new', ageBlock) ?? new EmbedBuilder().setColor(0xED4245).setTitle('Account too new').setDescription(ageBlock)] });
			return;
		}

		const retry = this.manageableRoles(member, this.missingAutoRoles(member, settings));
		if (retry.length) {
			await member.roles.add(retry, 'Automatic newbie roles').catch(() => {});
		}

		const live = await VerificationRequest.findOne({ guildId: guild.id, userId: member.id, status: { $in: ['pending', 'claimed'] } });
		if (live) {
			await interaction.editReply({ embeds: [EmbedBuilderUtil.info?.('Already requested', 'Your request is already waiting for staff review.') ?? new EmbedBuilder().setColor(0x5865F2).setTitle('Already requested').setDescription('Your request is already waiting for staff review.')] });
			return;
		}

		const request = await VerificationRequest.create({ guildId: guild.id, userId: member.id, status: 'pending' });

		// Send to staff log channel
		const channelId = settings.logChannelId || settings.rulesChannelId;
		if (channelId) {
			const channel = guild.channels.cache.get(channelId);
			if (channel?.isTextBased() && !channel.isThread()) {
				const staffRoleId = settings.staffRoleId;
				await channel.send({
					content: staffRoleId ? `<@&${staffRoleId}>` : undefined,
					allowedMentions: staffRoleId ? { roles: [staffRoleId] } : { parse: [] },
					embeds: [this.reviewEmbed(request, member, settings)],
					components: [this.reviewRow(request.id.toString())],
				}).catch(() => {});
			}
		}

		try {
			const user = await guild.client.users.fetch(member.id);
			await user.send({ content: '⏳ Your verification request was sent to the staff team. When a staff member is available they will invite you to a short private voice call to verify you.' }).catch(() => {});
		} catch {}

		await interaction.editReply({ embeds: [EmbedBuilderUtil.info?.('Request sent', 'A staff member will invite you to a short private voice call to complete verification.') ?? new EmbedBuilder().setColor(0x5865F2).setTitle('Request sent').setDescription('A staff member will invite you to a short private voice call to complete verification.')] });
	}

	async approveMember(member: GuildMember, settings: VerificationSettings): Promise<void> {
		const add: string[] = [];
		const remove: string[] = [];
		if (settings.unverifiedRoleId && member.roles.cache.has(settings.unverifiedRoleId)) remove.push(settings.unverifiedRoleId);
		if (settings.verifiedRoleId) {
			const role = member.guild.roles.cache.get(settings.verifiedRoleId);
			if (role?.editable && !member.roles.cache.has(role.id)) add.push(role.id);
		}
		if (remove.length) await member.roles.remove(remove, 'Verification completed');
		if (add.length) await member.roles.add(add, 'Verification completed');
	}

	private denyModal(requestId: string): ModalBuilder {
		return new ModalBuilder()
			.setCustomId(`verification_deny_reason_${requestId}`)
			.setTitle('Deny verification — reason')
			.addComponents(
				new ActionRowBuilder<TextInputBuilder>().addComponents(
					new TextInputBuilder()
						.setCustomId('deny_reason')
						.setLabel('Reason (shown to the member)')
						.setStyle(TextInputStyle.Paragraph)
						.setRequired(true)
						.setMaxLength(1000),
				),
			);
	}

	private hasStaff(interaction: ButtonInteraction | ModalSubmitInteraction, settings: VerificationSettings): boolean {
		const member = interaction.member as GuildMember;
		if (!member) return false;
		if (member.permissions?.has('ManageGuild')) return true;
		if (member.permissions?.has('ManageMessages')) return true;
		if (settings.staffRoleId && member.roles?.cache.has(settings.staffRoleId)) return true;
		return false;
	}

	async handleApprove(interaction: ButtonInteraction, requestId: string): Promise<void> {
		const request = await VerificationRequest.findById(requestId);
		if (!request || request.status !== 'pending') {
			await interaction.reply({ content: '❌ This request is no longer pending.', flags: 64 });
			return;
		}
		const guild = interaction.guild as Guild;
		const settings = await this.getSettings(guild.id);
		if (!this.hasStaff(interaction, settings)) {
			await interaction.reply({ content: '❌ Only staff can review verifications.', flags: 64 });
			return;
		}
		await interaction.deferReply({ flags: 64 });
		const member = await guild.members.fetch(request.userId).catch(() => null);

		if (member) {
			await this.approveMember(member, settings);
			try { await guild.client.users.fetch(request.userId).then((u) => u.send('🎉 Welcome! Your verification was approved.').catch(() => {})); } catch {}
		}

		request.status = 'approved';
		request.reviewedBy = interaction.user.id;
		request.reviewedAt = new Date();
		await request.save();

		await interaction.editReply({ embeds: [EmbedBuilderUtil.success?.('Approved', member ? `<@${request.userId}> has been verified.` : 'Approved.') ?? new EmbedBuilder().setColor(0x57F287).setTitle('Approved').setDescription(member ? `<@${request.userId}> has been verified.` : 'Approved.')] });
		if (interaction.message) {
			await interaction.message.edit({ content: null, embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle(`Request #${requestId}`).setDescription(`Approved by ${interaction.user}`)], components: [] }).catch(() => {});
		}
	}

	async handleDenyButton(interaction: ButtonInteraction, requestId: string): Promise<void> {
		const request = await VerificationRequest.findById(requestId);
		if (!request || request.status !== 'pending') {
			await interaction.reply({ content: '❌ This request is no longer pending.', flags: 64 });
			return;
		}
		const guild = interaction.guild as Guild;
		const settings = await this.getSettings(guild.id);
		if (!this.hasStaff(interaction, settings)) {
			await interaction.reply({ content: '❌ Only staff can review verifications.', flags: 64 });
			return;
		}
		await interaction.showModal(this.denyModal(requestId));
	}

	async handleDenyModal(interaction: ModalSubmitInteraction, requestId: string): Promise<void> {
		const guild = interaction.guild as Guild;
		const settings = await this.getSettings(guild.id);
		if (!this.hasStaff(interaction, settings)) {
			await interaction.reply({ content: '❌ Only staff can review verifications.', flags: 64 });
			return;
		}
		await interaction.deferReply({ flags: 64 });
		const request = await VerificationRequest.findById(requestId);
		if (!request || request.status !== 'pending') {
			await interaction.editReply({ content: '❌ This request is no longer pending.' });
			return;
		}

		const reason = interaction.fields.getTextInputValue('deny_reason');

		request.status = 'denied';
		request.reviewedBy = interaction.user.id;
		request.reviewedAt = new Date();
		request.reason = reason;
		await request.save();

		try { await guild.client.users.fetch(request.userId).then((u) => u.send(`❌ Your verification was denied.\n**Reason:** ${reason}`).catch(() => {})); } catch {}

		await interaction.editReply({ content: '✅ Request denied.' });
		if (interaction.message) {
			await interaction.message.edit({ content: null, embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle(`Request #${requestId}`).setDescription(`Denied by ${interaction.user}\n**Reason:** ${reason}`)], components: [] }).catch(() => {});
		}
	}

	async reviewUser(member: GuildMember, action: 'approve' | 'deny', reviewerId: string, reason?: string | null): Promise<void> {
		const guild = member.guild as Guild;
		const settings = await this.getSettings(guild.id);
		if (action === 'approve') {
			await this.approveMember(member, settings);
			try { await guild.client.users.fetch(member.id).then((u) => u.send('🎉 Welcome! Your verification was approved.').catch(() => {})); } catch {}
			return;
		}
		const pending = await VerificationRequest.findOne({ guildId: guild.id, userId: member.id, status: 'pending' });
		if (pending) {
			pending.status = 'denied';
			pending.reviewedBy = reviewerId;
			pending.reviewedAt = new Date();
			pending.reason = reason ?? undefined;
			await pending.save();
		}
		try { await guild.client.users.fetch(member.id).then((u) => u.send(`❌ Your verification was denied.\n**Reason:** ${reason || 'No reason given'}`).catch(() => {})); } catch {}
	}

	async resetMember(member: GuildMember, actorId: string): Promise<void> {
		const guild = member.guild as Guild;
		const settings = await this.getSettings(guild.id);
		await VerificationRequest.deleteMany({ guildId: guild.id, userId: member.id, status: 'pending' });

		const remove: string[] = [];
		const add: string[] = [];
		if (settings.verifiedRoleId && member.roles.cache.has(settings.verifiedRoleId)) remove.push(settings.verifiedRoleId);
		if (settings.unverifiedRoleId) {
			const role = guild.roles.cache.get(settings.unverifiedRoleId);
			if (role?.editable && !member.roles.cache.has(role.id)) add.push(role.id);
		}
		if (remove.length) await member.roles.remove(remove, 'Verification reset');
		if (add.length) await member.roles.add(add, 'Verification reset');
		try { await guild.client.users.fetch(member.id).then((u) => u.send('🔄 Your verification was reset by the staff team. Please verify again using the panel.').catch(() => {})); } catch {}
	}

	pendingRequests(guildId: string, limit = 25): Promise<any[]> {
		// Include claimed: claim/approve/deny flows look up claimed rows
		// through this accessor — filtering to `pending` only made every
		// claimed request unfindable (and the old `.save()` on lean rows
		// crashed with "save is not a function").
		return VerificationRequest.find({ guildId, status: { $in: ['pending', 'claimed'] } }).sort({ createdAt: -1 }).limit(limit).lean();
	}

	pendingCount(guildId: string): Promise<number> {
		return VerificationRequest.countDocuments({ guildId, status: 'pending' });
	}

	reviewEmbed(request: any, member: GuildMember | null, _settings?: VerificationSettings): EmbedBuilder {
		return new EmbedBuilder()
			.setColor(Colors.Orange)
			.setTitle('🎙️ Newbie verification request')
			.setDescription(
				`<@${request.userId}> is waiting to be verified.\n\nPress **Claim & verify** to take this request.`,
			)
			.addFields(
				{ name: '👤 Member', value: member ? `<@${member.id}>\n${member.user.username}` : `<@${request.userId}>`, inline: true },
				{ name: '⏳ Submitted', value: `<t:${Math.floor(new Date(request.submittedAt ?? request.createdAt).getTime() / 1000)}:R>`, inline: true },
			)
			.setFooter({ text: `Request ID: ${request._id}` })
			.setTimestamp();
	}

	reviewRow(requestId: string): ActionRowBuilder<ButtonBuilder> {
		return new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder().setCustomId(`vcverify_claim_${requestId}`).setLabel('Claim & verify').setEmoji('🎙️').setStyle(ButtonStyle.Primary),
		);
	}

	async log(guild: Guild, _settings: VerificationSettings, embed: EmbedBuilder): Promise<void> {
		// Best-effort log to log channel if configured elsewhere; no-op here.
	}

	async dm(guild: Guild, userId: string, content: string): Promise<void> {
		try { await guild.client.users.fetch(userId).then((u) => u.send({ content }).catch(() => {})); } catch {}
	}
}

export const verification = new VerificationSystem();

export const guildMemberAddVerification = {
	name: 'guildMemberAdd' as const,
	execute: async (_client: any, member: GuildMember) => {
		try { await verification.handleMemberAdd(member).catch(() => {}); } catch {}
	},
};

export const interactionCreateVerification = {
	name: 'interactionCreate' as const,
	execute: async (_client: any, interaction: any) => {
		if (!interaction.isButton() && !interaction.isModalSubmit()) return;
		if (interaction.isButton() && interaction.customId === 'verification_agree') {
			try { await verification.handleVerifyButton(interaction).catch(() => {}); } catch {}
		}
		if (interaction.isButton() && interaction.customId.startsWith('vcverify_claim_')) {
			const requestId = interaction.customId.replace('vcverify_claim_', '');
			try { await verification.handleApprove(interaction, requestId).catch(() => {}); } catch {}
		}
		if (interaction.isButton() && interaction.customId.startsWith('vcverify_approve_')) {
			const requestId = interaction.customId.replace('vcverify_approve_', '');
			try { await verification.handleApprove(interaction, requestId).catch(() => {}); } catch {}
		}
		if (interaction.isButton() && interaction.customId.startsWith('vcverify_deny_')) {
			const requestId = interaction.customId.replace('vcverify_deny_', '');
			try { await verification.handleDenyButton(interaction, requestId).catch(() => {}); } catch {}
		}
		if (interaction.isModalSubmit() && interaction.customId.startsWith('verification_deny_reason_')) {
			const requestId = interaction.customId.replace('verification_deny_reason_', '');
			try { await verification.handleDenyModal(interaction, requestId).catch(() => {}); } catch {}
		}
	},
};
