import { Events } from 'discord.js';
import { presentations } from '../systems/presentations/index.js';
import { verification } from '../systems/verification/index.js';
import { vcVerification } from '../systems/verification/vc.js';
import { replyError } from '../core/respond.js';
import { newErrorId } from '../core/errors.js';
import { bumpCounter, recordActivity } from '../core/metrics.js';

export const systemsInteractionEvent = {
	name: Events.InteractionCreate as keyof import('discord.js').ClientEvents,
	execute: async (client: any, interaction: any) => {
		if (!interaction.isButton() && !interaction.isModalSubmit()) return;

		const { customId } = interaction;
		const errorId = newErrorId();

		// ── Presentations ──
		if (customId.startsWith('presentation_')) {
			try {
				if (customId === 'presentation_apply_button') {
					await presentations.handleApply(interaction);
				} else if (customId === 'presentation_apply') {
					await presentations.handleModalSubmit(interaction);
				} else if (customId === 'presentation_approve') {
					await presentations.handleReview(interaction, 'approve');
				} else if (customId === 'presentation_deny') {
					await presentations.handleReview(interaction, 'deny');
				} else if (customId === 'presentation_changes') {
					await presentations.handleReview(interaction, 'changes');
				} else if (customId.startsWith('presentation_deny_reason_')) {
					const id = customId.replace('presentation_deny_reason_', '');
					await presentations.handleDenyModal(interaction, id);
				} else if (customId.startsWith('presentation_changes_reason_')) {
					const id = customId.replace('presentation_changes_reason_', '');
					await presentations.handleChangesModal(interaction, id);
				}
			} catch (error) {
				bumpCounter('errors');
				recordActivity('error', 'Presentation interaction failed', { level: 'error', meta: { customId, errorId, guildId: interaction.guildId } });
				client.logger?.error({ err: error, errorId, customId }, 'presentation interaction failed');
				await replyError(interaction, 'Something went wrong while handling that.', errorId);
			}
			return;
		}

		// ── Newbie verification ──
		if (customId.startsWith('verification_')) {
			try {
				if (customId === 'verification_agree') {
					await verification.handleVerifyButton(interaction);
				} else if (customId.startsWith('verification_approve_')) {
					const id = customId.replace('verification_approve_', '');
					await verification.handleApprove(interaction, id);
				} else if (customId.startsWith('verification_deny_')) {
					const id = customId.replace('verification_deny_', '');
					await verification.handleDenyButton(interaction, id);
				} else if (customId.startsWith('verification_deny_reason_')) {
					const id = customId.replace('verification_deny_reason_', '');
					await verification.handleDenyModal(interaction, id);
				}
			} catch (error) {
				bumpCounter('errors');
				recordActivity('error', 'Verification interaction failed', { level: 'error', meta: { customId, errorId, guildId: interaction.guildId } });
				client.logger?.error({ err: error, errorId, customId }, 'verification interaction failed');
				await replyError(interaction, 'Something went wrong while handling that.', errorId);
			}
			return;
		}

		// ── Voice verification (single owner: vcVerification) ──
		if (customId.startsWith('vcverify_')) {
			try {
				if (customId.startsWith('vcverify_claim_')) {
					await vcVerification.handleClaim(interaction, customId.replace('vcverify_claim_', ''));
				} else if (customId.startsWith('vcverify_approve_')) {
					await vcVerification.handleApprove(interaction, customId.replace('vcverify_approve_', ''));
				} else if (customId.startsWith('vcverify_deny_')) {
					await vcVerification.handleDeny(interaction, customId.replace('vcverify_deny_', ''));
				} else if (customId.startsWith('vcverify_deny_reason_')) {
					await vcVerification.handleDenyModal(interaction, customId.replace('vcverify_deny_reason_', ''));
				}
			} catch (error) {
				bumpCounter('errors');
				recordActivity('error', 'VC verification interaction failed', { level: 'error', meta: { customId, errorId, guildId: interaction.guildId } });
				client.logger?.error({ err: error, errorId, customId }, 'vc verification interaction failed');
				await replyError(interaction, 'Something went wrong while handling that.', errorId);
			}
			return;
		}
	},
};
