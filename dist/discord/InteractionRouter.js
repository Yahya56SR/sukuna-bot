"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InteractionRouter = void 0;
const discord_js_1 = require("discord.js");
const TicketsManager_1 = require("../modules/TicketsManager");
const StaffApplications_1 = require("../modules/StaffApplications");
const GiveawaysManager_1 = require("../modules/GiveawaysManager");
class InteractionRouter {
    constructor(commandRegistry) {
        this.client = null;
        this.tempvcService = null;
        this.ticketsService = null;
        this.staffApplications = null;
        this.giveawaysService = null;
        this.economyGamesService = null;
        this.commandRegistry = commandRegistry;
    }
    setTempVCService(service) {
        this.tempvcService = service;
    }
    setTicketsService(service) {
        this.ticketsService = service;
    }
    setStaffApplications(service) {
        this.staffApplications = service;
    }
    setGiveawaysService(service) {
        this.giveawaysService = service;
    }
    setEconomyGamesService(service) {
        this.economyGamesService = service;
    }
    async initialize(client) {
        this.client = client;
        this.setupInteractionHandlers();
    }
    setupInteractionHandlers() {
        if (!this.client)
            return;
        this.client.on('interactionCreate', async (interaction) => {
            if (interaction.isChatInputCommand()) {
                await this.commandRegistry.handleInteraction(interaction);
            }
            else if (interaction.isButton()) {
                await this.handleButtonInteraction(interaction);
            }
            else if (interaction.isMessageComponent()) {
                await this.handleComponentInteraction(interaction);
            }
            else if (interaction.isStringSelectMenu()) {
                await this.handleSelectInteraction(interaction);
            }
            else if (interaction.isModalSubmit()) {
                await this.handleModalInteraction(interaction);
            }
        });
    }
    async handleSelectInteraction(interaction) {
        if (String(interaction.customId).startsWith(`${StaffApplications_1.STAFFAPP_PREFIX}role-select:`)) {
            if (!this.staffApplications) {
                await interaction.reply({ content: 'Staff applications are not available.', flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
                return;
            }
            const guildId = String(interaction.customId).split(':')[1] ?? interaction.guildId;
            const roleId = interaction.values[0];
            if (!roleId || !guildId)
                return;
            // Show the questions modal directly (no defer — defer would block showModal)
            await this.staffApplications.promptQuestions(interaction, guildId, roleId);
            return;
        }
    }
    async handleModalInteraction(interaction) {
        if (String(interaction.customId).startsWith(`${StaffApplications_1.STAFFAPP_PREFIX}questions:`)) {
            if (!this.staffApplications) {
                await interaction.reply({ content: 'Staff applications are not available.', flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
                return;
            }
            await this.staffApplications.handleQuestionsSubmit(interaction);
            return;
        }
    }
    async handleButtonInteraction(interaction) {
        const customId = interaction.customId;
        if (customId.startsWith('tempvc:')) {
            if (this.tempvcService) {
                await this.tempvcService.handlePanelButton(interaction);
            }
            return;
        }
        if (customId.startsWith(TicketsManager_1.TICKET_PREFIX)) {
            await this.handleTicketButton(interaction);
            return;
        }
        if (customId.startsWith(StaffApplications_1.STAFFAPP_PREFIX)) {
            await this.handleStaffAppButton(interaction);
            return;
        }
        if (customId.startsWith(GiveawaysManager_1.GIVEAWAY_PREFIX)) {
            await this.handleGiveawayButton(interaction);
            return;
        }
        if (customId.startsWith('game_join:')) {
            await this.handleGameJoinButton(interaction);
            return;
        }
    }
    async handleStaffAppButton(interaction) {
        if (!this.staffApplications) {
            await interaction.reply({ content: 'Staff applications are not available.', flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
            return;
        }
        const customId = String(interaction.customId);
        if (customId === `${StaffApplications_1.STAFFAPP_PREFIX}apply`) {
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
    async handleGameJoinButton(interaction) {
        if (!this.economyGamesService) {
            await interaction.reply({ content: 'Economy games are not available.', flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
            return;
        }
        const gameId = String(interaction.customId).slice('game_join:'.length);
        const result = await this.economyGamesService.joinGame(gameId, interaction.user.id, interaction.user.username);
        await interaction.reply({ content: result.message, flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
    }
    async handleGiveawayButton(interaction) {
        if (!this.giveawaysService) {
            await interaction.reply({ content: 'Giveaways are not available.', flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
            return;
        }
        const parts = String(interaction.customId).split(':');
        const action = parts[1] ?? '';
        const giveawayId = parts[2] ?? '';
        try {
            let result;
            if (action === 'enter') {
                result = await this.giveawaysService.enterGiveaway(giveawayId, interaction.user.id, interaction.member);
            }
            else if (action === 'leave') {
                result = await this.giveawaysService.leaveGiveaway(giveawayId, interaction.user.id);
            }
            else {
                result = { ok: false, message: 'Unknown giveaway action.' };
            }
            await interaction.reply({ content: result.message, flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
        }
        catch (err) {
            await interaction.reply({ content: `❌ ${err?.message || 'Giveaway action failed.'}`, flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
        }
    }
    async handleTicketButton(interaction) {
        if (!this.ticketsService) {
            await interaction.reply({ content: 'Tickets are not available.', flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
            return;
        }
        // ticket:claim:<id> | ticket:close:<id> | ticket:reopen:<id> | ticket:delete:<id> | ticket:panel:create
        const parts = String(interaction.customId).split(':');
        const action = parts[1] ?? '';
        const ticketId = parts[2] ?? '';
        try {
            await interaction.deferReply({ flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
            if (action === 'claim') {
                await this.ticketsService.claimTicket(ticketId, interaction.user.id);
                await interaction.editReply(`🛡️ You claimed ticket \`${ticketId}\`.`).catch(() => undefined);
            }
            else if (action === 'close' && this.ticketsService.getConfig?.()?.closeVote) {
                // closeVote: closing needs one explicit confirmation first — no silent accidental closes.
                const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
                const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`ticket:confirmclose:${ticketId}`).setLabel('Close ticket').setEmoji('🔒').setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId(`ticket:cancelclose:${ticketId}`).setLabel('Keep open').setStyle(ButtonStyle.Secondary));
                await interaction.editReply({ content: `⚠️ Confirm close of ticket \`${ticketId}\`?`, components: [row] }).catch(() => undefined);
            }
            else if (action === 'confirmclose') {
                await this.ticketsService.closeTicket(ticketId, interaction.user.id, 'Closed via button (confirmed)');
                await interaction.editReply({ content: `🔒 Ticket \`${ticketId}\` resolved.`, components: [] }).catch(() => undefined);
            }
            else if (action === 'cancelclose') {
                await interaction.editReply({ content: '✅ Ticket left open.', components: [] }).catch(() => undefined);
            }
            else if (action === 'close') {
                await this.ticketsService.closeTicket(ticketId, interaction.user.id, 'Closed via button');
                await interaction.editReply(`🔒 Ticket \`${ticketId}\` resolved.`).catch(() => undefined);
            }
            else if (action === 'reopen') {
                await this.ticketsService.reopenTicket(ticketId, interaction.user.id);
                await interaction.editReply(`🔓 Ticket \`${ticketId}\` reopened.`).catch(() => undefined);
            }
            else if (action === 'delete') {
                await this.ticketsService.deleteTicket(ticketId, interaction.user.id);
                await interaction.editReply(`🗑️ Ticket \`${ticketId}\` deleted.`).catch(() => undefined);
            }
            else if (action === 'panel' && ticketId === 'create') {
                // Panel "Open a ticket" button
                const { ticketButtons: _tb } = require('../modules/TicketsManager');
                void _tb;
                const id = await this.ticketsService.createTicket(interaction.user.id, interaction.guildId, 'general', 'Opened via panel button');
                const ticket = await this.ticketsService.getTicket(id);
                await interaction.editReply(`🎫 Your ticket is ready: <#${ticket?.channelId}>`).catch(() => undefined);
            }
            else {
                await interaction.editReply('Unknown ticket action.').catch(() => undefined);
            }
        }
        catch (err) {
            const msg = `❌ ${err?.message || 'Ticket action failed.'}`;
            try {
                if (interaction.deferred)
                    await interaction.editReply(msg);
                else
                    await interaction.reply({ content: msg, flags: discord_js_1.MessageFlags.Ephemeral });
            }
            catch { /* ignore */ }
        }
    }
    async handleComponentInteraction(_interaction) {
    }
    async shutdown() {
        if (this.client) {
            this.client.removeAllListeners();
        }
        this.client = null;
    }
}
exports.InteractionRouter = InteractionRouter;
