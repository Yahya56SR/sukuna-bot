import { Client, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, TextChannel, Guild, EmbedBuilder } from 'discord.js';
import { Logger } from '../infrastructure/Logger';
import { brandedEmbed, BRAND } from '../utils/embed';
import { buildPanelPayload, panelLink, type PanelButton, type PanelFeature, type PanelPayload } from '../utils/panel';
import { and, desc, eq } from 'drizzle-orm';
import { tickets as ticketsTable } from '../database/schema';
import type { DrizzleDb } from '../types/database';
import { shortId } from '../utils/id';

/** A category shown on the ticket panel — one button per category. */
export interface TicketCategory {
  /** Stable key used in the button id. */
  key: string;
  /** Button label. */
  label: string;
  /** Emoji key (or a literal emoji). */
  emoji: string;
  /** Short description shown in the panel bullet list. */
  description: string;
}

export interface TicketConfig {
  enabled: boolean;
  category: string;
  supportRoles: string[];
  closeVote: boolean;
  /** Categories shown on the panel. Falls back to the defaults. */
  categories?: TicketCategory[];
}

/** Default support categories — mirrors the classic "ticket panel" layout. */
export const DEFAULT_TICKET_CATEGORIES: TicketCategory[] = [
  { key: 'pub', label: 'Pub', emoji: 'pub', description: 'Report spam or pub issues' },
  { key: 'bugs', label: 'Bugs', emoji: 'bug', description: 'Report bugs or issues' },
  { key: 'abuse', label: 'Abuse', emoji: 'abuse', description: 'Report abuse or harassment' },
  { key: 'server', label: 'Server', emoji: 'server', description: 'Server info or requests' },
  { key: 'staff', label: 'Staff', emoji: 'staffReport', description: 'Report staff issues' },
  { key: 'donate', label: 'Donate', emoji: 'donate', description: 'Support the server' },
];

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

export const TICKET_PREFIX = 'ticket:';

export function ticketButtons(ticketId: string, status: Ticket['status']): ActionRowBuilder<ButtonBuilder>[] {
  const row = new ActionRowBuilder<ButtonBuilder>();
  if (status === 'open') {
    row.addComponents(
      new ButtonBuilder().setCustomId(`${TICKET_PREFIX}claim:${ticketId}`).setLabel('Claim').setEmoji('🛡️').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`${TICKET_PREFIX}close:${ticketId}`).setLabel('Close').setEmoji('🔒').setStyle(ButtonStyle.Secondary),
    );
  } else if (status === 'resolved') {
    row.addComponents(
      new ButtonBuilder().setCustomId(`${TICKET_PREFIX}reopen:${ticketId}`).setLabel('Reopen').setEmoji('🔓').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`${TICKET_PREFIX}delete:${ticketId}`).setLabel('Delete').setEmoji('🗑️').setStyle(ButtonStyle.Danger),
    );
  } else {
    row.addComponents(
      new ButtonBuilder().setCustomId(`${TICKET_PREFIX}reopen:${ticketId}`).setLabel('Reopen').setEmoji('🔓').setStyle(ButtonStyle.Primary),
    );
  }
  return [row];
}

export function ticketWelcomeEmbed(opts: {
  userId: string;
  category: string;
  ticketId: string;
  guildName: string;
}): EmbedBuilder {
  return brandedEmbed(BRAND.blue)
    .setTitle('🎫 New Ticket')
    .setDescription(
      `Hey <@${opts.userId}>, staff will be with you shortly.\n\n` +
      `**Ticket:** \`${opts.ticketId}\`\n**Category:** ${opts.category}\n\n` +
      'Please describe your issue in detail below. Staff can use **Claim** to take ownership, or **Close** when done.'
    )
    .setAuthor({ name: opts.guildName })
    .addFields(
      { name: 'Status', value: '🟢 Open', inline: true },
      { name: 'Assigned to', value: 'Unclaimed', inline: true },
    );
}

/**
 * The panel shown inside a freshly opened ticket channel — same visual
 * language as the big ticket panel so the whole flow feels consistent.
 */
