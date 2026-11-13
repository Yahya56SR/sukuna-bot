"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TicketsCommands = exports.TicketsManager = exports.TICKET_PREFIX = exports.DEFAULT_TICKET_CATEGORIES = void 0;
exports.ticketButtons = ticketButtons;
exports.ticketWelcomeEmbed = ticketWelcomeEmbed;
exports.ticketWelcomePanel = ticketWelcomePanel;
const discord_js_1 = require("discord.js");
const embed_1 = require("../utils/embed");
const panel_1 = require("../utils/panel");
const drizzle_orm_1 = require("drizzle-orm");
const schema_1 = require("../database/schema");
const id_1 = require("../utils/id");
/** Default support categories — mirrors the classic "ticket panel" layout. */
exports.DEFAULT_TICKET_CATEGORIES = [
    { key: 'pub', label: 'Pub', emoji: 'pub', description: 'Report spam or pub issues' },
    { key: 'bugs', label: 'Bugs', emoji: 'bug', description: 'Report bugs or issues' },
    { key: 'abuse', label: 'Abuse', emoji: 'abuse', description: 'Report abuse or harassment' },
    { key: 'server', label: 'Server', emoji: 'server', description: 'Server info or requests' },
    { key: 'staff', label: 'Staff', emoji: 'staffReport', description: 'Report staff issues' },
    { key: 'donate', label: 'Donate', emoji: 'donate', description: 'Support the server' },
];
exports.TICKET_PREFIX = 'ticket:';
function ticketButtons(ticketId, status) {
    const row = new discord_js_1.ActionRowBuilder();
    if (status === 'open') {
        row.addComponents(new discord_js_1.ButtonBuilder().setCustomId(`${exports.TICKET_PREFIX}claim:${ticketId}`).setLabel('Claim').setEmoji('🛡️').setStyle(discord_js_1.ButtonStyle.Success), new discord_js_1.ButtonBuilder().setCustomId(`${exports.TICKET_PREFIX}close:${ticketId}`).setLabel('Close').setEmoji('🔒').setStyle(discord_js_1.ButtonStyle.Secondary));
    }
    else if (status === 'resolved') {
        row.addComponents(new discord_js_1.ButtonBuilder().setCustomId(`${exports.TICKET_PREFIX}reopen:${ticketId}`).setLabel('Reopen').setEmoji('🔓').setStyle(discord_js_1.ButtonStyle.Primary), new discord_js_1.ButtonBuilder().setCustomId(`${exports.TICKET_PREFIX}delete:${ticketId}`).setLabel('Delete').setEmoji('🗑️').setStyle(discord_js_1.ButtonStyle.Danger));
    }
    else {
        row.addComponents(new discord_js_1.ButtonBuilder().setCustomId(`${exports.TICKET_PREFIX}reopen:${ticketId}`).setLabel('Reopen').setEmoji('🔓').setStyle(discord_js_1.ButtonStyle.Primary));
    }
    return [row];
}
function ticketWelcomeEmbed(opts) {
    return (0, embed_1.brandedEmbed)(embed_1.BRAND.blue)
        .setTitle('🎫 New Ticket')
        .setDescription(`Hey <@${opts.userId}>, staff will be with you shortly.\n\n` +
        `**Ticket:** \`${opts.ticketId}\`\n**Category:** ${opts.category}\n\n` +
        'Please describe your issue in detail below. Staff can use **Claim** to take ownership, or **Close** when done.')
        .setAuthor({ name: opts.guildName })
        .addFields({ name: 'Status', value: '🟢 Open', inline: true }, { name: 'Assigned to', value: 'Unclaimed', inline: true });
}
/**
 * The panel shown inside a freshly opened ticket channel — same visual
 * language as the big ticket panel so the whole flow feels consistent.
 */
