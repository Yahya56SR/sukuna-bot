import { Events } from 'discord.js';
import { presentations } from '../systems/presentations/index.js';
import { verification } from '../systems/verification/index.js';
import { vcVerification } from '../systems/verification/vc.js';

export const systemsInteractionEvent = {
	name: Events.InteractionCreate as keyof import('discord.js').ClientEvents,
	execute: async (client: any, interaction: any) => {
		if (!interaction.isButton() && !interaction.isModalSubmit()) return;

		const { customId } = interaction;

		// ── Presentations ──
		if (customId.startsWith('presentation_')) {
			try {
				if (customId === 'presentation_apply_button') {
					await presentations.handleApply(interaction).catch(() => {});
				} else if (customId === 'presentation_apply') {
					await presentations.handleModalSubmit(interaction).catch(() => {});
				} else if (customId === 'presentation_approve') {
					await presentations.handleReview(interaction, 'approve').catch(() => {});
				} else if (customId === 'presentation_deny') {
					await presentations.handleReview(interaction, 'deny').catch(() => {});
				} else if (customId === 'presentation_changes') {
					await presentations.handleReview(interaction, 'changes').catch(() => {});
				} else if (customId.startsWith('presentation_deny_reason_')) {
					const id = customId.replace('presentation_deny_reason_', '');
					await presentations.handleDenyModal(interaction, id).catch(() => {});
				} else if (customId.startsWith('presentation_changes_reason_')) {
					const id = customId.replace('presentation_changes_reason_', '');
					await presentations.handleChangesModal(interaction, id).catch(() => {});
				}
			} catch (error) {
				console.error('[Systems] Presentation interaction error:', error);
				if (interaction.replied || interaction.deferred) {
					await interaction.followUp({ content: 'An error occurred!', flags: 64 });
				} else {
					await interaction.reply({ content: 'An error occurred!', flags: 64 });
				}
			}
			return;
		}

		// ── Newbie verification ──
		if (customId.startsWith('verification_')) {
			try {
				if (customId === 'verification_agree') {
					await verification.handleVerifyButton(interaction).catch(() => {});
				} else if (customId.startsWith('verification_approve_')) {
					const id = customId.replace('verification_approve_', '');
					await verification.handleApprove(interaction, id).catch(() => {});
				} else if (customId.startsWith('verification_deny_')) {
					const id = customId.replace('verification_deny_', '');
					await verification.handleDenyButton(interaction, id).catch(() => {});
				} else if (customId.startsWith('verification_deny_reason_')) {
					const id = customId.replace('verification_deny_reason_', '');
					await verification.handleDenyModal(interaction, id).catch(() => {});
				}
			} catch (error) {
				console.error('[Systems] Verification interaction error:', error);
				if (interaction.replied || interaction.deferred) {
					await interaction.followUp({ content: 'An error occurred!', flags: 64 });
				} else {
					await interaction.reply({ content: 'An error occurred!', flags: 64 });
				}
			}
			return;
		}

		// ── Voice verification ──
		if (customId.startsWith('vcverify_')) {
			try {
				if (customId.startsWith('vcverify_claim_')) {
					await vcVerification.handleClaim(interaction, customId.replace('vcverify_claim_', '')).catch(() => {});
				} else if (customId.startsWith('vcverify_approve_')) {
					await vcVerification.handleApprove(interaction, customId.replace('vcverify_approve_', '')).catch(() => {});
				} else if (customId.startsWith('vcverify_deny_')) {
					await vcVerification.handleDeny(interaction, customId.replace('vcverify_deny_', '')).catch(() => {});
				} else if (customId.startsWith('vcverify_deny_reason_')) {
					await vcVerification.handleDenyModal(interaction, customId.replace('vcverify_deny_reason_', '')).catch(() => {});
				}
			} catch (error) {
				console.error('[Systems] VC verification interaction error:', error);
				if (interaction.replied || interaction.deferred) {
					await interaction.followUp({ content: 'An error occurred!', flags: 64 });
				} else {
					await interaction.reply({ content: 'An error occurred!', flags: 64 });
				}
			}
			return;
		}
	},
};
