import type { Guild, GuildMember, VoiceChannel, TextChannel } from 'discord.js';
import { Events } from 'discord.js';
import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	EmbedBuilder,
	ModalBuilder,
	PermissionFlagsBits,
	TextInputBuilder,
	TextInputStyle,
	ChannelType,
} from 'discord.js';
import { VerificationRequest } from '../../db/models/Verification.js';
import { verification, VerificationSettings } from './index.js';
import EmbedBuilderUtil from '../../utils/shared-embeds.js';

const DM_TIMEOUT_MS = 10 * 60_000;

export class VcVerificationSystem {
	private timers = new Map<string | number, NodeJS.Timeout>();
	/** requestId -> voice channel id of the temp VC created for that verification. */
	private tempVcs = new Map<string | number, string>();

	private _hasVerificationStaff(member: GuildMember, settings: VerificationSettings): boolean {
		if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
		if (member.permissions.has(PermissionFlagsBits.ManageGuild)) return true;
		if (member.permissions.has(PermissionFlagsBits.ManageMessages)) return true;
		if (settings.staffRoleId && member.roles.cache.has(settings.staffRoleId)) return true;
		return false;
	}

	async handleClaim(interaction: any, requestId: string | number): Promise<void> {
		const request = await VerificationRequest.findById(requestId as any);
		if (!request || request.status !== 'pending') {
			await interaction.reply({ content: '❌ This request is no longer waiting.', flags: 64 });
			return;
		}
		const guild = interaction.guild as Guild;
		const claimant = interaction.member as GuildMember;
		const settings = await verification.getSettings(guild.id);
		if (!this._hasVerificationStaff(claimant, settings)) {
			await interaction.reply({ content: '❌ Only staff can claim a verification.', flags: 64 });
			return;
		}
		const existing = await VerificationRequest.findOne({
			guildId: guild.id, claimedBy: claimant.id, status: 'claimed',
		});
		if (existing) {
			await interaction.reply({
				content: `❌ You are already verifying <@${existing.userId}>. Finish that one first.`,
				flags: 64,
			});
			return;
		}

		// Create a temporary voice channel for this verification.
		let vc: VoiceChannel | null = null;
		try {
			const category = settings.voiceChannelId
				? (guild.channels.cache.get(settings.voiceChannelId) as any)
				: null;
			vc = (await guild.channels.create({
				name: `verify-${request.userId.slice(-6)}`,
				type: ChannelType.GuildVoice,
				parent: category?.id ?? undefined,
				permissionOverwrites: [
					{ id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
					{ id: claimant.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak] },
					{ id: request.userId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak] },
					{ id: guild.members.me!.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak] },
				],
			})) as VoiceChannel;
			this.tempVcs.set(request.id, vc.id);
		} catch (err) {
			console.error('[Verification] Failed to create temp VC:', err);
			await interaction.reply({ content: '❌ Failed to create verification voice channel.', flags: 64 });
			return;
		}

		request.status = 'claimed';
		request.claimedBy = claimant.id;
		request.claimedAt = new Date();
		await request.save();

		const vcLink = `https://discord.com/channels/${guild.id}/${vc!.id}`;
		await interaction.reply({
			embeds: [
				EmbedBuilderUtil.info(
					'Verification claimed',
					`You are now verifying <@${request.userId}>.\n\n`
					+ `1. Join **<#${vc!.id}>** — the moment you do, they are DM'd the channel and can join you.\n`
					+ '2. Talk to them and confirm they agree to the rules.\n'
					+ '3. Press **Approve** or **Deny** below (only you can see this message).',
				),
			],
			components: [this.decisionRow(request.id)],
			flags: 64,
		});

		this.armTimeout(guild, request, claimant);
		await this._retireRequestMessage(interaction, request.id, `Claimed by ${claimant.user.tag}`);
		await verification.log(guild, settings, EmbedBuilderUtil.info(
			'Verification claimed',
			`<@${claimant.id}> claimed <@${request.userId}> for voice verification (temp VC: <#${vc!.id}>).`,
		));
	}

	private decisionRow(requestId: string | number): ActionRowBuilder<ButtonBuilder> {
		return new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder()
				.setCustomId(`vcverify_approve_${requestId}`)
				.setLabel('Approve')
				.setEmoji('✅')
				.setStyle(ButtonStyle.Success),
			new ButtonBuilder()
				.setCustomId(`vcverify_deny_${requestId}`)
				.setLabel('Deny')
				.setEmoji('❌')
				.setStyle(ButtonStyle.Danger),
		);
	}

	private armTimeout(guild: Guild, request: any, staff: GuildMember): void {
		const existing = this.timers.get(request.id);
		if (existing) clearTimeout(existing);
		const timer = setTimeout(async () => {
			this.timers.delete(request.id);
			const stillClaimed = await VerificationRequest.findById(request.id as any);
			if (!stillClaimed || stillClaimed.status !== 'claimed') return;
			stillClaimed.status = 'pending';
			stillClaimed.claimedBy = undefined;
			stillClaimed.claimedAt = undefined;
			await stillClaimed.save();
			await this.deleteTempVc(guild, request.id);
			await verification.dm(guild, request.userId, '⏳ Your verification was put back in the queue — please wait for a staff member to reach you.');
			const settings = await verification.getSettings(guild.id);
			await verification.log(guild, settings, EmbedBuilderUtil.warning(
				'Verification timed out',
				`<@${staff.id}> did not decide within ${DM_TIMEOUT_MS / 60_000} minutes; <@${request.userId}> was returned to the queue.`,
			));
		}, DM_TIMEOUT_MS);
		timer.unref?.();
		this.timers.set(request.id, timer);
	}

	async handleVoiceJoin(member: GuildMember): Promise<void> {
		const guild = member.guild;
		const settings = await verification.getSettings(guild.id);
		if (!this._hasVerificationStaff(member, settings)) return;

		// Find the request claimed by this staff member.
		const request = await VerificationRequest.findOne({
			guildId: guild.id, claimedBy: member.id, status: 'claimed',
		});
		if (!request) return;
		if (request.vcInvitedAt) return;

		const vcId = this.tempVcs.get(request.id);
		if (!vcId || member.voice.channelId !== vcId) return;

		request.vcInvitedAt = new Date();
		await request.save();

		const link = `https://discord.com/channels/${guild.id}/${vcId}`;
		await verification.dm(guild, request.userId,
			`🎙️ **A staff member is ready to verify you.**\n\nJoin this private voice channel:\n${link}\n\nThey will confirm you agree to the rules. This DM is only visible to you.`);
		await verification.log(guild, settings, EmbedBuilderUtil.info(
			'Newbie invited to VC',
			`<@${member.id}> joined the verification VC, so <@${request.userId}> was DM'd an invite.`,
		));
	}

	async handleVoiceLeave(member: GuildMember): Promise<void> {
		const guild = member.guild;
		const settings = await verification.getSettings(guild.id);
		if (!this._hasVerificationStaff(member, settings)) return;

		// Check if this staff member left a temp VC they claimed.
		const request = await VerificationRequest.findOne({
			guildId: guild.id, claimedBy: member.id, status: 'claimed',
		});
		if (!request) return;

		const vcId = this.tempVcs.get(request.id);
		if (vcId && member.voice.channelId !== vcId) return;

		// Staff left the verification VC — release the claim back to the queue and delete the temp VC.
		request.status = 'pending';
		request.claimedBy = undefined;
		request.claimedAt = undefined;
		await request.save();
		const timer = this.timers.get(request.id);
		if (timer) { clearTimeout(timer); this.timers.delete(request.id); }
		await this.deleteTempVc(guild, request.id);
		await verification.dm(guild, request.userId, '⏳ Your verification was put back in the queue — a staff member will reach you again shortly.');
	}

	async handleApprove(interaction: any, requestId: string | number): Promise<void> {
		const request = await VerificationRequest.findById(requestId as any);
		if (!request || request.status !== 'claimed') {
			await interaction.reply({ content: '❌ This verification is no longer active.', flags: 64 });
			return;
		}
		const guild = interaction.guild as Guild;
		const settings = await verification.getSettings(guild.id);
		if (request.claimedBy !== interaction.user.id) {
			await interaction.reply({ content: '❌ Only the staff member who claimed this can decide.', flags: 64 });
			return;
		}
		await interaction.deferReply({ flags: 64 });
		const member = await guild.members.fetch(request.userId).catch(() => null);
		if (member) await verification.approveMember(member, settings);
		request.status = 'approved';
		request.reviewedBy = interaction.user.id;
		request.reviewedAt = new Date();
		await request.save();
		this.clearTimer(requestId);
		await this.deleteTempVc(guild, requestId);
		await verification.dm(guild, request.userId,
			member
				? `🎉 Welcome to **${guild.name}**! Your voice verification was approved — you now have full access to the server.`
				: `🎉 Your voice verification was approved.`);
		await verification.log(guild, settings, EmbedBuilderUtil.success(
			'Verification approved',
			`<@${request.userId}> was verified by <@${interaction.user.id}> over voice.` +
			(member ? '' : '\n⚠️ The member had left the server, so no roles were changed.'),
		));
		await interaction.editReply({ embeds: [EmbedBuilderUtil.success('Approved', `<@${request.userId}> is verified and the VC has been cleared.`)] });
	}

	async handleDeny(interaction: any, requestId: string | number): Promise<void> {
		const request = await VerificationRequest.findById(requestId as any);
		if (!request || request.status !== 'claimed') {
			await interaction.reply({ content: '❌ This verification is no longer active.', flags: 64 });
			return;
		}
		if (request.claimedBy !== interaction.user.id) {
			await interaction.reply({ content: '❌ Only the staff member who claimed this can decide.', flags: 64 });
			return;
		}
		const modal = new ModalBuilder()
			.setCustomId(`vcverify_deny_reason_${requestId}`)
			.setTitle('Deny verification — reason')
			.addComponents(
				new ActionRowBuilder<TextInputBuilder>().addComponents(
					new TextInputBuilder()
						.setCustomId('deny_reason')
						.setLabel('Reason (sent to the member in a DM)')
						.setStyle(TextInputStyle.Paragraph)
						.setRequired(true)
						.setMaxLength(1000),
				),
			);
		await interaction.showModal(modal);
	}

	async handleDenyModal(interaction: any, requestId: string | number): Promise<void> {
		await interaction.deferReply({ flags: 64 });
		const request = await VerificationRequest.findById(requestId as any);
		if (!request || request.status !== 'claimed') {
			await interaction.editReply({ content: '❌ This verification is no longer active.' });
			return;
		}
		const reason = interaction.fields.getTextInputValue('deny_reason');
		const guild = interaction.guild as Guild;
		const settings = await verification.getSettings(guild.id);

		request.status = 'denied';
		request.reviewedBy = interaction.user.id;
		request.reviewedAt = new Date();
		request.reason = reason;
		await request.save();
		this.clearTimer(requestId);
		await this.deleteTempVc(guild, requestId);
		await verification.dm(guild, request.userId,
			`❌ **Your verification was not approved.**\n\n**Reason given:** ${reason}\n\nIf you think this is a mistake, reply to a staff member.`);
		await verification.log(guild, settings, EmbedBuilderUtil.error(
			'Verification denied',
			`<@${request.userId}> was denied by <@${interaction.user.id}> over voice.\n**Reason:** ${reason.slice(0, 500)}`,
		));
		await interaction.editReply({ embeds: [EmbedBuilderUtil.error('Denied', 'The VC has been cleared and the member was DM\'d your reason.')] });
	}

	private clearTimer(requestId: string | number): void {
		const timer = this.timers.get(requestId);
		if (timer) { clearTimeout(timer); this.timers.delete(requestId); }
	}

	/** Delete the temp VC for a verification request, if one exists. */
	private async deleteTempVc(guild: Guild, requestId: string | number): Promise<void> {
		const vcId = this.tempVcs.get(requestId);
		if (!vcId) return;
		this.tempVcs.delete(requestId);
		try {
			const vc = await guild.channels.fetch(vcId).catch(() => null) as VoiceChannel | null;
			await vc?.delete('Voice verification finished').catch(() => {});
		} catch {}
	}

	/** Delete a temp VC given its channel id and guild. Only touches verification temp VCs. */
	async deleteTempVcByChannel(guild: Guild, channelId: string): Promise<void> {
		const requestId = [...this.tempVcs.entries()].find(([, id]) => id === channelId)?.[0];
		if (requestId === undefined) return; // not a verification temp VC — leave it alone
		this.tempVcs.delete(requestId);
		const request = await VerificationRequest.findById(requestId as any);
		if (request && request.status === 'claimed') {
			request.status = 'pending';
			request.claimedBy = undefined;
			request.claimedAt = undefined;
			await request.save();
		}
		try {
			const vc = await guild.channels.fetch(channelId).catch(() => null) as VoiceChannel | null;
			await vc?.delete('Voice verification finished').catch(() => {});
		} catch {}
	}

	private async _retireRequestMessage(interaction: any, requestId: string | number, result: string): Promise<void> {
		if (!interaction.message) return;
		await interaction.message.edit({
			embeds: [EmbedBuilderUtil.info(`Request #${requestId}`, result)],
			components: [],
		}).catch(() => {});
	}

	shutdown(): void {
		for (const timer of this.timers.values()) clearTimeout(timer);
		this.timers.clear();
		this.tempVcs.clear();
	}

	/** Called from voiceStateUpdate when a temp VC becomes empty — deletes it. */
	async handleEmptyTempVc(guild: Guild, channelId: string): Promise<void> {
		await this.deleteTempVcByChannel(guild, channelId);
	}
}

export const vcVerification = new VcVerificationSystem();

export const verificationVoiceStateEvent = {
	name: Events.VoiceStateUpdate as keyof import('discord.js').ClientEvents,
	execute: async (_client: any, oldState: any, newState: any) => {
		try {
			if (!oldState.channelId && newState.channelId && newState.member) {
				await vcVerification.handleVoiceJoin(newState.member).catch(() => {});
			}
			else if (oldState.channelId && !newState.channelId && newState.member) {
				await vcVerification.handleVoiceLeave(newState.member).catch(() => {});
				if (oldState.channelId) {
					await vcVerification.handleEmptyTempVc(oldState.guild, oldState.channelId).catch(() => {});
				}
			}
			else if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId && newState.member) {
				await vcVerification.handleEmptyTempVc(oldState.guild, oldState.channelId).catch(() => {});
			}
		} catch {}
	},
};
