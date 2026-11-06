import type { VoiceState, VoiceChannel, TextChannel, Guild, GuildMember } from 'discord.js';
import {
	EmbedBuilder,
	ChannelType,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	UserSelectMenuBuilder,
	ModalBuilder,
	TextInputBuilder,
	TextInputStyle,
} from 'discord.js';
import {
	readTempVCConfig,
	upsertTempVCConfig,
	readActiveTempVCByChannel,
	createActiveTempVC,
	deleteActiveTempVC,
	getCachedActiveTempVC,
	setCachedActiveTempVC,
	deleteCachedActiveTempVC,
} from '../../db/models/TempVC.js';

/**
 * Temp VC system (ported from astralcraft).
 * Uses Mongoose (TempVCConfig, ActiveTempVC) with in-memory caching.
 */
const PANEL_ACTIONS = [
	'rename', 'limit', 'lock', 'unlock', 'hide',
	'show', 'trust', 'untrust', 'invite', 'kick',
	'block', 'unblock', 'transfer', 'claim', 'delete',
	'trust_all', 'untrust_all', 'info',
];

export class TempVCSystem {
	private emptyTimeouts = new Map<string, NodeJS.Timeout>();

	async getConfig(guildId: string): Promise<any> {
		const cfg = await readTempVCConfig(guildId);
		if (!cfg) return null;
		return {
			creatorChannelId: cfg.createChannelId,
			categoryId: cfg.categoryId,
			defaultName: cfg.nameTemplate,
			defaultLimit: cfg.userLimit ?? 0,
			panelChannelId: undefined,
			panelMessageId: undefined,
		};
	}

	async setConfig(guildId: string, data: any): Promise<void> {
		const updates: any = {};
		if (data.creatorChannelId !== undefined) updates.createChannelId = data.creatorChannelId;
		if (data.categoryId !== undefined) updates.categoryId = data.categoryId;
		if (data.defaultName !== undefined) updates.nameTemplate = data.defaultName;
		if (data.defaultLimit !== undefined) updates.userLimit = data.defaultLimit;
		await upsertTempVCConfig(guildId, updates);
	}

	async handleVoiceStateUpdate(oldState: VoiceState, newState: VoiceState): Promise<void> {
		try {
			const guild = newState.guild;
			if (!guild) return;

			const cfg = await this.getConfig(guild.id);
			if (!cfg) return;

			const creatorChannelId = cfg.creatorChannelId;

			if (!oldState.channelId && newState.channelId === creatorChannelId && newState.member) {
				await this.createTempVC(newState.member, guild, cfg);
			}

			if (oldState.channelId && !newState.channelId) {
				const active = await readActiveTempVCByChannel(oldState.channelId);
				if (active) {
					await this.handleEmptyVC(guild, active.channelId);
				}
			}
		} catch (error) {
			console.error('[TempVC] Voice state error:', error);
		}
	}

	async createTempVC(member: GuildMember, guild: Guild, cfg: any): Promise<void> {
		const user = member.user;
		if (!user) return;

		const voiceName = (cfg.defaultName || "{user}'s VC").replace('{user}', user.username).slice(0, 100);
		const userLimit = cfg.defaultLimit ?? 0;
		const vcCategory = cfg.categoryId ? guild.channels.cache.get(cfg.categoryId) : undefined;

		const voiceChannel = await guild.channels.create({
			name: voiceName,
			type: ChannelType.GuildVoice,
			parent: vcCategory?.id,
			userLimit,
			permissionOverwrites: [
				{ id: user.id, allow: ['ManageChannels', 'ManageRoles', 'MuteMembers', 'DeafenMembers', 'MoveMembers', 'Connect', 'Speak', 'UseSoundboard'] },
				{ id: guild.id, deny: ['ViewChannel'] },
			],
		}) as VoiceChannel;

		await createActiveTempVC({ guildId: guild.id, channelId: voiceChannel.id, ownerId: user.id } as any);
		setCachedActiveTempVC(voiceChannel.id, { guildId: guild.id, channelId: voiceChannel.id, ownerId: user.id } as any);

		await member.voice.setChannel(voiceChannel.id).catch((e: any) => console.log('[TempVC] Could not move user to new VC:', e?.message || e));
		await this.refreshPanel(guild);
	}

	async handleEmptyVC(guild: Guild, vcId: string): Promise<void> {
		const active = await readActiveTempVCByChannel(vcId);
		if (!active) return;

		const voiceChannel = guild.channels.cache.get(active.channelId) as VoiceChannel | undefined;
		if (!voiceChannel) return;

		if (voiceChannel.members.size > 0) return;

		const existingTimeout = this.emptyTimeouts.get(vcId);
		if (existingTimeout) {
			clearTimeout(existingTimeout);
			this.emptyTimeouts.delete(vcId);
		}

		const timeoutId = setTimeout(async () => {
			this.emptyTimeouts.delete(vcId);
			const currentVC = guild.channels.cache.get(vcId) as VoiceChannel | undefined;
			if (currentVC && currentVC.members.size === 0) {
				await currentVC.delete().catch(() => {});
				await deleteActiveTempVC(vcId);
				deleteCachedActiveTempVC(vcId);
				await this.refreshPanel(guild);
			}
		}, 10000);
		this.emptyTimeouts.set(vcId, timeoutId);
	}

