import type { Guild, GuildMember, VoiceChannel } from 'discord.js';
import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ModalBuilder,
	PermissionFlagsBits,
	TextInputBuilder,
	TextInputStyle,
} from 'discord.js';
import { verification } from './index.js';
import EmbedBuilderUtil from '../../utils/shared-embeds.js';
import { VerificationRequest } from '../../db/models/Verification.js';
import { EmbedBuilder } from 'discord.js';

/**
 * Voice verification (ported from astralcraft).
 * A human meets the newbie in a voice call; staff approve/deny after.
 */
const DM_TIMEOUT_MS = 10 * 60_000;

export class VcVerificationSystem {
	private timers = new Map<string, NodeJS.Timeout>();

	private hasVerificationStaff(member: GuildMember): boolean {
		if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
		if (member.permissions.has(PermissionFlagsBits.ManageGuild)) return true;
		if (member.permissions.has(PermissionFlagsBits.ManageMessages)) return true;
		return false;
	}

	async handleClaim(interaction: any, requestId: string): Promise<void> {
		const request = await verification['pendingRequests'](interaction.guild.id).then((rows: any[]) => rows.find((r: any) => r._id.toString() === requestId));
		if (!request || request.status !== 'pending') {
			await interaction.reply({ content: '❌ This request is no longer waiting.', flags: 64 });
			return;
		}
		const guild = interaction.guild as Guild;
		const claimant = interaction.member as GuildMember;
		if (!this.hasVerificationStaff(claimant)) {
			await interaction.reply({ content: '❌ Only staff can claim a verification.', flags: 64 });
			return;
		}

		await VerificationRequest.updateOne(
			{ _id: request._id, status: 'pending' },
			{ status: 'claimed', claimedBy: claimant.id, claimedAt: new Date() },
		);
		// Refresh the in-memory copy for downstream embedding.
		const claimedDoc = await VerificationRequest.findById(request._id).lean();
		if (claimedDoc) Object.assign(request, claimedDoc);

		await interaction.reply({
			embeds: [EmbedBuilderUtil.info?.('Verification claimed', `You are now verifying <@${request.userId}>.\nJoin the verification VC and talk to them, then press Approve or Deny.`) ?? new EmbedBuilder().setColor(0x5865F2).setTitle('Verification claimed').setDescription(`You are now verifying <@${request.userId}>.`)],
			components: [this.decisionRow(requestId)],
			flags: 64,
		});

		this.armTimeout(guild, request, claimant);
	}