export async function ticketWelcomePanel(opts: {
  userId: string;
  category: string;
  ticketId: string;
  guildName: string;
  guildIconUrl?: string | undefined;
  reason?: string | undefined;
}): Promise<{ components: any[]; files: any[]; flags: number }> {
  const features: PanelFeature[] = [
    { emoji: 'support', label: 'Describe your issue', value: 'Tell the staff what happened, step by step' },
    { emoji: 'check', label: 'Claim', value: 'Staff take ownership of your ticket' },
    { emoji: 'cross', label: 'Close', value: 'Mark the ticket as resolved when it is done' },
  ];

  const reason = String(opts.reason ?? '').trim();
  if (reason && reason !== 'No reason provided') {
    features.unshift({ emoji: 'question', label: 'Your issue', value: reason.slice(0, 100) });
  }

  const payload = await buildPanelPayload({
    emoji: 'ticket',
    title: `${opts.category} Ticket`,
    guildName: opts.guildName,
    guildIconUrl: opts.guildIconUrl,
    color: BRAND.blue,
    intro: `Hey <@${opts.userId}> — thanks for reaching out. Staff will be with you shortly.`,
    features,
    note: `Ticket ID: \`${opts.ticketId}\` • only you and the staff team can see this channel.`,
    footer: `${opts.guildName} • Ticket ${opts.ticketId}`,
    banner: {
      title: 'Support Ticket',
      subtitle: opts.guildName,
      emoji: '🎫',
      accent: '#0099ff',
      accentSecondary: '#a855f7',
    },
    buttons: [],
  });

  return {
    components: [...payload.components, ...ticketButtons(opts.ticketId, 'open')],
    files: payload.files,
    flags: payload.flags,
  };
}

function toTicket(row: any): Ticket {
  const status = row.status === 'closed' || row.status === 'resolved' ? row.status : 'open';
  const created = row.created_at instanceof Date ? row.created_at.getTime() : Number(row.created_at ?? Date.now());
  const updated = row.updated_at instanceof Date ? row.updated_at.getTime() : Number(row.updated_at ?? created);
  return {
    id: row.id,
    guildId: row.guild_id,
    userId: row.user_id,
    channelId: row.channel_id,
    category: row.category || 'general',
    status,
    assignedTo: row.assigned_to ?? '',
    closeReason: row.close_reason ?? '',
    createdAt: created,
    updatedAt: updated,
  };
}

export class TicketsManager {
  private client: Client | null = null;
  private logger: Logger;
  private config: TicketConfig;
  private db: DrizzleDb | null = null;
  private tickets: Map<string, Ticket> = new Map();

  constructor(logger: Logger, config: TicketConfig) {
    this.logger = logger;
    this.config = { ...config };
    // Normalises the config so `categories` always exists (dashboard merges
    // only into keys that are already present).
    this.setConfig(this.config);
  }

  public setDb(db: DrizzleDb): void {
    this.db = db;
  }

  public setConfig(config: TicketConfig): void {
    this.config = { ...config, categories: this.cleanCategories(config.categories) };
  }

  public getConfig(): TicketConfig {
    return this.config;
  }

