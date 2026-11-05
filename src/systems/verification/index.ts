import type { Guild, GuildMember, User, Role, TextChannel, ButtonInteraction, ModalSubmitInteraction } from 'discord.js';
import { Events } from 'discord.js';
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
import { Helpers } from '../../utils/shared-helpers.js';

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
	if (Array.isArray(raw)) return raw.filter((id): id is string => typeof id === 'string');
	return [];
}

export class VerificationSystem {
	async getSettings(guildId: string): Promise<VerificationSettings> {
		let row = await VerificationConfig.findOne({ guildId }).lean();
		if (!row) {
			row = await VerificationConfig.create({ guildId });
		}
		return {
			enabled: row.enabled === true,
			unverifiedRoleId: row.unverifiedRoleId ?? null,
			verifiedRoleId: row.verifiedRoleId ?? null,
			rulesChannelId: row.rulesChannelId ?? null,
			panelMessageId: row.panelMessageId ?? null,
			autoRoleIds: Array.isArray(row.autoRoleIds) ? row.autoRoleIds : parseRoleIds(row.autoRoleIds ?? null),
			requireApproval: row.requireApproval === true,
			logChannelId: row.logChannelId ?? null,
			minAccountAgeDays: row.minAccountAgeDays ?? 0,
			voiceChannelId: row.voiceChannelId ?? null,
			staffRoleId: row.staffRoleId ?? null,
		};
	}

	setSettings(guildId: string, data: Partial<VerificationSettings>): Promise<any> {
		return VerificationConfig.findOneAndUpdate({ guildId }, data, { upsert: true, new: true, setDefaultsOnInsert: true });
	}

	setPanelMessage(guildId: string, messageId: string | null): Promise<any> {
		return VerificationConfig.findOneAndUpdate(
			{ guildId },
			{ panelMessageId: messageId },
			{ upsert: true, new: true, setDefaultsOnInsert: true },
		);
	}

	addAutoRole(guildId: string, roleId: string): Promise<boolean> {
		return this._modifyAutoRole(guildId, roleId, true);
	}

	removeAutoRole(guildId: string, roleId: string): Promise<boolean> {
		return this._modifyAutoRole(guildId, roleId, false);
	}

	private async _modifyAutoRole(guildId: string, roleId: string, add: boolean): Promise<boolean> {
		const settings = await this.getSettings(guildId);
		if (add) {
			if (settings.autoRoleIds.includes(roleId)) return false;
			await this.setSettings(guildId, { autoRoleIds: [...new Set([...settings.autoRoleIds, roleId])] });
			return true;
		}
		if (!settings.autoRoleIds.includes(roleId)) return false;
		await this.setSettings(guildId, { autoRoleIds: settings.autoRoleIds.filter((id) => id !== roleId) });
		return true;
	}

	isConfigured(guildId: string): Promise<boolean> {
		return this.getSettings(guildId).then((s) => !!s.unverifiedRoleId);
	}

	isVerified(member: GuildMember, settings?: VerificationSettings): boolean {
		const s = settings ?? {
			enabled: false, unverifiedRoleId: null, verifiedRoleId: null,
			rulesChannelId: null, panelMessageId: null, autoRoleIds: [],
			requireApproval: false, logChannelId: null, minAccountAgeDays: 0,
			voiceChannelId: null, staffRoleId: null,
		};
		if (s.verifiedRoleId && member.roles.cache.has(s.verifiedRoleId)) return true;
		if (!s.unverifiedRoleId) return true;
		return !member.roles.cache.has(s.unverifiedRoleId);
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

		if (toAdd.length) await member.roles.add(toAdd, 'Automatic newbie roles').catch(() => {});

		const unverifiedRole = member.guild.roles.cache.get(settings.unverifiedRoleId);
		if (unverifiedRole?.editable && !member.roles.cache.has(unverifiedRole.id)) {
			await member.roles.add(unverifiedRole, 'Awaiting newbie verification').catch(() => {});
			result.unverifiedGranted = true;
		}
		return result;
	}

