"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TicketsManager = void 0;
const discord_js_1 = require("discord.js");
class TicketsManager {
    constructor(logger, config) {
        this.client = null;
        this.tickets = new Map();
        this.logger = logger;
        this.config = config;
    }
    async initialize(client) {
        try {
            this.client = client;
            this.logger.info('Tickets Manager', 'Initializing tickets system...');
            this.logger.info('Tickets Manager', 'Tickets system initialized successfully');
        }
        catch (error) {
            this.logger.error('Tickets Manager', 'Tickets system initialization failed', error);
            throw error;
        }
    }
    async createTicket(userId, guildId, category) {
        if (!this.config.enabled) {
            throw new Error('Tickets system is disabled');
        }
        const id = Math.random().toString(36).substr(2, 9);
        const guild = this.client?.guilds.cache.get(guildId);
        const channel = guild ? await guild.channels.create({ name: `ticket-${id}`, type: discord_js_1.ChannelType.GuildText }) : null;
        if (!channel) {
            throw new Error('Could not create ticket channel');
        }
        const ticket = {
            id,
            guildId,
            userId,
            channelId: channel.id,
            category,
            status: 'open',
            assignedTo: this.config.supportRoles[0] || '',
            closeReason: '',
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };
        this.tickets.set(id, ticket);
        this.logger.info('Tickets Manager', `Created ticket ${id} for user ${userId}`);
        return id;
    }
    async closeTicket(ticketId, userId, reason) {
        const ticket = this.tickets.get(ticketId);
        if (!ticket) {
            throw new Error('Ticket not found');
        }
        if (ticket.userId !== userId && !this.config.supportRoles.includes(userId)) {
            throw new Error('You do not have permission to close this ticket');
        }
        ticket.status = 'closed';
        ticket.closeReason = reason;
        ticket.updatedAt = Date.now();
        this.logger.info('Tickets Manager', `Closed ticket ${ticketId} by ${userId}`);
    }
    async addMessageToTicket(ticketId, userId, content) {
        const ticket = this.tickets.get(ticketId);
        if (!ticket) {
            throw new Error('Ticket not found');
        }
        const channel = this.client?.channels.cache.get(ticket.channelId);
        if (channel && channel.type === discord_js_1.ChannelType.GuildText) {
            await channel.send(`**${userId}:** ${content}`);
        }
        ticket.updatedAt = Date.now();
    }
    async assignTicket(ticketId, userId, assignedTo) {
        const ticket = this.tickets.get(ticketId);
        if (!ticket) {
            throw new Error('Ticket not found');
        }
        if (!this.config.supportRoles.includes(userId)) {
            throw new Error('You do not have permission to assign tickets');
        }
        ticket.assignedTo = assignedTo;
        ticket.updatedAt = Date.now();
        this.logger.info('Tickets Manager', `Assigned ticket ${ticketId} to ${assignedTo}`);
    }
    async getTicket(ticketId) {
        return this.tickets.get(ticketId) || null;
    }
    async getUserTickets(userId) {
        return Array.from(this.tickets.values()).filter(ticket => ticket.userId === userId);
    }
    async shutdown() {
        this.tickets.clear();
        this.logger.info('Tickets Manager', 'Tickets system shutdown successfully');
    }
}
exports.TicketsManager = TicketsManager;
