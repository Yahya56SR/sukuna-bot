import { Client, ChannelType } from 'discord.js';
import { Logger } from '../infrastructure/Logger';

export interface TicketConfig {
  enabled: boolean;
  category: string;
  supportRoles: string[];
  closeVote: boolean;
}

export interface Ticket {
  id: string;
  guildId: string;
  userId: string;
  channelId: string;
  category: string;
  status: 'open' | 'closed' | 'resolved';
  assignedTo: string;
  closeReason: string;
  createdAt: number;
  updatedAt: number;
}

export class TicketsManager {
  private client: Client | null = null;
  private logger: Logger;
  private config: TicketConfig;
  private tickets: Map<string, Ticket> = new Map();

  constructor(logger: Logger, config: TicketConfig) {
    this.logger = logger;
    this.config = config;
  }

  public async initialize(client: Client): Promise<void> {
    try {
      this.client = client;
      this.logger.info('Tickets Manager', 'Initializing tickets system...');
      this.logger.info('Tickets Manager', 'Tickets system initialized successfully');
    } catch (error) {
      this.logger.error('Tickets Manager', 'Tickets system initialization failed', error as Error);
      throw error;
    }
  }

  public async createTicket(userId: string, guildId: string, category: string): Promise<string> {
    if (!this.config.enabled) {
      throw new Error('Tickets system is disabled');
    }

    const id = Math.random().toString(36).substr(2, 9);
    const guild = this.client?.guilds.cache.get(guildId);
    const channel = guild ? await guild.channels.create({ name: `ticket-${id}`, type: ChannelType.GuildText }) : null;

    if (!channel) {
      throw new Error('Could not create ticket channel');
    }

    const ticket: Ticket = {
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

  public async closeTicket(ticketId: string, userId: string, reason: string): Promise<void> {
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

  public async addMessageToTicket(ticketId: string, userId: string, content: string): Promise<void> {
    const ticket = this.tickets.get(ticketId);
    if (!ticket) {
      throw new Error('Ticket not found');
    }

    const channel = this.client?.channels.cache.get(ticket.channelId);
    if (channel && channel.type === ChannelType.GuildText) {
      await channel.send(`**${userId}:** ${content}`);
    }

    ticket.updatedAt = Date.now();
  }

  public async assignTicket(ticketId: string, userId: string, assignedTo: string): Promise<void> {
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

  public async getTicket(ticketId: string): Promise<Ticket | null> {
    return this.tickets.get(ticketId) || null;
  }

  public async getUserTickets(userId: string): Promise<Ticket[]> {
    return Array.from(this.tickets.values()).filter(ticket => ticket.userId === userId);
  }

  public async shutdown(): Promise<void> {
    this.tickets.clear();
    this.logger.info('Tickets Manager', 'Tickets system shutdown successfully');
  }
}
