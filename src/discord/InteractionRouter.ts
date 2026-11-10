import { Client, Interaction, ChatInputCommandInteraction, ButtonInteraction, MessageComponentInteraction, MessageFlags, ModalSubmitInteraction, StringSelectMenuInteraction } from 'discord.js';
import { CommandRegistry } from './CommandRegistry';
import { TempVCService } from '../modules/tempvc/TempVCService';
import { TICKET_PREFIX } from '../modules/TicketsManager';
import { STAFFAPP_PREFIX } from '../modules/StaffApplications';
import { GIVEAWAY_PREFIX } from '../modules/GiveawaysManager';

export class InteractionRouter {
  private client: Client | null = null;
  private commandRegistry: CommandRegistry;
  private tempvcService: TempVCService | null = null;
  private ticketsService: any | null = null;
  private staffApplications: any | null = null;
  private giveawaysService: any | null = null;
  private economyGamesService: any | null = null;

  constructor(commandRegistry: CommandRegistry) {
    this.commandRegistry = commandRegistry;
  }

  public setTempVCService(service: TempVCService): void {
    this.tempvcService = service;
  }

  public setTicketsService(service: any): void {
    this.ticketsService = service;
  }

  public setStaffApplications(service: any): void {
    this.staffApplications = service;
  }

  public setGiveawaysService(service: any): void {
    this.giveawaysService = service;
  }

  public setEconomyGamesService(service: any): void {
    this.economyGamesService = service;
  }

  public async initialize(client: Client): Promise<void> {
    this.client = client;
    this.setupInteractionHandlers();
  }

  private setupInteractionHandlers(): void {
    if (!this.client) return;

    this.client.on('interactionCreate', async (interaction: Interaction) => {
      if (interaction.isChatInputCommand()) {
        await this.commandRegistry.handleInteraction(interaction as ChatInputCommandInteraction);
      } else if (interaction.isButton()) {
        await this.handleButtonInteraction(interaction as ButtonInteraction);
      } else if (interaction.isMessageComponent()) {
        await this.handleComponentInteraction(interaction as MessageComponentInteraction);
      } else if (interaction.isStringSelectMenu()) {
        await this.handleSelectInteraction(interaction as StringSelectMenuInteraction);
      } else if (interaction.isModalSubmit()) {
        await this.handleModalInteraction(interaction as ModalSubmitInteraction);
      }
    });
  }

  private async handleSelectInteraction(interaction: StringSelectMenuInteraction): Promise<void> {
    if (String(interaction.customId).startsWith(`${STAFFAPP_PREFIX}role-select:`)) {
      if (!this.staffApplications) {
        await interaction.reply({ content: 'Staff applications are not available.', flags: MessageFlags.Ephemeral }).catch(() => undefined);
        return;
      }
      const guildId = String(interaction.customId).split(':')[1] ?? interaction.guildId;
      const roleId = interaction.values[0];
      if (!roleId || !guildId) return;
      // Show the questions modal directly (no defer — defer would block showModal)
      await this.staffApplications.promptQuestions(interaction, guildId, roleId);
      return;
    }
  }

  private async handleModalInteraction(interaction: ModalSubmitInteraction): Promise<void> {
    if (String(interaction.customId).startsWith(`${STAFFAPP_PREFIX}questions:`)) {
      if (!this.staffApplications) {
        await interaction.reply({ content: 'Staff applications are not available.', flags: MessageFlags.Ephemeral }).catch(() => undefined);
        return;
      }
      await this.staffApplications.handleQuestionsSubmit(interaction);
      return;
    }
  }

  private async handleButtonInteraction(interaction: ButtonInteraction): Promise<void> {
    const customId = interaction.customId;

    if (customId.startsWith('tempvc:')) {
      if (this.tempvcService) {
        await this.tempvcService.handlePanelButton(interaction as any);
      }
      return;
    }

    if (customId.startsWith(TICKET_PREFIX)) {
      await this.handleTicketButton(interaction as any);
      return;
    }

    if (customId.startsWith(STAFFAPP_PREFIX)) {
      await this.handleStaffAppButton(interaction as any);
      return;
    }

    if (customId.startsWith(GIVEAWAY_PREFIX)) {
      await this.handleGiveawayButton(interaction as any);
      return;
    }

    if (customId.startsWith('game_join:')) {
      await this.handleGameJoinButton(interaction as any);
      return;
    }
  }

  private async handleStaffAppButton(interaction: any): Promise<void> {
    if (!this.staffApplications) {
      await interaction.reply({ content: 'Staff applications are not available.', flags: MessageFlags.Ephemeral }).catch(() => undefined);
      return;
    }
    const customId = String(interaction.customId);
    if (customId === `${STAFFAPP_PREFIX}apply`) {
      await this.staffApplications.promptRoleSelection(interaction);
      return;
    }
    // approve / deny
    const m = customId.match(/^staffapp:(approve|deny):([a-zA-Z0-9]+)$/);
    if (m) {
      await this.staffApplications.handleApplicationButton(interaction);
      return;
    }
  }