	private decisionRow(requestId: string): ActionRowBuilder<ButtonBuilder> {
		return new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder().setCustomId(`vcverify_approve_${requestId}`).setLabel('Approve').setEmoji('✅').setStyle(ButtonStyle.Success),
			new ButtonBuilder().setCustomId(`vcverify_deny_${requestId}`).setLabel('Deny').setEmoji('❌').setStyle(ButtonStyle.Danger),
		);
	}

	private armTimeout(guild: Guild, request: any, _staff: GuildMember): void {
		const existing = this.timers.get(request._id.toString());
		if (existing) clearTimeout(existing);
		const timer = setTimeout(async () => {
			this.timers.delete(request._id.toString());
			try {
				const fresh = await verification['pendingRequests'](guild.id).then((rows: any[]) => rows.find((r: any) => r._id.toString() === request._id.toString()));
				if (!fresh || fresh.status !== 'claimed') return;
				await VerificationRequest.updateOne(
					{ _id: fresh._id, status: 'claimed' },
					{ status: 'pending', claimedBy: null, claimedAt: null },
				);
				try { await guild.client.users.fetch(request.userId).then((u) => u.send('⏳ Your verification was put back in the queue.').catch(() => {})); } catch {}
			} catch {}
		}, DM_TIMEOUT_MS);
		timer.unref?.();
		this.timers.set(request._id.toString(), timer);
	}

	async handleVoiceJoin(member: GuildMember): Promise<void> {
		const guild = member.guild;
		const settings = await verification.getSettings(guild.id);
		if (!settings.voiceChannelId || member.voice.channelId !== settings.voiceChannelId) return;
		if (!this.hasVerificationStaff(member)) return;

		const request = await verification['pendingRequests'](guild.id).then((rows: any[]) => rows.find((r: any) => r.claimedBy === member.id && r.status === 'claimed'));
		if (!request) return;
		if (request.vcInvitedAt) return;

		await VerificationRequest.updateOne(
			{ _id: request._id },
			{ vcInvitedAt: new Date() },
		);

		const vc = await guild.channels.fetch(settings.voiceChannelId).catch(() => null) as VoiceChannel | null;
		const link = vc ? `https://discord.com/channels/${guild.id}/${settings.voiceChannelId}` : `https://discord.com/channels/${guild.id}/${settings.voiceChannelId}`;
		try { await guild.client.users.fetch(request.userId).then((u) => u.send(`🎙️ A staff member is ready to verify you. Join: ${link}`).catch(() => {})); } catch {}
	}

	async handleVoiceLeave(member: GuildMember, previousChannelId?: string): Promise<void> {
		const guild = member.guild;
		const settings = await verification.getSettings(guild.id);
		// `member.voice.channelId` reflects the *new* state after a move, so
		// when called on leave it never equals the VC id. Use the previous
		// channel id when provided.
		const leftFrom = previousChannelId ?? member.voice.channelId;
		if (!settings.voiceChannelId || leftFrom !== settings.voiceChannelId) return;
		const request = await verification['pendingRequests'](guild.id).then((rows: any[]) => rows.find((r: any) => r.claimedBy === member.id && r.status === 'claimed'));
		if (request) {
			await VerificationRequest.updateOne(
				{ _id: request._id, status: 'claimed' },
				{ status: 'pending', claimedBy: null, claimedAt: null },
			);
			const timer = this.timers.get(request._id.toString());
			if (timer) { clearTimeout(timer); this.timers.delete(request._id.toString()); }
		}
	}

	async handleApprove(interaction: any, requestId: string): Promise<void> {
		const request = await verification['pendingRequests'](interaction.guild.id).then((rows: any[]) => rows.find((r: any) => r._id.toString() === requestId));
		if (!request || request.status !== 'claimed') {
			await interaction.reply({ content: '❌ This verification is no longer active.', flags: 64 });
			return;
		}
		if (request.claimedBy !== interaction.user.id) {
			await interaction.reply({ content: '❌ Only the staff member who claimed this can decide.', flags: 64 });
			return;
		}
		await interaction.deferReply({ flags: 64 });
		const guild = interaction.guild as Guild;
		const settings = await verification.getSettings(guild.id);
		const member = await guild.members.fetch(request.userId).catch(() => null);
		if (member) await verification.approveMember(member, settings);
		await VerificationRequest.updateOne(
			{ _id: request._id, status: 'claimed' },
			{ status: 'approved', reviewedBy: interaction.user.id, reviewedAt: new Date() },
		);
		const timer = this.timers.get(requestId);
		if (timer) { clearTimeout(timer); this.timers.delete(requestId); }
		try { await guild.client.users.fetch(request.userId).then((u) => u.send(member ? `🎉 Your voice verification was approved.` : '🎉 Your voice verification was approved.').catch(() => {})); } catch {}
		await interaction.editReply({ embeds: [EmbedBuilderUtil.success?.('Approved', '<@' + request.userId + '> is verified and the VC has been cleared.') ?? new EmbedBuilder().setColor(0x57F287).setTitle('Approved').setDescription('<@' + request.userId + '> is verified and the VC has been cleared.')] });
	}

	async handleDeny(interaction: any, requestId: string): Promise<void> {
		const request = await verification['pendingRequests'](interaction.guild.id).then((rows: any[]) => rows.find((r: any) => r._id.toString() === requestId));
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
			.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
				new TextInputBuilder().setCustomId('deny_reason').setLabel('Reason').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000),
			));
		await interaction.showModal(modal);
	}

	async handleDenyModal(interaction: any, requestId: string): Promise<void> {
		await interaction.deferReply({ flags: 64 });
		const request = await verification['pendingRequests'](interaction.guild.id).then((rows: any[]) => rows.find((r: any) => r._id.toString() === requestId));
		if (!request || request.status !== 'claimed') {
			await interaction.editReply({ content: '❌ This verification is no longer active.' });
			return;
		}
		const reason = interaction.fields.getTextInputValue('deny_reason');
		const guild = interaction.guild as Guild;
		await VerificationRequest.updateOne(
			{ _id: request._id, status: 'claimed' },
			{ status: 'denied', reviewedBy: interaction.user.id, reviewedAt: new Date(), reason },
		);
		const timer = this.timers.get(requestId);
		if (timer) { clearTimeout(timer); this.timers.delete(requestId); }
		try { await guild.client.users.fetch(request.userId).then((u: any) => u.send(`❌ Your verification was not approved.\n**Reason:** ${reason}`).catch(() => {})); } catch {}
		await interaction.editReply({ embeds: [EmbedBuilderUtil.error?.('Denied', 'The VC has been cleared.') ?? new EmbedBuilder().setColor(0xED4245).setTitle('Denied').setDescription('The VC has been cleared.')] });
	}

	private clearTimer(requestId: string): void {
		const timer = this.timers.get(requestId);
		if (timer) { clearTimeout(timer); this.timers.delete(requestId); }
	}

	async emptyVc(guild: Guild): Promise<void> {
		const settings = await verification.getSettings(guild.id);
		if (!settings.voiceChannelId) return;
		const vc = await guild.channels.fetch(settings.voiceChannelId).catch(() => null) as VoiceChannel | null;
		if (!vc) return;
		for (const m of vc.members.values()) await m.voice.disconnect('Voice verification finished').catch(() => {});
	}

	shutdown(): void {
		for (const timer of this.timers.values()) clearTimeout(timer);
		this.timers.clear();
	}
}