async function ticketWelcomePanel(opts) {
    const features = [
        { emoji: 'support', label: 'Describe your issue', value: 'Tell the staff what happened, step by step' },
        { emoji: 'check', label: 'Claim', value: 'Staff take ownership of your ticket' },
        { emoji: 'cross', label: 'Close', value: 'Mark the ticket as resolved when it is done' },
    ];
    const reason = String(opts.reason ?? '').trim();
    if (reason && reason !== 'No reason provided') {
        features.unshift({ emoji: 'question', label: 'Your issue', value: reason.slice(0, 100) });
    }
    const payload = await (0, panel_1.buildPanelPayload)({
        emoji: 'ticket',
        title: `${opts.category} Ticket`,
        guildName: opts.guildName,
        guildIconUrl: opts.guildIconUrl,
        color: embed_1.BRAND.blue,
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
function toTicket(row) {
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
class TicketsManager {
    constructor(logger, config) {
        this.client = null;
        this.db = null;
        this.tickets = new Map();
        this.logger = logger;
        this.config = { ...config };
        // Normalises the config so `categories` always exists (dashboard merges
        // only into keys that are already present).
        this.setConfig(this.config);
    }
    setDb(db) {
        this.db = db;
    }
    setConfig(config) {
        this.config = { ...config, categories: this.cleanCategories(config.categories) };
    }
    getConfig() {
        return this.config;
    }
    /** Normalises configured categories, falling back to the defaults. */
    cleanCategories(categories) {
        if (!Array.isArray(categories))
            return [];
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
    getCategories() {
        const configured = this.cleanCategories(this.config.categories);
        return configured.length ? configured : exports.DEFAULT_TICKET_CATEGORIES;
    }
    /** Finds a category by key. */
    getCategory(key) {
        return this.getCategories().find((category) => category.key === key);
    }
    /**
     * Builds the big ticket panel: intro, a bullet per category, banner
     * artwork and one button per category.
     */
    async buildPanel(guild) {
        const categories = this.getCategories();
        const features = categories.map((category) => ({
            emoji: category.emoji,
            label: category.label,
            value: category.description,
        }));
        const buttons = categories.map((category) => ({
            id: `${exports.TICKET_PREFIX}panel:create:${category.key}`,
            label: category.label,
            emoji: category.emoji,
            style: discord_js_1.ButtonStyle.Primary,
        }));
        if (buttons.length === 0) {
            buttons.push({ id: `${exports.TICKET_PREFIX}panel:create`, label: 'Open a ticket', emoji: 'ticket', style: discord_js_1.ButtonStyle.Primary });
        }
        const invite = guild.vanityURLCode
            ? ` ${(0, panel_1.panelLink)('Join the server', `https://discord.gg/${guild.vanityURLCode}`)}.`
            : '';
        return (0, panel_1.buildPanelPayload)({
            emoji: 'ticket',
            title: 'Ticket Support System',
            guildName: guild.name,
            guildIconUrl: guild.iconURL({ extension: 'png', size: 256 }) ?? undefined,
            color: embed_1.BRAND.blue,
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
    async initialize(client) {
        try {
            this.client = client;
            this.tickets.clear();
            if (this.db) {
                const rows = await this.db.select().from(schema_1.tickets);
                for (const row of rows)
                    this.tickets.set(row.id, toTicket(row));
                this.logger.info('Tickets Manager', `Loaded ${rows.length} ticket(s) from database`);
            }
            this.logger.info('Tickets Manager', 'Tickets system initialized successfully');
        }
        catch (error) {
            this.logger.error('Tickets Manager', 'Tickets system initialization failed', error);
            throw error;
        }
    }
    async isSupport(guild, userId) {
        if (!guild)
            return false;
        if (this.config.supportRoles.length === 0) {
            // No support roles configured → only guild admins / managers count.
            try {
                const m = await guild.members.fetch(userId).catch(() => null);
                if (!m)
                    return false;
                return m.permissions.has(discord_js_1.PermissionFlagsBits.ManageMessages) || m.permissions.has(discord_js_1.PermissionFlagsBits.Administrator);
            }
            catch {
                return false;
            }
        }
        try {
            const m = guild.members.cache.get(userId) ?? await guild.members.fetch(userId).catch(() => null);
            if (!m)
                return false;
            const hasSupport = this.config.supportRoles.some((rid) => m.roles.cache.has(rid));
            if (hasSupport)
                return true;
            // Permission fallback so dashboard misconfig doesn't lock staff out.
            return m.permissions.has(discord_js_1.PermissionFlagsBits.ManageMessages) || m.permissions.has(discord_js_1.PermissionFlagsBits.Administrator);
        }
        catch {
            return false;
        }
    }
    async persist(ticket) {
        if (!this.db)
            return;
        await this.db.insert(schema_1.tickets).values({
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
        });
    }
    async update(ticket) {
        if (!this.db)
            return;
        await this.db
            .update(schema_1.tickets)
            .set({
            status: ticket.status,
            assigned_to: ticket.assignedTo || null,
            close_reason: ticket.closeReason || null,
            updated_at: new Date(ticket.updatedAt),
        })
            .where((0, drizzle_orm_1.eq)(schema_1.tickets.id, ticket.id));
    }
    async findOpenTicket(guildId, userId) {
        if (!this.db) {
            return Array.from(this.tickets.values()).find((t) => t.guildId === guildId && t.userId === userId && t.status === 'open') ?? null;
        }
        const rows = await this.db
            .select()
            .from(schema_1.tickets)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.tickets.guild_id, guildId), (0, drizzle_orm_1.eq)(schema_1.tickets.user_id, userId), (0, drizzle_orm_1.eq)(schema_1.tickets.status, 'open')))
            .limit(1);
        return rows[0] ? toTicket(rows[0]) : null;
    }
    async createTicket(userId, guildId, category, reason = 'No reason provided') {
        if (!this.config.enabled) {
            throw new Error('Tickets system is disabled');
        }
        const guild = this.client?.guilds.cache.get(guildId);
        if (!guild)
            throw new Error('Server not found.');
        const existing = await this.findOpenTicket(guildId, userId);
        if (existing) {
            const channel = await this.client?.channels.fetch(existing.channelId).catch(() => null);
            if (channel)
                throw new Error(`You already have an open ticket: <#${existing.channelId}>`);
            // The channel was deleted manually — retire the stale row and continue.
            existing.status = 'resolved';
            existing.closeReason = 'Channel no longer exists';
            existing.updatedAt = Date.now();
            this.tickets.set(existing.id, existing);
            await this.update(existing);
        }
        const member = await guild.members.fetch(userId).catch(() => null);
        const username = member?.displayName ?? member?.user.username ?? 'user';
        const id = (0, id_1.shortId)('t');
        const overwrites = [
            { id: guild.id, deny: [discord_js_1.PermissionFlagsBits.ViewChannel] },
            { id: userId, allow: [discord_js_1.PermissionFlagsBits.ViewChannel, discord_js_1.PermissionFlagsBits.SendMessages, discord_js_1.PermissionFlagsBits.ReadMessageHistory] },
        ];
        for (const rid of this.config.supportRoles) {
            if (rid && rid !== guild.id)
                overwrites.push({ id: rid, allow: [discord_js_1.PermissionFlagsBits.ViewChannel, discord_js_1.PermissionFlagsBits.SendMessages, discord_js_1.PermissionFlagsBits.ReadMessageHistory] });
        }
        // Include the bot itself
        if (this.client?.user?.id)
            overwrites.push({ id: this.client.user.id, allow: [discord_js_1.PermissionFlagsBits.ViewChannel, discord_js_1.PermissionFlagsBits.SendMessages, discord_js_1.PermissionFlagsBits.ReadMessageHistory] });
        let channel = null;
        try {
            const opts = {
                name: `🎫-${username}`.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 30) || `ticket-${id}`,
                type: discord_js_1.ChannelType.GuildText,
                permissionOverwrites: overwrites,
                topic: `Ticket ${id} • ${category} • ${reason}`.slice(0, 1024),
            };
            if (this.config.category)
                opts.parent = this.config.category;
            channel = await guild.channels.create(opts);
        }
        catch {
            // Fallback without category (some servers have no category set)
            channel = await guild.channels.create({
                name: `ticket-${id}`,
                type: discord_js_1.ChannelType.GuildText,
                permissionOverwrites: overwrites,
                topic: `Ticket ${id} • ${category}`,
            });
        }
        if (!channel)
            throw new Error('Could not create ticket channel');
        const now = Date.now();
        const ticket = {
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
        }
        catch (error) {
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
            await channel.send({
                components: welcome.components,
                files: welcome.files,
                flags: welcome.flags,
                allowedMentions: { users: [userId] },
            });
        }
        catch (err) {
            this.logger.warn('Tickets Manager', 'Failed to post ticket welcome', err);
        }
        this.logger.info('Tickets Manager', `Created ticket ${id} for user ${userId}`);
        return id;
    }
    async closeTicket(ticketId, userId, reason, byStaff = false) {
        const ticket = await this.getTicket(ticketId);
        if (!ticket)
            throw new Error('Ticket not found');
        if (ticket.status !== 'open')
            throw new Error('This ticket is already closed.');
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
            const channel = await this.client?.channels.fetch(ticket.channelId).catch(() => null);
            if (channel) {
                const embed = (0, embed_1.brandedEmbed)(embed_1.BRAND.grey)
                    .setTitle('🔒 Ticket resolved')
                    .setDescription(`Closed by <@${userId}>\n**Reason:** ${ticket.closeReason}\n\nThis ticket will stay readable for reference. Staff can **Reopen** or **Delete** below.`);
                await channel.send({ embeds: [embed], components: ticketButtons(ticket.id, 'resolved') });
                // Lock the channel for the ticket opener (keep staff access)
                await channel.permissionOverwrites.edit(ticket.userId, { ViewChannel: false }).catch(() => undefined);
            }
        }
        catch { /* best-effort */ }
        this.logger.info('Tickets Manager', `Closed ticket ${ticketId} by ${userId}`);
    }
    async reopenTicket(ticketId, userId) {
        const ticket = await this.getTicket(ticketId);
        if (!ticket)
            throw new Error('Ticket not found');
        if (ticket.status === 'open')
            throw new Error('This ticket is already open.');
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
            const channel = await this.client?.channels.fetch(ticket.channelId).catch(() => null);
            if (channel) {
                await channel.permissionOverwrites.edit(ticket.userId, { ViewChannel: true, SendMessages: true }).catch(() => undefined);
                await channel.send({
                    embeds: [(0, embed_1.brandedEmbed)(embed_1.BRAND.green).setTitle('🔓 Ticket reopened').setDescription(`Reopened by <@${userId}>.`)],
                    components: ticketButtons(ticket.id, 'open'),
                });
            }
        }
        catch { /* best-effort */ }
        this.logger.info('Tickets Manager', `Reopened ticket ${ticketId} by ${userId}`);
    }
    async deleteTicket(ticketId, userId) {
        const ticket = await this.getTicket(ticketId);
        if (!ticket)
            throw new Error('Ticket not found');
        const guild = this.client?.guilds.cache.get(ticket.guildId);
        if (!(await this.isSupport(guild, userId)))
            throw new Error('Only staff can delete tickets.');
        const channel = await this.client?.channels.fetch(ticket.channelId).catch(() => null);
        if (channel?.deletable)
            await channel.delete().catch(() => undefined);
        this.tickets.delete(ticketId);
        if (this.db)
            await this.db.delete(schema_1.tickets).where((0, drizzle_orm_1.eq)(schema_1.tickets.id, ticketId));
        this.logger.info('Tickets Manager', `Deleted ticket ${ticketId} by ${userId}`);
    }
    async claimTicket(ticketId, userId) {
        const ticket = await this.getTicket(ticketId);
        if (!ticket)
            throw new Error('Ticket not found');
        if (ticket.status !== 'open')
            throw new Error('This ticket is not open.');
        const guild = this.client?.guilds.cache.get(ticket.guildId);
        if (!(await this.isSupport(guild, userId)))
            throw new Error('Only staff can claim tickets.');
        if (ticket.assignedTo && ticket.assignedTo !== userId) {
            throw new Error(`This ticket is already claimed by <@${ticket.assignedTo}>.`);
        }
        ticket.assignedTo = userId;
        ticket.updatedAt = Date.now();
        this.tickets.set(ticket.id, ticket);
        await this.update(ticket);
        try {
            const channel = await this.client?.channels.fetch(ticket.channelId).catch(() => null);
            if (channel) {
                await channel.send({
                    embeds: [(0, embed_1.brandedEmbed)(embed_1.BRAND.green).setTitle('🛡️ Ticket claimed').setDescription(`<@${userId}> is now handling this ticket.`)],
                    components: ticketButtons(ticket.id, ticket.status),
                }).catch(() => undefined);
            }
        }
        catch { /* best-effort */ }
        this.logger.info('Tickets Manager', `Assigned ticket ${ticketId} to ${userId}`);
    }
    async addMessageToTicket(ticketId, userId, content) {
        const ticket = await this.getTicket(ticketId);
        if (!ticket)
            throw new Error('Ticket not found');
        const channel = this.client?.channels.cache.get(ticket.channelId);
        if (channel && channel.type === discord_js_1.ChannelType.GuildText) {
            await channel.send(`**${userId}:** ${content}`);
        }
        ticket.updatedAt = Date.now();
        this.tickets.set(ticket.id, ticket);
        await this.update(ticket);
    }
    async assignTicket(ticketId, userId, assignedTo) {
        const ticket = await this.getTicket(ticketId);
        if (!ticket)
            throw new Error('Ticket not found');
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
    async getTicket(ticketId) {
        const cached = this.tickets.get(ticketId);
        if (cached)
            return cached;
        if (!this.db)
            return null;
        const rows = await this.db.select().from(schema_1.tickets).where((0, drizzle_orm_1.eq)(schema_1.tickets.id, ticketId)).limit(1);
        if (!rows[0])
            return null;
        const ticket = toTicket(rows[0]);
        this.tickets.set(ticket.id, ticket);
        return ticket;
    }
    async getUserTickets(userId, guildId) {
        if (!this.db) {
            return Array.from(this.tickets.values()).filter((t) => t.userId === userId && (!guildId || t.guildId === guildId));
        }
        const where = guildId
            ? (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.tickets.user_id, userId), (0, drizzle_orm_1.eq)(schema_1.tickets.guild_id, guildId))
            : (0, drizzle_orm_1.eq)(schema_1.tickets.user_id, userId);
        const rows = await this.db.select().from(schema_1.tickets).where(where).orderBy((0, drizzle_orm_1.desc)(schema_1.tickets.created_at));
        return rows.map(toTicket);
    }
    async getGuildTickets(guildId) {
        if (!this.db) {
            return Array.from(this.tickets.values()).filter((t) => t.guildId === guildId);
        }
        const rows = await this.db
            .select()
            .from(schema_1.tickets)
            .where((0, drizzle_orm_1.eq)(schema_1.tickets.guild_id, guildId))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.tickets.created_at));
        return rows.map(toTicket);
    }
    ticketFromChannel(channelId) {
        return Array.from(this.tickets.values()).find((t) => t.channelId === channelId);
    }
    async shutdown() {
        this.tickets.clear();
        this.logger.info('Tickets Manager', 'Tickets system shutdown successfully');
    }
}
exports.TicketsManager = TicketsManager;
/** Slash commands for tickets — /ticket create|close|claim|list */
class TicketsCommands {
    constructor(service, logger) {
        this.ticketCommand = {
            data: new (require('discord.js').SlashCommandBuilder)()
                .setName('ticket')
                .setDescription('Support tickets')
                .addSubcommand((sub) => sub.setName('create').setDescription('Open a support ticket')
                .addStringOption((o) => o.setName('category').setDescription('Ticket category').setRequired(false))
                .addStringOption((o) => o.setName('reason').setDescription('What do you need help with?').setRequired(false)))
                .addSubcommand((sub) => sub.setName('close').setDescription('Close this ticket')
                .addStringOption((o) => o.setName('reason').setDescription('Reason for closing').setRequired(false)))
                .addSubcommand((sub) => sub.setName('claim').setDescription('Claim this ticket (staff)'))
                .addSubcommand((sub) => sub.setName('list').setDescription('List open tickets'))
                .addSubcommand((sub) => sub.setName('panel').setDescription('Post a ticket panel (admin)')
                .addChannelOption((o) => o.setName('channel').setDescription('Channel to post in').setRequired(true).addChannelTypes(discord_js_1.ChannelType.GuildText))),
            execute: async (interaction) => {
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
                            embeds: [(0, embed_1.brandedEmbed)(embed_1.BRAND.green).setTitle('🎫 Ticket created').setDescription(`Your ticket is ready: <#${ticket?.channelId}>\n**ID:** \`${id}\``)],
                        });
                    }
                    else if (sub === 'close') {
                        const reason = interaction.options.getString('reason') || 'No reason provided';
                        const ticket = this.service.ticketFromChannel(interaction.channelId);
                        if (!ticket) {
                            await interaction.reply({ content: 'This is not a ticket channel.', flags: MessageFlags.Ephemeral }).catch(() => undefined);
                            return;
                        }
                        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                        await this.service.closeTicket(ticket.id, interaction.user.id, reason);
                        await interaction.editReply({ content: `🔒 Ticket \`${ticket.id}\` resolved.` });
                    }
                    else if (sub === 'claim') {
                        const ticket = this.service.ticketFromChannel(interaction.channelId);
                        if (!ticket) {
                            await interaction.reply({ content: 'This is not a ticket channel.', flags: MessageFlags.Ephemeral }).catch(() => undefined);
                            return;
                        }
                        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                        await this.service.claimTicket(ticket.id, interaction.user.id);
                        await interaction.editReply({ content: `🛡️ You claimed ticket \`${ticket.id}\`.` });
                    }
                    else if (sub === 'list') {
                        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                        const mine = await this.service.getUserTickets(interaction.user.id, guild.id);
                        const open = mine.filter((t) => t.status === 'open');
                        const embed = (0, embed_1.brandedEmbed)(embed_1.BRAND.blue).setTitle('🎫 Your tickets');
                        embed.setDescription(open.length ? open.map((t) => `• <#${t.channelId}> — **${t.category}** (\`${t.id}\`)`).join('\n') : 'You have no open tickets.');
                        await interaction.editReply({ embeds: [embed] });
                    }
                    else if (sub === 'panel') {
                        const channel = interaction.options.getChannel('channel', true);
                        const panel = await this.service.buildPanel(guild);
                        await channel.send({
                            components: panel.components,
                            files: panel.files,
                            flags: panel.flags,
                        }).catch(() => undefined);
                        await interaction.reply({ content: `✅ Ticket panel posted in ${channel}.`, flags: MessageFlags.Ephemeral }).catch(() => undefined);
                    }
                }
                catch (err) {
                    this.logger.error('Tickets Commands', `Failed /ticket ${sub}`, err);
                    const msg = `❌ ${err?.message || 'Failed.'}`;
                    if (interaction.deferred || interaction.replied) {
                        await interaction.editReply({ content: msg }).catch(() => undefined);
                    }
                    else {
                        await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral }).catch(() => undefined);
                    }
                }
            },
        };
        this.service = service;
        this.logger = logger;
    }
    getCommands() {
        return [this.ticketCommand];
    }
}
exports.TicketsCommands = TicketsCommands;