	missingAutoRoles(member: GuildMember): Promise<string[]> {
		return this.getSettings(member.guild.id).then((s) =>
			s.autoRoleIds.filter(
				(roleId) => roleId !== s.unverifiedRoleId && roleId !== s.verifiedRoleId && !member.roles.cache.has(roleId),
			),
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
		const autoText = settings.autoRoleIds
			.map((id) => {
				const role = guild.roles.cache.get(id);
				return role ? `<@&${role.id}>` : id;
			})
			.join(', ') || '_none yet_';
		const unverified = settings.unverifiedRoleId
			? (guild.roles.cache.has(settings.unverifiedRoleId) ? `<@&${settings.unverifiedRoleId}>` : 'unverified role')
			: null;
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
				name: '🎁 Roles you already received',
				value: autoText,
				inline: false,
			})
			.addFields({
				name: '⚠️ By verifying you agree to',
				value: 'Follow the server rules, stay respectful, and no spam or NSFW content.',
				inline: false,
			});

		return embed.setFooter({ text: `Verification • ${guild.name}` }).setTimestamp();
	}

	buildPanelRow(guild: Guild, settings: VerificationSettings): ActionRowBuilder<ButtonBuilder> {
		const buttons: ButtonBuilder[] = [
			new ButtonBuilder()
				.setCustomId('verification_agree')
				.setLabel('Verify me')
				.setEmoji('✅')
				.setStyle(ButtonStyle.Success),
		];
		if (settings.rulesChannelId) {
			buttons.push(
				new ButtonBuilder()
					.setLabel('Read the rules')
					.setEmoji('📜')
					.setStyle(ButtonStyle.Link)
					.setURL(`https://discord.com/channels/${guild.id}/${settings.rulesChannelId}`),
			);
		}
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
			await interaction.editReply({ embeds: [this._errorEmbed('Verification disabled', 'Verification is currently disabled. Ask a staff member for help.')] });
			return;
		}
		if (!settings.unverifiedRoleId) {
			await interaction.editReply({ embeds: [this._errorEmbed('Not configured', 'No unverified role is set. Ask an admin to run `/verify setup`.')] });
			return;
		}
		if (this.isVerified(member, settings)) {
			await interaction.editReply({ embeds: [this._successEmbed('Already verified', 'You already have full access to the server.')] });
			return;
		}

		const ageBlock = this.accountAgeBlock(member, settings);
		if (ageBlock) {
			await interaction.editReply({ embeds: [this._errorEmbed('Account too new', ageBlock)] });
			return;
		}

		const retry = this.manageableRoles(member, await this.missingAutoRoles(member));
		if (retry.length) await member.roles.add(retry, 'Automatic newbie roles').catch(() => {});

		const stillMissing = await this.missingAutoRoles(member);
		if (stillMissing.length) {
			await interaction.editReply({
				embeds: [this._errorEmbed('Missing required roles', 'You are still missing some required roles. Please contact a staff member.')],
			});
			return;
		}

		const live = await VerificationRequest.findOne({
			guildId: guild.id, userId: member.id, status: 'pending',
		}) || await VerificationRequest.findOne({ guildId: guild.id, userId: member.id, status: 'claimed' });
		if (live) {
			await interaction.editReply({
				embeds: [this._infoEmbed(
					'Already requested',
					live.status === 'claimed'
						? 'A staff member is already verifying you — join the voice call they invite you to.'
						: `Your request is already waiting for staff review (#${live.id}).`,
				)],
			});
			return;
		}

		const request = await VerificationRequest.create({
			guildId: guild.id, userId: member.id, status: 'pending',
		});
		await this.sendToStaff(guild, settings, member, request);
		await this.dm(guild, member.id,
			`⏳ Your verification request was sent to the staff team.\n\nWhen a staff member is available they will invite you to a private voice call to verify you. Please keep your DMs open so you receive the invite.`);
		await interaction.editReply({
			embeds: [this._infoEmbed('Request sent', 'A staff member will invite you to a short private voice call to complete verification.')],
		});
	}

	async approveMember(member: GuildMember, settings: VerificationSettings): Promise<void> {
		const add: string[] = [];
		const remove: string[] = [];
		if (settings.unverifiedRoleId && member.roles.cache.has(settings.unverifiedRoleId)) remove.push(settings.unverifiedRoleId);
		if (settings.verifiedRoleId) {
			const role = member.guild.roles.cache.get(settings.verifiedRoleId);
			if (role?.editable && !member.roles.cache.has(role.id)) add.push(role.id);
		}
		if (remove.length) await member.roles.remove(remove, 'Verification completed').catch(() => {});
		if (add.length) await member.roles.add(add, 'Verification completed').catch(() => {});
	}

	async handleApprove(interaction: ButtonInteraction, requestId: number): Promise<void> {
		const request = await VerificationRequest.findById(String(requestId));
		if (!request || request.status !== 'pending') {
			await interaction.reply({ content: '❌ This request is no longer pending.', flags: 64 });
			return;
		}
		await interaction.deferReply({ flags: 64 });
		const guild = interaction.guild as Guild;
		const settings = await this.getSettings(guild.id);
		const member = await guild.members.fetch(request.userId).catch(() => null);
		if (member) await this.approveMember(member, settings);

		request.status = 'approved';
		request.reviewedBy = interaction.user.id;
		request.reviewedAt = new Date();
		await request.save();

		await this.log(guild, settings, this._successEmbed('Verification approved', `<@${request.userId}> was approved by ${interaction.user}.`));
		await interaction.editReply({ embeds: [this._successEmbed('Approved', member ? `<@${request.userId}> has been verified.` : 'Approved, but member is not in the server.')] });
		await this._retireMessage(interaction, request.id, `Approved by ${interaction.user}`);
	}

	async handleDenyButton(interaction: ButtonInteraction, requestId: number): Promise<void> {
		const request = await VerificationRequest.findById(String(requestId));
		if (!request || request.status !== 'pending') {
			await interaction.reply({ content: '❌ This request is no longer pending.', flags: 64 });
			return;
		}
		await interaction.showModal(this._denyModal(request.id));
	}

	async handleDenyModal(interaction: ModalSubmitInteraction, requestId: number): Promise<void> {
		await interaction.deferReply({ flags: 64 });
		const request = await VerificationRequest.findById(String(requestId));
		if (!request || request.status !== 'pending') {
			await interaction.editReply({ content: '❌ This request is no longer pending.' });
			return;
		}
		const reason = interaction.fields.getTextInputValue('deny_reason');
		const guild = interaction.guild as Guild;
		const settings = await this.getSettings(guild.id);

		request.status = 'denied';
		request.reviewedBy = interaction.user.id;
		request.reviewedAt = new Date();
		request.reason = reason;
		await request.save();

		await this.dm(guild, request.userId, `❌ Your verification was denied.\n**Reason:** ${reason}`);
		await this.log(guild, settings, this._errorEmbed('Verification denied', `<@${request.userId}> was denied by ${interaction.user}.\n**Reason:** ${Helpers.truncate(reason, 500)}`));
		await interaction.editReply({ content: '✅ Request denied.' });
		await this._retireMessage(interaction, request.id, `Denied by ${interaction.user}\n**Reason:** ${reason}`);
	}

	async reviewUser(member: GuildMember, action: 'approve' | 'deny', reviewerId: string, reason?: string | null): Promise<void> {
		const guild = member.guild as Guild;
		const settings = await this.getSettings(guild.id);
		if (action === 'approve') {
			await this.approveMember(member, settings);
			await this.dm(guild, member.id, `🎉 Welcome to **${guild.name}**! Your verification was approved.`);
			await this.log(guild, settings, this._successEmbed('Verification approved', `<@${member.id}> was approved by <@${reviewerId}>.`));
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
		await this.dm(guild, member.id, `❌ Your verification was denied.\n**Reason:** ${reason || 'No reason given'}`);
		await this.log(guild, settings, this._errorEmbed('Verification denied', `<@${member.id}> was denied by <@${reviewerId}>.\n**Reason:** ${reason || 'No reason given'}`));
	}

	async resetMember(member: GuildMember, actorId: string): Promise<void> {
		const guild = member.guild as Guild;
		const settings = await this.getSettings(guild.id);
		await VerificationRequest.updateMany(
			{ guildId: guild.id, userId: member.id, status: 'pending' },
			{ status: 'revoked', reviewedAt: new Date() },
		);
		const remove: string[] = [];
		const add: string[] = [];
		if (settings.verifiedRoleId && member.roles.cache.has(settings.verifiedRoleId)) remove.push(settings.verifiedRoleId);
		if (settings.unverifiedRoleId) {
			const role = guild.roles.cache.get(settings.unverifiedRoleId);
			if (role?.editable && !member.roles.cache.has(role.id)) add.push(role.id);
		}
		if (remove.length) await member.roles.remove(remove, 'Verification reset').catch(() => {});
		if (add.length) await member.roles.add(add, 'Verification reset').catch(() => {});
		await this.dm(guild, member.id, '🔄 Your verification was reset by the staff team. Please verify again using the panel.');
		await this.log(guild, settings, this._warningEmbed('Verification reset', `<@${member.id}> was reset by <@${actorId}> and is unverified again.`));
	}

	pendingRequests(guildId: string, limit = 25): Promise<any[]> {
		return VerificationRequest.find({ guildId, status: 'pending' }).sort({ createdAt: -1 }).limit(limit).lean();
	}

	pendingCount(guildId: string): Promise<number> {
		return VerificationRequest.countDocuments({ guildId, status: 'pending' });
	}

	reviewEmbed(request: any, member: GuildMember | null, settings?: VerificationSettings): EmbedBuilder {
		return new EmbedBuilder()
			.setColor(Colors.Orange)
			.setTitle('🎙️ Newbie verification request')
			.setDescription(
				`<@${request.userId}> is waiting to be verified.\n\nPress **Claim & verify** to take this request.` +
				(settings?.voiceChannelId ? '' : '\n\n⚠️ No verification voice channel is configured — run `/verify vc`.'),
			)
			.addFields(
				{ name: '👤 Member', value: member ? `<@${member.id}>\n${member.user.username}` : `<@${request.userId}>`, inline: true },
				{
					name: '📅 Account created',
					value: member ? `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>` : 'Member left the server',
					inline: true,
				},
				{ name: '⏳ Submitted', value: `<t:${Math.floor(new Date(request.submittedAt).getTime() / 1000)}:R>`, inline: true },
			)
			.setFooter({ text: `Request ID: ${request.id}` })
			.setTimestamp();
	}

	reviewRow(requestId: number): ActionRowBuilder<ButtonBuilder> {
		return new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder()
				.setCustomId(`vcverify_claim_${requestId}`)
				.setLabel('Claim & verify')
				.setEmoji('🎙️')
				.setStyle(ButtonStyle.Primary),
		);
	}

	private async sendToStaff(guild: Guild, settings: VerificationSettings, member: GuildMember, request: any): Promise<void> {
		const channelId = settings.logChannelId || settings.rulesChannelId;
		if (!channelId) return;
		const channel = guild.channels.cache.get(channelId);
		if (!channel?.isTextBased() || channel.isThread()) return;
		const staffRoleId = settings.staffRoleId;
		await channel.send({
			content: staffRoleId ? `<@&${staffRoleId}>` : undefined,
			allowedMentions: staffRoleId ? { roles: [staffRoleId] } : { parse: [] },
			embeds: [this.reviewEmbed(request, member, settings)],
			components: [this.reviewRow(request.id)],
		}).catch((error) => console.error('[Verification] Failed to send staff request:', error));
	}

	private async _retireMessage(interaction: ButtonInteraction | ModalSubmitInteraction, requestId: string | number, result: string): Promise<void> {
		if (!interaction.message) return;
		await interaction.message.edit({
			content: null,
			embeds: [this._infoEmbed(`Request #${requestId}`, result)],
			components: [],
		}).catch(() => {});
	}

	async log(guild: Guild, settings: VerificationSettings, embed: EmbedBuilder): Promise<void> {
		if (!settings.logChannelId) return;
		const channel = guild.channels.cache.get(settings.logChannelId);
		if (!channel?.isTextBased() || channel.isThread()) return;
		await channel.send({ embeds: [embed] }).catch(() => {});
	}

	async dm(guild: Guild, userId: string, content: string): Promise<void> {
		try {
			const user = await guild.client.users.fetch(userId);
			await user.send({ content }).catch(() => {});
		} catch {}
	}

	private _errorEmbed(title: string, description: string): EmbedBuilder {
		return new EmbedBuilder().setColor(Colors.Red).setTitle(`❌ ${title}`).setDescription(description).setTimestamp();
	}
	private _successEmbed(title: string, description: string): EmbedBuilder {
		return new EmbedBuilder().setColor(Colors.Green).setTitle(`✅ ${title}`).setDescription(description).setTimestamp();
	}
	private _warningEmbed(title: string, description: string): EmbedBuilder {
		return new EmbedBuilder().setColor(Colors.Yellow).setTitle(`⚠️ ${title}`).setDescription(description).setTimestamp();
	}
	private _infoEmbed(title: string, description: string): EmbedBuilder {
		return new EmbedBuilder().setColor(Colors.Blue).setTitle(`ℹ️ ${title}`).setDescription(description).setTimestamp();
	}
	private _denyModal(requestId: string | number): ModalBuilder {
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
}

export const verification = new VerificationSystem();

export const verifyMemberAdd = {
	name: Events.GuildMemberAdd as keyof import('discord.js').ClientEvents,
	execute: async (_client: any, member: any) => {
		try {
			await verification.handleMemberAdd(member).catch(() => {});
		} catch {}
	},
};