export const vcVerification = new VcVerificationSystem();

export const voiceStateUpdateVerification = {
	name: 'voiceStateUpdate' as const,
	execute: async (_client: any, oldState: any, newState: any) => {
		if (!newState.member || newState.member.user.bot) return;
		// Join is N=our channel, leave is not — based on channel IDs, not
		// `member.voice.channelId` (which reflects the *new* state after a move).
		const settings = await verification.getSettings(newState.guild?.id ?? oldState.guild?.id).catch(() => null);
		const vcId = settings?.voiceChannelId;
		if (!vcId) return;
		if (newState.channelId === vcId && oldState.channelId !== vcId) {
			try { await vcVerification.handleVoiceJoin(newState.member).catch(() => {}); } catch {}
		}
		if (oldState.channelId === vcId && newState.channelId !== vcId) {
			const member = newState.member ?? oldState.member;
			if (member) {
				try { await vcVerification.handleVoiceLeave(member, oldState.channelId).catch(() => {}); } catch {}
			}
		}
	},
};

export const interactionCreateVcVerification = {
	name: 'interactionCreate' as const,
	execute: async (_client: any, interaction: any) => {
		if (!interaction.isButton() && !interaction.isModalSubmit()) return;
		if (interaction.isButton() && interaction.customId.startsWith('vcverify_claim_')) {
			const requestId = interaction.customId.replace('vcverify_claim_', '');
			try { await vcVerification.handleClaim(interaction, requestId).catch(() => {}); } catch {}
		}
		if (interaction.isButton() && interaction.customId.startsWith('vcverify_approve_')) {
			const requestId = interaction.customId.replace('vcverify_approve_', '');
			try { await vcVerification.handleApprove(interaction, requestId).catch(() => {}); } catch {}
		}
		if (interaction.isButton() && interaction.customId.startsWith('vcverify_deny_')) {
			const requestId = interaction.customId.replace('vcverify_deny_', '');
			try { await vcVerification.handleDeny(interaction, requestId).catch(() => {}); } catch {}
		}
		if (interaction.isModalSubmit() && interaction.customId.startsWith('vcverify_deny_reason_')) {
			const requestId = interaction.customId.replace('vcverify_deny_reason_', '');
			try { await vcVerification.handleDenyModal(interaction, requestId).catch(() => {}); } catch {}
		}
	},
};