  /** Normalises configured categories, falling back to the defaults. */
  private cleanCategories(categories?: TicketCategory[]): TicketCategory[] {
    if (!Array.isArray(categories)) return [];
    const cleaned = categories
      .map((category) => ({
        key: String(category?.key ?? '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, ''),
        label: String(category?.label ?? '').trim().slice(0, 80),
        emoji: String(category?.emoji ?? 'ticket').trim() || 'ticket',
        description: String(category?.description ?? '').trim().slice(0, 120),
      }))
      .filter((category) => category.key && category.label);
    return cleaned;
  }

  /** Categories shown on the panel — configured ones, else the defaults. */
  public getCategories(): TicketCategory[] {
    const configured = this.cleanCategories(this.config.categories);
    return configured.length ? configured : DEFAULT_TICKET_CATEGORIES;
  }

  /** Finds a category by key. */
  public getCategory(key: string): TicketCategory | undefined {
    return this.getCategories().find((category) => category.key === key);
  }

  /**
   * Builds the big ticket panel: intro, a bullet per category, banner
   * artwork and one button per category.
   */
  public async buildPanel(guild: Guild): Promise<PanelPayload> {
    const categories = this.getCategories();

    const features: PanelFeature[] = categories.map((category) => ({
      emoji: category.emoji,
      label: category.label,
      value: category.description,
    }));

    const buttons: PanelButton[] = categories.map((category) => ({
      id: `${TICKET_PREFIX}panel:create:${category.key}`,
      label: category.label,
      emoji: category.emoji,
      style: ButtonStyle.Primary,
    }));
    if (buttons.length === 0) {
      buttons.push({ id: `${TICKET_PREFIX}panel:create`, label: 'Open a ticket', emoji: 'ticket', style: ButtonStyle.Primary });
    }

    const invite = guild.vanityURLCode
      ? ` ${panelLink('Join the server', `https://discord.gg/${guild.vanityURLCode}`)}.`
      : '';

    return buildPanelPayload({
      emoji: 'ticket',
      title: 'Ticket Support System',
      guildName: guild.name,
      guildIconUrl: guild.iconURL({ extension: 'png', size: 256 }) ?? undefined,
      color: BRAND.blue,
      intro: `We want to keep our community safe, friendly and fun for everyone. Pick a category below and staff will pick it up in a private channel.${invite}`,
      features,
      note: 'Use these modules for assistance or to report issues. Our team is here to help!',
      banner: {
        title: 'Ticket Support System',
        subtitle: guild.name,
        emoji: '🎫',
        accent: '#0099ff',
        accentSecondary: '#a855f7',
      },
      buttons,
      footer: `${guild.name} • Ticket Support`,
    });
  }

  public async initialize(client: Client): Promise<void> {
    try {
      this.client = client;
      this.tickets.clear();
      if (this.db) {
        const rows = await this.db.select().from(ticketsTable);
        for (const row of rows) this.tickets.set(row.id, toTicket(row));
        this.logger.info('Tickets Manager', `Loaded ${rows.length} ticket(s) from database`);
      }
      this.logger.info('Tickets Manager', 'Tickets system initialized successfully');
    } catch (error) {
      this.logger.error('Tickets Manager', 'Tickets system initialization failed', error as Error);
      throw error;
    }
  }

  private async isSupport(guild: Guild | undefined | null, userId: string): Promise<boolean> {
    if (!guild) return false;
    if (this.config.supportRoles.length === 0) {
      // No support roles configured → only guild admins / managers count.
      try {
        const m = await guild.members.fetch(userId).catch(() => null);
        if (!m) return false;
        return m.permissions.has(PermissionFlagsBits.ManageMessages) || m.permissions.has(PermissionFlagsBits.Administrator);
      } catch { return false; }
    }
    try {
      const m = guild.members.cache.get(userId) ?? await guild.members.fetch(userId).catch(() => null);
      if (!m) return false;
      const hasSupport = this.config.supportRoles.some((rid) => m.roles.cache.has(rid));
      if (hasSupport) return true;
      // Permission fallback so dashboard misconfig doesn't lock staff out.
      return m.permissions.has(PermissionFlagsBits.ManageMessages) || m.permissions.has(PermissionFlagsBits.Administrator);
    } catch { return false; }
  }

  private async persist(ticket: Ticket): Promise<void> {
    if (!this.db) return;
    await this.db.insert(ticketsTable).values({
      id: ticket.id,
      guild_id: ticket.guildId,
      user_id: ticket.userId,
      channel_id: ticket.channelId,
      category: ticket.category,
      status: ticket.status,
      assigned_to: ticket.assignedTo || null,
      close_reason: ticket.closeReason || null,
      created_at: new Date(ticket.createdAt),
      updated_at: new Date(ticket.updatedAt),
    } as any);
  }

  private async update(ticket: Ticket): Promise<void> {
    if (!this.db) return;
    await this.db
      .update(ticketsTable)
      .set({
        status: ticket.status,
        assigned_to: ticket.assignedTo || null,
        close_reason: ticket.closeReason || null,
        updated_at: new Date(ticket.updatedAt),
      } as any)
      .where(eq(ticketsTable.id, ticket.id));
  }

  private async findOpenTicket(guildId: string, userId: string): Promise<Ticket | null> {
    if (!this.db) {
      return Array.from(this.tickets.values()).find(
        (t) => t.guildId === guildId && t.userId === userId && t.status === 'open'
      ) ?? null;
    }
    const rows = await this.db
      .select()
      .from(ticketsTable)
      .where(and(
        eq(ticketsTable.guild_id, guildId),
        eq(ticketsTable.user_id, userId),
        eq(ticketsTable.status, 'open')
      ))
      .limit(1);
    return rows[0] ? toTicket(rows[0]) : null;
  }

  public async createTicket(userId: string, guildId: string, category: string, reason = 'No reason provided'): Promise<string> {
    if (!this.config.enabled) {
      throw new Error('Tickets system is disabled');
    }

    const guild = this.client?.guilds.cache.get(guildId);
    if (!guild) throw new Error('Server not found.');

    const existing = await this.findOpenTicket(guildId, userId);
    if (existing) {
      const channel = await this.client?.channels.fetch(existing.channelId).catch(() => null);
      if (channel) throw new Error(`You already have an open ticket: <#${existing.channelId}>`);
      // The channel was deleted manually — retire the stale row and continue.
      existing.status = 'resolved';
      existing.closeReason = 'Channel no longer exists';
      existing.updatedAt = Date.now();
      this.tickets.set(existing.id, existing);
      await this.update(existing);
    }

    const member = await guild.members.fetch(userId).catch(() => null);
    const username = member?.displayName ?? member?.user.username ?? 'user';
    const id = shortId('t');

    const overwrites: any[] = [
      { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: userId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
    ];
    for (const rid of this.config.supportRoles) {
      if (rid && rid !== guild.id) overwrites.push({ id: rid, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
    }
    // Include the bot itself
    if (this.client?.user?.id) overwrites.push({ id: this.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });

    let channel: any = null;
    try {
      const opts: any = {
        name: `🎫-${username}`.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 30) || `ticket-${id}`,
        type: ChannelType.GuildText,
        permissionOverwrites: overwrites,
        topic: `Ticket ${id} • ${category} • ${reason}`.slice(0, 1024),
      };
      if (this.config.category) opts.parent = this.config.category;
      channel = await guild.channels.create(opts);
    } catch {
      // Fallback without category (some servers have no category set)
      channel = await guild.channels.create({
        name: `ticket-${id}`,
        type: ChannelType.GuildText,
        permissionOverwrites: overwrites,
        topic: `Ticket ${id} • ${category}`,
      });
    }

    if (!channel) throw new Error('Could not create ticket channel');

    const now = Date.now();
    const ticket: Ticket = {
      id,
      guildId,
      userId,
      channelId: channel.id,
      category: category || 'general',
      status: 'open',
      assignedTo: '',
      closeReason: '',
      createdAt: now,
      updatedAt: now,
    };
    this.tickets.set(id, ticket);
    try {
      await this.persist(ticket);
    } catch (error) {
      // Don't leave an orphan channel behind if the row could not be written.
      await channel.delete().catch(() => undefined);
      this.tickets.delete(id);
      throw error;
    }

    // Welcome panel inside the ticket
    try {
      const welcome = await ticketWelcomePanel({
        userId,
        category: ticket.category,
        ticketId: id,
        guildName: guild.name,
        guildIconUrl: guild.iconURL({ extension: 'png', size: 256 }) ?? undefined,
        reason,
      });
      await (channel as TextChannel).send({
        components: welcome.components,
        files: welcome.files,
        flags: welcome.flags,
        allowedMentions: { users: [userId] },
      });
    } catch (err) {
      this.logger.warn('Tickets Manager', 'Failed to post ticket welcome', err as Error);
    }

    this.logger.info('Tickets Manager', `Created ticket ${id} for user ${userId}`);
    return id;
  }

  public async closeTicket(ticketId: string, userId: string, reason: string, byStaff = false): Promise<void> {
    const ticket = await this.getTicket(ticketId);
    if (!ticket) throw new Error('Ticket not found');
    if (ticket.status !== 'open') throw new Error('This ticket is already closed.');

    const guild = this.client?.guilds.cache.get(ticket.guildId);
    const allowed = ticket.userId === userId || byStaff || (await this.isSupport(guild, userId));
    if (!allowed) {
      throw new Error('You do not have permission to close this ticket');
    }

    ticket.status = 'resolved';
    ticket.closeReason = reason || 'No reason provided';
    ticket.updatedAt = Date.now();
    this.tickets.set(ticket.id, ticket);
    await this.update(ticket);

    // Post resolution notice + reopen/delete actions
    try {
      const channel = await this.client?.channels.fetch(ticket.channelId).catch(() => null) as TextChannel | null;
      if (channel) {
        const embed = brandedEmbed(BRAND.grey)
          .setTitle('🔒 Ticket resolved')
          .setDescription(`Closed by <@${userId}>\n**Reason:** ${ticket.closeReason}\n\nThis ticket will stay readable for reference. Staff can **Reopen** or **Delete** below.`);
        await channel.send({ embeds: [embed], components: ticketButtons(ticket.id, 'resolved') });
        // Lock the channel for the ticket opener (keep staff access)
        await channel.permissionOverwrites.edit(ticket.userId, { ViewChannel: false }).catch(() => undefined);
      }
    } catch { /* best-effort */ }

    this.logger.info('Tickets Manager', `Closed ticket ${ticketId} by ${userId}`);
  }

  public async reopenTicket(ticketId: string, userId: string): Promise<void> {
    const ticket = await this.getTicket(ticketId);
    if (!ticket) throw new Error('Ticket not found');
    if (ticket.status === 'open') throw new Error('This ticket is already open.');

    const guild = this.client?.guilds.cache.get(ticket.guildId);
    if (ticket.userId !== userId && !(await this.isSupport(guild, userId))) {
      throw new Error('You do not have permission to reopen this ticket.');
    }

    ticket.status = 'open';
    ticket.closeReason = '';
    ticket.updatedAt = Date.now();
    this.tickets.set(ticket.id, ticket);
    await this.update(ticket);

    try {
      const channel = await this.client?.channels.fetch(ticket.channelId).catch(() => null) as TextChannel | null;
      if (channel) {
        await channel.permissionOverwrites.edit(ticket.userId, { ViewChannel: true, SendMessages: true }).catch(() => undefined);
        await channel.send({
          embeds: [brandedEmbed(BRAND.green).setTitle('🔓 Ticket reopened').setDescription(`Reopened by <@${userId}>.`)],
          components: ticketButtons(ticket.id, 'open'),
        });
      }
    } catch { /* best-effort */ }
    this.logger.info('Tickets Manager', `Reopened ticket ${ticketId} by ${userId}`);
  }

  public async deleteTicket(ticketId: string, userId: string): Promise<void> {
    const ticket = await this.getTicket(ticketId);
    if (!ticket) throw new Error('Ticket not found');
    const guild = this.client?.guilds.cache.get(ticket.guildId);
    if (!(await this.isSupport(guild, userId))) throw new Error('Only staff can delete tickets.');
    const channel = await this.client?.channels.fetch(ticket.channelId).catch(() => null) as any;
    if (channel?.deletable) await channel.delete().catch(() => undefined);
    this.tickets.delete(ticketId);
    if (this.db) await this.db.delete(ticketsTable).where(eq(ticketsTable.id, ticketId));
    this.logger.info('Tickets Manager', `Deleted ticket ${ticketId} by ${userId}`);
  }

  public async claimTicket(ticketId: string, userId: string): Promise<void> {
    const ticket = await this.getTicket(ticketId);
    if (!ticket) throw new Error('Ticket not found');
    if (ticket.status !== 'open') throw new Error('This ticket is not open.');
    const guild = this.client?.guilds.cache.get(ticket.guildId);
    if (!(await this.isSupport(guild, userId))) throw new Error('Only staff can claim tickets.');
    if (ticket.assignedTo && ticket.assignedTo !== userId) {
      throw new Error(`This ticket is already claimed by <@${ticket.assignedTo}>.`);
    }
    ticket.assignedTo = userId;
    ticket.updatedAt = Date.now();
    this.tickets.set(ticket.id, ticket);
    await this.update(ticket);
    try {
      const channel = await this.client?.channels.fetch(ticket.channelId).catch(() => null) as TextChannel | null;
      if (channel) {
        await channel.send({
          embeds: [brandedEmbed(BRAND.green).setTitle('🛡️ Ticket claimed').setDescription(`<@${userId}> is now handling this ticket.`)],
          components: ticketButtons(ticket.id, ticket.status),
        }).catch(() => undefined);
      }
    } catch { /* best-effort */ }
    this.logger.info('Tickets Manager', `Assigned ticket ${ticketId} to ${userId}`);
  }

  public async addMessageToTicket(ticketId: string, userId: string, content: string): Promise<void> {
    const ticket = await this.getTicket(ticketId);
    if (!ticket) throw new Error('Ticket not found');
    const channel = this.client?.channels.cache.get(ticket.channelId);
    if (channel && channel.type === ChannelType.GuildText) {
      await channel.send(`**${userId}:** ${content}`);
    }
    ticket.updatedAt = Date.now();
    this.tickets.set(ticket.id, ticket);
    await this.update(ticket);
  }

  public async assignTicket(ticketId: string, userId: string, assignedTo: string): Promise<void> {
    const ticket = await this.getTicket(ticketId);
    if (!ticket) throw new Error('Ticket not found');
    const guild = this.client?.guilds.cache.get(ticket.guildId);
    if (!(await this.isSupport(guild, userId))) {
      throw new Error('You do not have permission to assign tickets');
    }
    ticket.assignedTo = assignedTo;
    ticket.updatedAt = Date.now();
    this.tickets.set(ticket.id, ticket);
    await this.update(ticket);
    this.logger.info('Tickets Manager', `Assigned ticket ${ticketId} to ${assignedTo}`);
  }

  public async getTicket(ticketId: string): Promise<Ticket | null> {
    const cached = this.tickets.get(ticketId);
    if (cached) return cached;
    if (!this.db) return null;
    const rows = await this.db.select().from(ticketsTable).where(eq(ticketsTable.id, ticketId)).limit(1);
    if (!rows[0]) return null;
    const ticket = toTicket(rows[0]);
    this.tickets.set(ticket.id, ticket);
    return ticket;
  }

  public async getUserTickets(userId: string, guildId?: string): Promise<Ticket[]> {
    if (!this.db) {
      return Array.from(this.tickets.values()).filter((t) => t.userId === userId && (!guildId || t.guildId === guildId));
    }
    const where = guildId
      ? and(eq(ticketsTable.user_id, userId), eq(ticketsTable.guild_id, guildId))
      : eq(ticketsTable.user_id, userId);
    const rows = await this.db.select().from(ticketsTable).where(where).orderBy(desc(ticketsTable.created_at));
    return rows.map(toTicket);
  }

  public async getGuildTickets(guildId: string): Promise<Ticket[]> {
    if (!this.db) {
      return Array.from(this.tickets.values()).filter((t) => t.guildId === guildId);
    }
    const rows = await this.db
      .select()
      .from(ticketsTable)
      .where(eq(ticketsTable.guild_id, guildId))
      .orderBy(desc(ticketsTable.created_at));
    return rows.map(toTicket);
  }

  public ticketFromChannel(channelId: string): Ticket | undefined {
    return Array.from(this.tickets.values()).find((t) => t.channelId === channelId);
  }

  public async shutdown(): Promise<void> {
    this.tickets.clear();
    this.logger.info('Tickets Manager', 'Tickets system shutdown successfully');
  }
}

/** Slash commands for tickets — /ticket create|close|claim|list */
export class TicketsCommands {
  private service: TicketsManager;
  private logger: Logger;

  constructor(service: TicketsManager, logger: Logger) {
    this.service = service;
    this.logger = logger;
  }

  public getCommands(): any[] {
    return [this.ticketCommand];
  }

  private ticketCommand: any = {
    data: new (require('discord.js').SlashCommandBuilder)()
      .setName('ticket')
      .setDescription('Support tickets')
      .addSubcommand((sub: any) =>
        sub.setName('create').setDescription('Open a support ticket')
          .addStringOption((o: any) => o.setName('category').setDescription('Ticket category').setRequired(false))
          .addStringOption((o: any) => o.setName('reason').setDescription('What do you need help with?').setRequired(false)),
      )
      .addSubcommand((sub: any) =>
        sub.setName('close').setDescription('Close this ticket')
          .addStringOption((o: any) => o.setName('reason').setDescription('Reason for closing').setRequired(false)),
      )
      .addSubcommand((sub: any) =>
        sub.setName('claim').setDescription('Claim this ticket (staff)'),
      )
      .addSubcommand((sub: any) =>
        sub.setName('list').setDescription('List open tickets'),
      )
      .addSubcommand((sub: any) =>
        sub.setName('panel').setDescription('Post a ticket panel (admin)')
          .addChannelOption((o: any) => o.setName('channel').setDescription('Channel to post in').setRequired(true).addChannelTypes(ChannelType.GuildText)),
      ),
    execute: async (interaction: any) => {
      const { MessageFlags } = require('discord.js');
      const sub = interaction.options.getSubcommand();
      const guild = interaction.guild;
      if (!guild) {
        await interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral }).catch(() => undefined);
        return;
      }
      try {
        if (sub === 'create') {
          const category = interaction.options.getString('category') || 'general';
          const reason = interaction.options.getString('reason') || 'No reason provided';
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          const id = await this.service.createTicket(interaction.user.id, guild.id, category, reason);
          const ticket = await this.service.getTicket(id);
          await interaction.editReply({
            embeds: [brandedEmbed(BRAND.green).setTitle('🎫 Ticket created').setDescription(`Your ticket is ready: <#${ticket?.channelId}>\n**ID:** \`${id}\``)],
          });
        } else if (sub === 'close') {
          const reason = interaction.options.getString('reason') || 'No reason provided';
          const ticket = this.service.ticketFromChannel(interaction.channelId);
          if (!ticket) {
            await interaction.reply({ content: 'This is not a ticket channel.', flags: MessageFlags.Ephemeral }).catch(() => undefined);
            return;
          }
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          await this.service.closeTicket(ticket.id, interaction.user.id, reason);
          await interaction.editReply({ content: `🔒 Ticket \`${ticket.id}\` resolved.` });
        } else if (sub === 'claim') {
          const ticket = this.service.ticketFromChannel(interaction.channelId);
          if (!ticket) {
            await interaction.reply({ content: 'This is not a ticket channel.', flags: MessageFlags.Ephemeral }).catch(() => undefined);
            return;
          }
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          await this.service.claimTicket(ticket.id, interaction.user.id);
          await interaction.editReply({ content: `🛡️ You claimed ticket \`${ticket.id}\`.` });
        } else if (sub === 'list') {
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          const mine = await this.service.getUserTickets(interaction.user.id, guild.id);
          const open = mine.filter((t) => t.status === 'open');
          const embed = brandedEmbed(BRAND.blue).setTitle('🎫 Your tickets');
          embed.setDescription(open.length ? open.map((t) => `• <#${t.channelId}> — **${t.category}** (\`${t.id}\`)`).join('\n') : 'You have no open tickets.');
          await interaction.editReply({ embeds: [embed] });
        } else if (sub === 'panel') {
          const channel = interaction.options.getChannel('channel', true);
          const panel = await this.service.buildPanel(guild);
          await channel.send({
            components: panel.components,
            files: panel.files,
            flags: panel.flags,
          }).catch(() => undefined);
          await interaction.reply({ content: `✅ Ticket panel posted in ${channel}.`, flags: MessageFlags.Ephemeral }).catch(() => undefined);
        }
      } catch (err: any) {
        this.logger.error('Tickets Commands', `Failed /ticket ${sub}`, err as Error);
        const msg = `❌ ${err?.message || 'Failed.'}`;
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply({ content: msg }).catch(() => undefined);
        } else {
          await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral }).catch(() => undefined);
        }
      }
    },
  };
}