  private async handleGameJoinButton(interaction: any): Promise<void> {
    if (!this.economyGamesService) {
      await interaction.reply({ content: 'Economy games are not available.', flags: MessageFlags.Ephemeral }).catch(() => undefined);
      return;
    }
    const gameId = String(interaction.customId).slice('game_join:'.length);
    const result = await this.economyGamesService.joinGame(gameId, interaction.user.id, interaction.user.username);
    await interaction.reply({ content: result.message, flags: MessageFlags.Ephemeral }).catch(() => undefined);
  }

  private async handleGiveawayButton(interaction: any): Promise<void> {
    if (!this.giveawaysService) {
      await interaction.reply({ content: 'Giveaways are not available.', flags: MessageFlags.Ephemeral }).catch(() => undefined);
      return;
    }
    const parts = String(interaction.customId).split(':');
    const action = parts[1] ?? '';
    const giveawayId = parts[2] ?? '';
    try {
      let result: { ok: boolean; message: string };
      if (action === 'enter') {
        result = await this.giveawaysService.enterGiveaway(giveawayId, interaction.user.id, interaction.member);
      } else if (action === 'leave') {
        result = await this.giveawaysService.leaveGiveaway(giveawayId, interaction.user.id);
      } else {
        result = { ok: false, message: 'Unknown giveaway action.' };
      }
      await interaction.reply({ content: result.message, flags: MessageFlags.Ephemeral }).catch(() => undefined);
    } catch (err: any) {
      await interaction.reply({ content: `❌ ${err?.message || 'Giveaway action failed.'}`, flags: MessageFlags.Ephemeral }).catch(() => undefined);
    }
  }

  private async handleTicketButton(interaction: any): Promise<void> {
    if (!this.ticketsService) {
      await interaction.reply({ content: 'Tickets are not available.', flags: MessageFlags.Ephemeral }).catch(() => undefined);
      return;
    }
    // ticket:claim:<id> | ticket:close:<id> | ticket:reopen:<id> | ticket:delete:<id> | ticket:panel:create
    const parts = String(interaction.customId).split(':');
    const action = parts[1] ?? '';
    const ticketId = parts[2] ?? '';
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => undefined);
      if (action === 'claim') {
        await this.ticketsService.claimTicket(ticketId, interaction.user.id);
        await interaction.editReply(`🛡️ You claimed ticket \`${ticketId}\`.`).catch(() => undefined);
      } else if (action === 'close' && this.ticketsService.getConfig?.()?.closeVote) {
        // closeVote: closing needs one explicit confirmation first — no silent accidental closes.
        const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`ticket:confirmclose:${ticketId}`).setLabel('Close ticket').setEmoji('🔒').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(`ticket:cancelclose:${ticketId}`).setLabel('Keep open').setStyle(ButtonStyle.Secondary),
        );
        await interaction.editReply({ content: `⚠️ Confirm close of ticket \`${ticketId}\`?`, components: [row] }).catch(() => undefined);
      } else if (action === 'confirmclose') {
        await this.ticketsService.closeTicket(ticketId, interaction.user.id, 'Closed via button (confirmed)');
        await interaction.editReply({ content: `🔒 Ticket \`${ticketId}\` resolved.`, components: [] }).catch(() => undefined);
      } else if (action === 'cancelclose') {
        await interaction.editReply({ content: '✅ Ticket left open.', components: [] }).catch(() => undefined);
      } else if (action === 'close') {
        await this.ticketsService.closeTicket(ticketId, interaction.user.id, 'Closed via button');
        await interaction.editReply(`🔒 Ticket \`${ticketId}\` resolved.`).catch(() => undefined);
      } else if (action === 'reopen') {
        await this.ticketsService.reopenTicket(ticketId, interaction.user.id);
        await interaction.editReply(`🔓 Ticket \`${ticketId}\` reopened.`).catch(() => undefined);
      } else if (action === 'delete') {
        await this.ticketsService.deleteTicket(ticketId, interaction.user.id);
        await interaction.editReply(`🗑️ Ticket \`${ticketId}\` deleted.`).catch(() => undefined);
      } else if (action === 'panel' && ticketId === 'create') {
        // Panel "Open a ticket" button
        const { ticketButtons: _tb } = require('../modules/TicketsManager');
        void _tb;
        const id = await this.ticketsService.createTicket(interaction.user.id, interaction.guildId, 'general', 'Opened via panel button');
        const ticket = await this.ticketsService.getTicket(id);
        await interaction.editReply(`🎫 Your ticket is ready: <#${ticket?.channelId}>`).catch(() => undefined);
      } else {
        await interaction.editReply('Unknown ticket action.').catch(() => undefined);
      }
    } catch (err: any) {
      const msg = `❌ ${err?.message || 'Ticket action failed.'}`;
      try {
        if (interaction.deferred) await interaction.editReply(msg);
        else await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
      } catch { /* ignore */ }
    }
  }

  private async handleComponentInteraction(_interaction: MessageComponentInteraction): Promise<void> {
  }

  public async shutdown(): Promise<void> {
    if (this.client) {
      this.client.removeAllListeners();
    }
    this.client = null;
  }
}