	async handleButton(interaction: any): Promise<void> {
		const customId = interaction.customId;
		const panelAction = PANEL_ACTIONS.find((a) => customId === `tempvc_${a}`);
		if (panelAction) {
			await this.handlePanelButton(interaction, panelAction);
			return;
		}

		const match = customId.match(/tempvc_(\w+)_([\w-]+)/);
		if (!match) return;
		const [, action, vcId] = match;
		await this.runAction(interaction, action, vcId);
	}

	private panelChannelId(_guild: Guild | null | undefined): string | null {
		return null; // shared panel not persisted in sukuna model yet
	}

	private async handlePanelButton(interaction: any, action: string): Promise<void> {
		const guild = interaction.guild as Guild;
		if (!guild) {
			await interaction.reply({ content: '❌ This can only be used in a server.', flags: 64 });
			return;
		}

		if (action === 'info') {
			await interaction.reply({ content: '🎮 **Temp VC help**\nJoin the creator voice channel to get your own temp VC.', flags: 64 });
			return;
		}

		if (action === 'claim') {
			const member = await guild.members.fetch(interaction.user.id).catch(() => null);
			const inVcId = member?.voice.channelId;
			// Claim logic simplified for sukuna model
			await interaction.reply({ content: '❌ Claim not yet supported in this port.', flags: 64 });
			return;
		}

		await interaction.reply({ content: '❌ You do not own a temp VC. Join the creator voice channel to get one!', flags: 64 });
	}

	async runAction(interaction: any, action: string, vcId: string): Promise<void> {
		const active = await readActiveTempVCByChannel(vcId);
		if (!active) {
			await interaction.reply({ content: '❌ This VC session has expired.', flags: 64 });
			return;
		}

		if (interaction.user.id !== active.ownerId && action !== 'claim') {
			await interaction.reply({ content: '❌ Only the VC owner can use these controls.', flags: 64 });
			return;
		}

		const guild = interaction.guild as Guild;
		const voiceChannel = guild?.channels.cache.get(vcId) as VoiceChannel | undefined;
		if (!voiceChannel) {
			await interaction.reply({ content: '❌ Voice channel not found.', flags: 64 });
			return;
		}

		const everyoneId = guild.id;

		try {
			switch (action) {
				case 'lock': {
					if (everyoneId) await this.setOverwrite(voiceChannel, everyoneId, { Connect: false });
					await interaction.reply({ content: '🔒 VC **locked**!', flags: 64 });
					break;
				}
				case 'unlock': {
					if (everyoneId) await this.setOverwrite(voiceChannel, everyoneId, { Connect: true });
					await interaction.reply({ content: '🔓 VC **unlocked**!', flags: 64 });
					break;
				}
				case 'limit': {
					const modal = new ModalBuilder().setCustomId(`tempvc_limit_${vcId}`).setTitle('👥 Set User Limit');
					const input = new TextInputBuilder()
						.setCustomId('tempvc_limit_input')
						.setLabel('User limit (0 = unlimited, max 99)')
						.setStyle(TextInputStyle.Short)
						.setValue('0')
						.setRequired(true);
					modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
					await interaction.showModal(modal);
					break;
				}
				case 'rename': {
					const modal = new ModalBuilder().setCustomId(`tempvc_rename_${vcId}`).setTitle('✏️ Rename VC');
					const input = new TextInputBuilder()
						.setCustomId('tempvc_rename_input')
						.setLabel('New VC name (max 100 chars)')
						.setStyle(TextInputStyle.Short)
						.setValue(voiceChannel.name)
						.setMaxLength(100)
						.setRequired(true);
					modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
					await interaction.showModal(modal);
					break;
				}
				case 'hide': {
					if (everyoneId) await this.setOverwrite(voiceChannel, everyoneId, { ViewChannel: false });
					await interaction.reply({ content: '👁️ VC **hidden**', flags: 64 });
					break;
				}
				case 'show': {
					if (everyoneId) await this.setOverwrite(voiceChannel, everyoneId, { ViewChannel: true });
					await interaction.reply({ content: '👀 VC **shown**', flags: 64 });
					break;
				}
				case 'delete': {
					await voiceChannel.delete().catch(() => {});
					await deleteActiveTempVC(vcId);
					deleteCachedActiveTempVC(vcId);
					await interaction.reply({ content: '❌ VC deleted.', flags: 64 });
					break;
				}
				default: {
					await interaction.reply({ content: `❌ Action "${action}" not yet implemented in this port.`, flags: 64 });
				}
			}
		} catch (error) {
			console.error('[TempVC] runAction error:', error);
			if (!interaction.replied) {
				await interaction.reply({ content: '❌ An error occurred.', flags: 64 }).catch(() => {});
			}
		}
	}

