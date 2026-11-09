"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TicketsCommands = exports.TicketsManager = exports.TICKET_PREFIX = void 0;
exports.ticketButtons = ticketButtons;
exports.ticketWelcomeEmbed = ticketWelcomeEmbed;
const discord_js_1 = require("discord.js");
const embed_1 = require("../utils/embed");
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
class TicketsManager {
    constructor(logger, config) {
        this.client = null;
        this.tickets = new Map();
        this.logger = logger;
        this.config = config;
    }
    setConfig(config) {
        this.config = config;
    }
    getConfig() {
        return this.config;
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
    async createTicket(userId, guildId, category, reason = 'No reason provided') {
        if (!this.config.enabled) {
            throw new Error('Tickets system is disabled');
        }
        const id = Math.random().toString(36).slice(2, 9);
        const guild = this.client?.guilds.cache.get(guildId);
        if (!guild)
            throw new Error('Server not found.');
        const member = await guild.members.fetch(userId).catch(() => null);
        const username = member?.displayName ?? member?.user.username ?? 'user';
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
        catch (err) {
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
        const ticket = {
            id,
            guildId,
            userId,
            channelId: channel.id,
            category: category || 'general',
            status: 'open',
            assignedTo: '',
            closeReason: '',
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };
        this.tickets.set(id, ticket);
        // Welcome panel inside the ticket
        try {
            const embed = ticketWelcomeEmbed({ userId, category: ticket.category, ticketId: id, guildName: guild.name })
                .setFooter({ text: `Ticket ${id} • ${reason}` });
            if (reason && reason !== 'No reason provided') {
                embed.addFields({ name: 'Issue', value: reason.slice(0, 900) });
            }
            await channel.send({
                content: `<@${userId}>`,
                embeds: [embed],
                components: ticketButtons(id, 'open'),
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
        const ticket = this.tickets.get(ticketId);
        if (!ticket)
            throw new Error('Ticket not found');
        const guild = this.client?.guilds.cache.get(ticket.guildId);
        const allowed = ticket.userId === userId || byStaff || (await this.isSupport(guild, userId));
        if (!allowed) {
            throw new Error('You do not have permission to close this ticket');
        }
        ticket.status = 'resolved';
        ticket.closeReason = reason || 'No reason provided';
        ticket.updatedAt = Date.now();
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
        const ticket = this.tickets.get(ticketId);
        if (!ticket)
            throw new Error('Ticket not found');
        ticket.status = 'open';
        ticket.closeReason = '';
        ticket.updatedAt = Date.now();
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
        const ticket = this.tickets.get(ticketId);
        if (!ticket)
            throw new Error('Ticket not found');
        const guild = this.client?.guilds.cache.get(ticket.guildId);
        if (!(await this.isSupport(guild, userId)))
            throw new Error('Only staff can delete tickets.');
        const channel = await this.client?.channels.fetch(ticket.channelId).catch(() => null);
        if (channel?.deletable)
            await channel.delete().catch(() => undefined);
        this.tickets.delete(ticketId);
        this.logger.info('Tickets Manager', `Deleted ticket ${ticketId} by ${userId}`);
    }
    async claimTicket(ticketId, userId) {
        const ticket = this.tickets.get(ticketId);
        if (!ticket)
            throw new Error('Ticket not found');
        const guild = this.client?.guilds.cache.get(ticket.guildId);
        if (!(await this.isSupport(guild, userId)))
            throw new Error('Only staff can claim tickets.');
        ticket.assignedTo = userId;
        ticket.updatedAt = Date.now();
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
        const ticket = this.tickets.get(ticketId);
        if (!ticket)
            throw new Error('Ticket not found');
        const channel = this.client?.channels.cache.get(ticket.channelId);
        if (channel && channel.type === discord_js_1.ChannelType.GuildText) {
            await channel.send(`**${userId}:** ${content}`);
        }
        ticket.updatedAt = Date.now();
    }
    async assignTicket(ticketId, userId, assignedTo) {
        const ticket = this.tickets.get(ticketId);
        if (!ticket)
            throw new Error('Ticket not found');
        const guild = this.client?.guilds.cache.get(ticket.guildId);
        if (!(await this.isSupport(guild, userId))) {
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
    async getGuildTickets(guildId) {
        return Array.from(this.tickets.values()).filter(t => t.guildId === guildId);
    }
    ticketFromChannel(channelId) {
        return Array.from(this.tickets.values()).find(t => t.channelId === channelId);
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
                        // Defer first so closeTicket can post its notice without interaction issues
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
                        const mine = await this.service.getUserTickets(interaction.user.id);
                        const open = mine.filter(t => t.status === 'open');
                        const embed = (0, embed_1.brandedEmbed)(embed_1.BRAND.blue).setTitle('🎫 Your tickets');
                        embed.setDescription(open.length ? open.map(t => `• <#${t.channelId}> — **${t.category}** (\`${t.id}\`)`).join('\n') : 'You have no open tickets.');
                        await interaction.editReply({ embeds: [embed] });
                    }
                    else if (sub === 'panel') {
                        const channel = interaction.options.getChannel('channel', true);
                        const embed = (0, embed_1.brandedEmbed)(embed_1.BRAND.blue)
                            .setTitle('🎫 Need help? Open a ticket')
                            .setDescription('Click the button below and staff will pick it up in a private channel.\n\nYour ticket is only visible to you and staff.');
                        const row = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder().setCustomId('ticket:panel:create').setLabel('Open a ticket').setEmoji('🎫').setStyle(discord_js_1.ButtonStyle.Primary));
                        await channel.send({ embeds: [embed], components: [row] }).catch(() => undefined);
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