	async handleModal(interaction: any): Promise<void> {
		const customId = interaction.customId;
		const match = customId.match(/tempvc_(rename|limit)_([\w-]+)/);
		if (!match) return;
		const [, action, vcId] = match;
		const active = await readActiveTempVCByChannel(vcId);
		if (!active || interaction.user.id !== active.ownerId) {
			await interaction.reply({ content: '❌ Only the VC owner can use these controls.', flags: 64 });
			return;
		}

		const guild = interaction.guild as Guild;
		const voiceChannel = guild?.channels.cache.get(vcId) as VoiceChannel | undefined;
		if (!voiceChannel) {
			await interaction.reply({ content: '❌ Voice channel not found.', flags: 64 });
			return;
		}

		try {
			if (action === 'rename') {
				const name = interaction.fields.getTextInputValue('tempvc_rename_input')?.trim();
				if (!name) { await interaction.reply({ content: '❌ Name cannot be empty.', flags: 64 }); return; }
				await voiceChannel.setName(name.slice(0, 100));
				await interaction.reply({ content: `✏️ VC renamed to **${name}**!`, flags: 64 });
			}
			else if (action === 'limit') {
				const raw = interaction.fields.getTextInputValue('tempvc_limit_input')?.trim();
				const limit = Number.parseInt(raw, 10);
				if (Number.isNaN(limit) || limit < 0 || limit > 99) {
					await interaction.reply({ content: '❌ Invalid limit (0-99).', flags: 64 });
					return;
				}
				await voiceChannel.setUserLimit(limit);
				await interaction.reply({ content: `👥 User limit set to **${limit === 0 ? '∞' : limit}**!`, flags: 64 });
			}
		} catch (error) {
			await interaction.reply({ content: '❌ An error occurred.', flags: 64 }).catch(() => {});
		}
	}

	async handleSelect(interaction: any): Promise<void> {
		const customId = interaction.customId;
		const match = customId.match(/tempvc_(\w+)_select_([\w-]+)/);
		if (!match) return;
		const [, action, vcId] = match;
		await this.runAction(interaction, action, vcId);
	}

	private panelEmbed(_guild: Guild, _activeCount: number): EmbedBuilder {
		return new EmbedBuilder()
			.setColor('#5865F2')
			.setTitle('🎮 Temp VC Control Panel')
			.setDescription('Join the creator voice channel to get your own temporary voice channel!')
			.setTimestamp();
	}

	private panelRows(): ActionRowBuilder<ButtonBuilder>[] {
		const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
			this.btn('tempvc_rename', '✏️ Rename', ButtonStyle.Secondary),
			this.btn('tempvc_limit', '👥 Limit', ButtonStyle.Secondary),
			this.btn('tempvc_lock', '🔒 Lock', ButtonStyle.Primary),
			this.btn('tempvc_unlock', '🔓 Unlock', ButtonStyle.Secondary),
			this.btn('tempvc_hide', '👁️ Hide', ButtonStyle.Secondary),
		);
		return [row1];
	}

	private liveVcCount(_guild: Guild): number {
		return 0;
	}

	async postPanel(_guild: Guild, channel: TextChannel): Promise<void> {
		await channel.send({ embeds: [this.panelEmbed(_guild as Guild, 0)], components: this.panelRows() });
	}

	async refreshPanel(guild: Guild): Promise<void> {
		try {
			// no-op: panel is posted on demand via postPanel
		} catch {}
	}

	private btn(customId: string, label: string, style: ButtonStyle): ButtonBuilder {
		return new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style);
	}

	private async setOverwrite(channel: VoiceChannel | TextChannel, id: string, options: Record<string, boolean | null>): Promise<void> {
		const existing = channel.permissionOverwrites.cache.get(id);
		if (existing) await channel.permissionOverwrites.edit(id, options);
		else await channel.permissionOverwrites.create(id, options);
	}
}

export const tempvc = new TempVCSystem();

export const voiceStateUpdateTempvc = {
	name: 'voiceStateUpdate' as keyof import('discord.js').ClientEvents,
	execute: async (_client: any, oldState: VoiceState, newState: VoiceState) => {
		try { await tempvc.handleVoiceStateUpdate(oldState, newState).catch(() => {}); } catch {}
	},
};

export const interactionCreateTempvc = {
	name: 'interactionCreate' as const,
	execute: async (_client: any, interaction: any) => {
		if (!interaction.isButton() && !interaction.isStringSelectMenu() && !interaction.isModalSubmit()) return;
		if (interaction.isButton() && interaction.customId.startsWith('tempvc_')) {
			try { await tempvc.handleButton(interaction).catch(() => {}); } catch {}
		}
		if (interaction.isStringSelectMenu() && interaction.customId.startsWith('tempvc_')) {
			try { await tempvc.handleSelect(interaction).catch(() => {}); } catch {}
		}
		if (interaction.isModalSubmit() && interaction.customId.startsWith('tempvc_')) {
			try { await tempvc.handleModal(interaction).catch(() => {}); } catch {}
		}
	},
};
