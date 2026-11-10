"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GiveawayCommands = exports.GiveawaysManager = exports.GIVEAWAY_PREFIX = void 0;
exports.giveawayButtons = giveawayButtons;
exports.parseDuration = parseDuration;
const discord_js_1 = require("discord.js");
const crypto_1 = require("crypto");
const drizzle_orm_1 = require("drizzle-orm");
const schema_1 = require("../database/schema");
const id_1 = require("../utils/id");
const embed_1 = require("../utils/embed");
exports.GIVEAWAY_PREFIX = 'giveaway:';
function giveawayButtons(giveawayId, status) {
    const row = new discord_js_1.ActionRowBuilder();
    if (status === 'active') {
        row.addComponents(new discord_js_1.ButtonBuilder().setCustomId(`${exports.GIVEAWAY_PREFIX}enter:${giveawayId}`).setLabel('Enter').setEmoji('🎉').setStyle(discord_js_1.ButtonStyle.Success), new discord_js_1.ButtonBuilder().setCustomId(`${exports.GIVEAWAY_PREFIX}leave:${giveawayId}`).setLabel('Leave').setStyle(discord_js_1.ButtonStyle.Secondary));
    }
    return [row];
}
function timestamp(ms) {
    return `<t:${Math.floor(ms / 1000)}:R>`;
}
/** Parse `10m`, `2h`, `1d`, `90s` or a raw number of seconds. */
function parseDuration(input) {
    const value = input.trim().toLowerCase();
    const match = value.match(/^(\d+)\s*(s|m|h|d)?$/);
    if (!match)
        return null;
    const amount = Number(match[1]);
    const unit = match[2] ?? 's';
    const seconds = unit === 's' ? amount : unit === 'm' ? amount * 60 : unit === 'h' ? amount * 3600 : amount * 86400;
    if (!Number.isFinite(seconds) || seconds <= 0)
        return null;
    return seconds;
}
function toGiveaway(row) {
    const status = row.status === 'ended' || row.status === 'cancelled' ? row.status : 'active';
    const endsAt = row.ends_at instanceof Date ? row.ends_at.getTime() : Number(row.ends_at ?? Date.now());
    const createdAt = row.created_at instanceof Date ? row.created_at.getTime() : Number(row.created_at ?? Date.now());
    const winnerIds = Array.isArray(row.winner_ids) ? row.winner_ids : [];
    const eligibleRoles = Array.isArray(row.required_roles) ? row.required_roles : [];
    return {
        id: row.id,
        guildId: row.guild_id,
        channelId: row.channel_id,
        messageId: row.message_id ?? '',
        hostId: row.host_id,
        prize: row.prize,
        description: row.description ?? '',
        status,
        endsAt,
        winnerIds,
        winnerCount: Number(row.winner_count ?? 1),
        eligibleRoles,
        entryCount: Number(row.entry_count ?? 0),
        prizeAmount: Number(row.prize_amount ?? 0),
        funded: Boolean(row.funded),
        createdAt,
    };
}
class GiveawaysManager {
    constructor(logger, config) {
        this.client = null;
        this.db = null;
        this.economy = null;
        this.giveaways = new Map();
        this.timers = new Map();
        this.logger = logger;
        this.config = config;
    }
    setDb(db) {
        this.db = db;
    }
    setEconomy(economy) {
        this.economy = economy;
    }
    async initialize(client) {
        try {
            this.client = client;
            this.giveaways.clear();
            for (const timer of this.timers.values())
                clearTimeout(timer);
            this.timers.clear();
            if (this.db) {
                const rows = await this.db.select().from(schema_1.giveaways).where((0, drizzle_orm_1.eq)(schema_1.giveaways.status, 'active'));
                const now = Date.now();
                for (const row of rows) {
                    const giveaway = toGiveaway(row);
                    this.giveaways.set(giveaway.id, giveaway);
                    if (giveaway.endsAt <= now) {
                        void this.endGiveaway(giveaway.id);
                    }
                    else {
                        this.scheduleEnd(giveaway);
                    }
                }
                this.logger.info('Giveaways Manager', `Loaded ${rows.length} active giveaway(s)`);
            }
            this.logger.info('Giveaways Manager', 'Giveaways system initialized successfully');
        }
        catch (error) {
            this.logger.error('Giveaways Manager', 'Giveaways system initialization failed', error);
            throw error;
        }
    }
    scheduleEnd(giveaway) {
        const existing = this.timers.get(giveaway.id);
        if (existing)
            clearTimeout(existing);
        const delay = giveaway.endsAt - Date.now();
        if (delay <= 0) {
            void this.endGiveaway(giveaway.id);
            return;
        }
        // setTimeout overflows above ~24.8 days; clamp and re-schedule on fire.
        const clamped = Math.min(delay, 2_147_483_647);
        const timer = setTimeout(() => {
            if (clamped < delay) {
                this.scheduleEnd(giveaway);
            }
            else {
                void this.endGiveaway(giveaway.id);
            }
        }, clamped);
        timer.unref?.();
        this.timers.set(giveaway.id, timer);
    }
    async persist(giveaway) {
        if (!this.db)
            return;
        await this.db.insert(schema_1.giveaways).values({
            id: giveaway.id,
            guild_id: giveaway.guildId,
            channel_id: giveaway.channelId,
            message_id: giveaway.messageId || null,
            host_id: giveaway.hostId,
            prize: giveaway.prize,
            description: giveaway.description || null,
            status: giveaway.status,
            ends_at: new Date(giveaway.endsAt),
            winner_count: giveaway.winnerCount,
            winner_ids: giveaway.winnerIds,
            required_roles: giveaway.eligibleRoles,
            entry_count: giveaway.entryCount,
            prize_amount: giveaway.prizeAmount,
            funded: giveaway.funded,
            created_at: new Date(giveaway.createdAt),
        });
    }
    async save(giveaway) {
        if (!this.db)
            return;
        await this.db
            .update(schema_1.giveaways)
            .set({
            message_id: giveaway.messageId || null,
            status: giveaway.status,
            winner_ids: giveaway.winnerIds,
            entry_count: giveaway.entryCount,
            funded: giveaway.funded,
        })
            .where((0, drizzle_orm_1.eq)(schema_1.giveaways.id, giveaway.id));
    }
    async countEntries(giveawayId) {
        if (!this.db)
            return 0;
        const row = await this.db.get((0, drizzle_orm_1.sql) `
      SELECT COUNT(*) as c FROM giveaway_entries WHERE giveaway_id = ${giveawayId}
    `);
        return Number(row?.c ?? 0);
    }
    buildEmbed(giveaway) {
        const ended = giveaway.status !== 'active';
        const embed = new discord_js_1.EmbedBuilder()
            .setColor(ended ? '#00ff00' : '#ffd700')
            .setTitle(ended ? '🎉 Giveaway Ended!' : '🎉 Giveaway!')
            .setDescription(`**Prize:** ${giveaway.prize}\n` +
            (giveaway.description ? `**Description:** ${giveaway.description}\n` : '') +
            (giveaway.prizeAmount > 0 ? `**Prize pool:** ${(0, embed_1.formatNumber)(giveaway.prizeAmount)} coins\n` : '') +
            `**Hosted by:** <@${giveaway.hostId}>\n` +
            (ended ? '' : `**Ends:** ${timestamp(giveaway.endsAt)}\n`) +
            `**Entries:** ${(0, embed_1.formatNumber)(giveaway.entryCount)}`)
            .setFooter({ text: ended ? `Giveaway ${giveaway.id}` : 'Click Enter to participate!' });
        if (giveaway.eligibleRoles.length > 0) {
            embed.addFields({ name: 'Required roles', value: giveaway.eligibleRoles.map((r) => `<@&${r}>`).join(', ') });
        }
        if (ended && giveaway.winnerIds.length > 0) {
            embed.addFields({ name: 'Winners', value: giveaway.winnerIds.map((id) => `<@${id}>`).join(', ') });
        }
        else if (ended) {
            embed.addFields({ name: 'Winners', value: 'No valid entries.' });
        }
        return embed.setTimestamp();
    }
    async sendGiveawayMessage(channel, giveaway) {
        const message = await channel.send({
            embeds: [this.buildEmbed(giveaway)],
            components: giveawayButtons(giveaway.id, giveaway.status),
        });
        giveaway.messageId = message.id;
        await this.save(giveaway);
    }
    async updateMessage(giveaway) {
        if (!this.client || !giveaway.messageId)
            return;
        try {
            const channel = await this.client.channels.fetch(giveaway.channelId).catch(() => null);
            if (!channel || channel.type !== discord_js_1.ChannelType.GuildText)
                return;
            const message = await channel.messages.fetch(giveaway.messageId).catch(() => null);
            if (!message)
                return;
            await message.edit({
                embeds: [this.buildEmbed(giveaway)],
                components: giveawayButtons(giveaway.id, giveaway.status),
            });
        }
        catch { /* best-effort */ }
    }
    async createGiveaway(guildId, hostId, channelId, prize, description, durationSeconds, eligibleRoles = [], options = {}) {
        if (!this.config.enabled)
            throw new Error('Giveaways system is disabled');
        if (!Number.isFinite(durationSeconds) || durationSeconds < 10)
            throw new Error('Duration must be at least 10 seconds.');
        if (!prize.trim())
            throw new Error('A prize is required.');
        const guild = this.client?.guilds.cache.get(guildId);
        if (!guild)
            throw new Error('Server not found.');
        const channel = this.client?.channels.cache.get(channelId) ?? await this.client?.channels.fetch(channelId).catch(() => null);
        if (!channel || channel.type !== discord_js_1.ChannelType.GuildText)
            throw new Error('Giveaway channel not found.');
        if (!channel.permissionsFor(this.client.user)?.has(discord_js_1.PermissionFlagsBits.SendMessages)) {
            throw new Error('I cannot send messages in that channel.');
        }
        const winnerCount = Math.max(1, Math.min(this.config.maxWinners || 20, Math.floor(options.winnerCount ?? this.config.minWinners ?? 1)));
        const prizeAmount = Math.max(0, Math.floor(options.prizeAmount ?? 0));
        if (prizeAmount > 0 && !this.economy)
            throw new Error('Economy is not available for cash prizes.');
        if (prizeAmount > 0 && this.economy) {
            const result = await this.economy.debit(guildId, hostId, prizeAmount, {
                type: 'game',
                description: `Giveaway escrow: ${prize}`,
            });
            if (!result.success)
                throw new Error('You do not have enough balance to fund this giveaway.');
        }
        const now = Date.now();
        const giveaway = {
            id: (0, id_1.shortId)('g'),
            guildId,
            channelId,
            messageId: '',
            hostId,
            prize: prize.trim(),
            description: description.trim(),
            status: 'active',
            endsAt: now + durationSeconds * 1000,
            winnerIds: [],
            winnerCount,
            eligibleRoles,
            entryCount: 0,
            prizeAmount,
            funded: prizeAmount > 0,
            createdAt: now,
        };
        this.giveaways.set(giveaway.id, giveaway);
        try {
            await this.persist(giveaway);
        }
        catch (error) {
            this.giveaways.delete(giveaway.id);
            if (prizeAmount > 0 && this.economy) {
                await this.economy.credit(guildId, hostId, prizeAmount, {
                    type: 'adjustment',
                    description: `Refund: giveaway creation failed (${prize})`,
                }).catch(() => undefined);
            }
            throw error;
        }
        try {
            await this.sendGiveawayMessage(channel, giveaway);
        }
        catch (error) {
            this.logger.warn('Giveaways Manager', `Failed to post giveaway ${giveaway.id}: ${error.message}`);
        }
        this.scheduleEnd(giveaway);
        this.logger.info('Giveaways Manager', `Created giveaway ${giveaway.id}: ${prize}`);
        return giveaway.id;
    }
    async getGiveaway(giveawayId) {
        const cached = this.giveaways.get(giveawayId);
        if (cached)
            return cached;
        if (!this.db)
            return null;
        const rows = await this.db.select().from(schema_1.giveaways).where((0, drizzle_orm_1.eq)(schema_1.giveaways.id, giveawayId)).limit(1);
        if (!rows[0])
            return null;
        const giveaway = toGiveaway(rows[0]);
        this.giveaways.set(giveaway.id, giveaway);
        return giveaway;
    }
    memberRoleIds(member) {
        const r = member?.roles;
        if (!r)
            return [];
        // discord.js GuildMember: roles.cache is a Collection of role ids.
        if (typeof r.cache?.keys === 'function')
            return [...r.cache.keys()];
        // APIInteractionGuildMember: roles is a plain array of role id strings.
        if (Array.isArray(r))
            return r.map(String);
        return [];
    }
    async enterGiveaway(giveawayId, userId, member) {
        const giveaway = await this.getGiveaway(giveawayId);
        if (!giveaway)
            return { ok: false, message: 'Giveaway not found.' };
        if (giveaway.status !== 'active')
            return { ok: false, message: 'This giveaway has already ended.' };
        if (giveaway.endsAt <= Date.now())
            return { ok: false, message: 'This giveaway has already ended.' };
        if (giveaway.eligibleRoles.length > 0) {
            const roleIds = this.memberRoleIds(member);
            if (!giveaway.eligibleRoles.some((rid) => roleIds.includes(rid))) {
                return { ok: false, message: 'You do not have a role required to enter this giveaway.' };
            }
        }
        if (this.db) {
            const result = await this.db.insert(schema_1.giveawayEntries).values({
                giveaway_id: giveaway.id,
                user_id: userId,
                entered_at: new Date(),
            }).onConflictDoNothing().run();
            const changes = Number(result.changes ?? 0);
            if (changes === 0)
                return { ok: false, message: 'You are already entered in this giveaway.' };
            giveaway.entryCount = await this.countEntries(giveaway.id);
        }
        else {
            giveaway.entryCount += 1;
        }
        await this.save(giveaway);
        await this.updateMessage(giveaway);
        return { ok: true, message: 'You are entered! Good luck 🎉' };
    }
    async leaveGiveaway(giveawayId, userId) {
        const giveaway = await this.getGiveaway(giveawayId);
        if (!giveaway)
            return { ok: false, message: 'Giveaway not found.' };
        if (giveaway.status !== 'active')
            return { ok: false, message: 'This giveaway has already ended.' };
        if (!this.db) {
            giveaway.entryCount = Math.max(0, giveaway.entryCount - 1);
            return { ok: true, message: 'You have left the giveaway.' };
        }
        const result = await this.db
            .delete(schema_1.giveawayEntries)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.giveawayEntries.giveaway_id, giveaway.id), (0, drizzle_orm_1.eq)(schema_1.giveawayEntries.user_id, userId)))
            .run();
        const changes = Number(result.changes ?? 0);
        if (changes === 0)
            return { ok: false, message: 'You are not entered in this giveaway.' };
        giveaway.entryCount = await this.countEntries(giveaway.id);
        await this.save(giveaway);
        await this.updateMessage(giveaway);
        return { ok: true, message: 'You have left the giveaway.' };
    }
    async pickWinners(giveawayId, count) {
        if (!this.db)
            return [];
        const rows = await this.db
            .select({ user_id: schema_1.giveawayEntries.user_id })
            .from(schema_1.giveawayEntries)
            .where((0, drizzle_orm_1.eq)(schema_1.giveawayEntries.giveaway_id, giveawayId));
        const pool = rows.map((r) => r.user_id);
        const winners = [];
        while (winners.length < count && pool.length > 0) {
            const index = (0, crypto_1.randomInt)(pool.length);
            const [picked] = pool.splice(index, 1);
            if (picked && !winners.includes(picked))
                winners.push(picked);
        }
        return winners;
    }
    async endGiveaway(giveawayId, endedBy) {
        const giveaway = await this.getGiveaway(giveawayId);
        if (!giveaway || giveaway.status !== 'active')
            return;
        const timer = this.timers.get(giveaway.id);
        if (timer)
            clearTimeout(timer);
        this.timers.delete(giveaway.id);
        giveaway.status = 'ended';
        giveaway.entryCount = await this.countEntries(giveaway.id);
        giveaway.winnerIds = await this.pickWinners(giveaway.id, Math.min(giveaway.winnerCount, Math.max(1, giveaway.entryCount)));
        // Pay out funded prizes from escrow; never mint new money.
        if (giveaway.funded && giveaway.prizeAmount > 0 && this.economy) {
            if (giveaway.winnerIds.length > 0) {
                const share = Math.floor((giveaway.prizeAmount / giveaway.winnerIds.length) * 100) / 100;
                let remaining = giveaway.prizeAmount;
                for (let i = 0; i < giveaway.winnerIds.length; i++) {
                    const winnerId = giveaway.winnerIds[i];
                    const amount = i === giveaway.winnerIds.length - 1 ? Math.floor(remaining * 100) / 100 : share;
                    remaining = Math.floor((remaining - amount) * 100) / 100;
                    if (amount > 0) {
                        await this.economy.credit(giveaway.guildId, winnerId, amount, {
                            type: 'game',
                            description: `Giveaway prize: ${giveaway.prize}`,
                            reference: giveaway.id,
                        }).catch((error) => this.logger.warn('Giveaways Manager', `Prize payout failed: ${error.message}`));
                    }
                }
            }
            else {
                // Nobody entered — return the escrow to the host.
                await this.economy.credit(giveaway.guildId, giveaway.hostId, giveaway.prizeAmount, {
                    type: 'adjustment',
                    description: `Giveaway refund (no entries): ${giveaway.prize}`,
                    reference: giveaway.id,
                }).catch(() => undefined);
            }
        }
        await this.save(giveaway);
        await this.updateMessage(giveaway);
        try {
            const channel = await this.client?.channels.fetch(giveaway.channelId).catch(() => null);
            if (channel && channel.type === discord_js_1.ChannelType.GuildText) {
                const winners = giveaway.winnerIds.length
                    ? giveaway.winnerIds.map((id) => `<@${id}>`).join(', ')
                    : 'No valid entries.';
                await channel.send({
                    content: `🎉 **${giveaway.prize}** — winners: ${winners}${endedBy ? `\nEnded by <@${endedBy}>` : ''}`,
                    allowedMentions: { users: giveaway.winnerIds },
                });
            }
        }
        catch { /* best-effort */ }
        this.logger.info('Giveaways Manager', `Giveaway ${giveawayId} ended with winners: ${giveaway.winnerIds.join(', ') || 'none'}`);
    }
    async rerollGiveaway(giveawayId) {
        const giveaway = await this.getGiveaway(giveawayId);
        if (!giveaway)
            throw new Error('Giveaway not found.');
        if (giveaway.status !== 'ended')
            throw new Error('Only ended giveaways can be rerolled.');
        if (giveaway.funded && giveaway.prizeAmount > 0) {
            throw new Error('Funded giveaways cannot be rerolled because the prize was already paid out.');
        }
        const winners = await this.pickWinners(giveaway.id, giveaway.winnerCount);
        giveaway.winnerIds = winners;
        await this.save(giveaway);
        await this.updateMessage(giveaway);
        this.logger.info('Giveaways Manager', `Rerolled ${giveawayId}: ${winners.join(', ') || 'none'}`);
        return winners;
    }
    async cancelGiveaway(giveawayId, userId) {
        const giveaway = await this.getGiveaway(giveawayId);
        if (!giveaway)
            throw new Error('Giveaway not found.');
        if (giveaway.status !== 'active')
            throw new Error('This giveaway is no longer active.');
        if (giveaway.hostId !== userId) {
            const guild = this.client?.guilds.cache.get(giveaway.guildId);
            const member = guild ? await guild.members.fetch(userId).catch(() => null) : null;
            if (!member?.permissions.has(discord_js_1.PermissionFlagsBits.ManageGuild)) {
                throw new Error('Only the host or a server manager can cancel this giveaway.');
            }
        }
        const timer = this.timers.get(giveaway.id);
        if (timer)
            clearTimeout(timer);
        this.timers.delete(giveaway.id);
        giveaway.status = 'cancelled';
        giveaway.winnerIds = [];
        if (giveaway.funded && giveaway.prizeAmount > 0 && this.economy) {
            await this.economy.credit(giveaway.guildId, giveaway.hostId, giveaway.prizeAmount, {
                type: 'adjustment',
                description: `Giveaway cancelled, escrow refunded: ${giveaway.prize}`,
                reference: giveaway.id,
            }).catch(() => undefined);
        }
        await this.save(giveaway);
        await this.updateMessage(giveaway);
        this.logger.info('Giveaways Manager', `Cancelled giveaway ${giveawayId}`);
    }
    async listGiveaways(guildId) {
        if (!this.db)
            return Array.from(this.giveaways.values()).filter((g) => g.guildId === guildId);
        const rows = await this.db.select().from(schema_1.giveaways).where((0, drizzle_orm_1.eq)(schema_1.giveaways.guild_id, guildId));
        return rows.map(toGiveaway).sort((a, b) => b.createdAt - a.createdAt);
    }
    async shutdown() {
        for (const timer of this.timers.values())
            clearTimeout(timer);
        this.timers.clear();
        this.giveaways.clear();
        this.logger.info('Giveaways Manager', 'Giveaways system shutdown successfully');
    }
}
exports.GiveawaysManager = GiveawaysManager;
class GiveawayCommands {
    constructor(service, logger) {
        this.giveawayCommand = {
            data: new discord_js_1.SlashCommandBuilder()
                .setName('giveaway')
                .setDescription('Create and manage giveaways')
                .addSubcommand((sub) => sub
                .setName('create')
                .setDescription('Start a giveaway')
                .addStringOption((o) => o.setName('prize').setDescription('What is being given away?').setRequired(true))
                .addStringOption((o) => o.setName('duration').setDescription('e.g. 10m, 2h, 1d').setRequired(true))
                .addChannelOption((o) => o.setName('channel').setDescription('Channel to post in').addChannelTypes(discord_js_1.ChannelType.GuildText))
                .addIntegerOption((o) => o.setName('winners').setDescription('Number of winners').setMinValue(1).setMaxValue(20))
                .addIntegerOption((o) => o.setName('prize_pool').setDescription('Coins funded by you as the prize pool').setMinValue(0))
                .addStringOption((o) => o.setName('description').setDescription('Extra details'))
                .addRoleOption((o) => o.setName('required_role').setDescription('Role required to enter')))
                .addSubcommand((sub) => sub.setName('end').setDescription('End a giveaway now').addStringOption((o) => o.setName('id').setDescription('Giveaway id').setRequired(true)))
                .addSubcommand((sub) => sub.setName('reroll').setDescription('Draw new winners for an ended giveaway').addStringOption((o) => o.setName('id').setDescription('Giveaway id').setRequired(true)))
                .addSubcommand((sub) => sub.setName('cancel').setDescription('Cancel a giveaway and refund escrow').addStringOption((o) => o.setName('id').setDescription('Giveaway id').setRequired(true)))
                .addSubcommand((sub) => sub.setName('list').setDescription('List giveaways in this server')),
            execute: async (interaction) => {
                const guildId = interaction.guildId;
                if (!guildId) {
                    await interaction.reply({ content: 'This command can only be used in a server.', flags: discord_js_1.MessageFlags.Ephemeral });
                    return;
                }
                const sub = interaction.options.getSubcommand();
                try {
                    if (sub === 'create') {
                        if (!interaction.memberPermissions?.has(discord_js_1.PermissionFlagsBits.ManageGuild)) {
                            await interaction.reply({ content: 'You need Manage Server to create giveaways.', flags: discord_js_1.MessageFlags.Ephemeral });
                            return;
                        }
                        const prize = interaction.options.getString('prize', true);
                        const durationRaw = interaction.options.getString('duration', true);
                        const seconds = parseDuration(durationRaw);
                        if (!seconds) {
                            await interaction.reply({ content: 'Invalid duration. Use formats like `10m`, `2h` or `1d`.', flags: discord_js_1.MessageFlags.Ephemeral });
                            return;
                        }
                        const channel = interaction.options.getChannel('channel') ?? interaction.channel;
                        if (!channel || channel.type !== discord_js_1.ChannelType.GuildText) {
                            await interaction.reply({ content: 'Please choose a text channel.', flags: discord_js_1.MessageFlags.Ephemeral });
                            return;
                        }
                        const winnerCount = interaction.options.getInteger('winners') ?? undefined;
                        const prizeAmount = interaction.options.getInteger('prize_pool') ?? 0;
                        const description = interaction.options.getString('description') ?? '';
                        const role = interaction.options.getRole('required_role');
                        await interaction.deferReply({ flags: discord_js_1.MessageFlags.Ephemeral });
                        const id = await this.service.createGiveaway(guildId, interaction.user.id, channel.id, prize, description, seconds, role ? [role.id] : [], { ...(winnerCount !== undefined ? { winnerCount } : {}), prizeAmount });
                        await interaction.editReply({ content: `🎉 Giveaway created in <#${channel.id}> (\`${id}\`).` });
                        return;
                    }
                    if (sub === 'list') {
                        const rows = await this.service.listGiveaways(guildId);
                        const active = rows.filter((g) => g.status === 'active');
                        const description = active.length
                            ? active.map((g) => `• \`${g.id}\` — **${g.prize}** • ${timestamp(g.endsAt)} • <#${g.channelId}>`).join('\n')
                            : 'No active giveaways.';
                        await interaction.reply({
                            embeds: [new discord_js_1.EmbedBuilder().setColor('#ffd700').setTitle('🎉 Active giveaways').setDescription(description)],
                            flags: discord_js_1.MessageFlags.Ephemeral,
                        });
                        return;
                    }
                    const id = (interaction.options.getString('id', true) ?? '').trim();
                    if (sub === 'end') {
                        if (!interaction.memberPermissions?.has(discord_js_1.PermissionFlagsBits.ManageGuild)) {
                            await interaction.reply({ content: 'You need Manage Server to end giveaways.', flags: discord_js_1.MessageFlags.Ephemeral });
                            return;
                        }
                        await interaction.deferReply({ flags: discord_js_1.MessageFlags.Ephemeral });
                        await this.service.endGiveaway(id, interaction.user.id);
                        await interaction.editReply({ content: `✅ Giveaway \`${id}\` ended.` });
                    }
                    else if (sub === 'reroll') {
                        if (!interaction.memberPermissions?.has(discord_js_1.PermissionFlagsBits.ManageGuild)) {
                            await interaction.reply({ content: 'You need Manage Server to reroll giveaways.', flags: discord_js_1.MessageFlags.Ephemeral });
                            return;
                        }
                        await interaction.deferReply({ flags: discord_js_1.MessageFlags.Ephemeral });
                        const winners = await this.service.rerollGiveaway(id);
                        await interaction.editReply({ content: winners.length ? `🎲 New winners: ${winners.map((w) => `<@${w}>`).join(', ')}` : 'No entries to draw from.' });
                    }
                    else if (sub === 'cancel') {
                        await interaction.deferReply({ flags: discord_js_1.MessageFlags.Ephemeral });
                        await this.service.cancelGiveaway(id, interaction.user.id);
                        await interaction.editReply({ content: `🗑️ Giveaway \`${id}\` cancelled.` });
                    }
                }
                catch (error) {
                    this.logger.error('Giveaway Commands', `Failed /giveaway ${sub}`, error);
                    const message = `❌ ${error.message}`;
                    if (interaction.deferred || interaction.replied)
                        await interaction.editReply({ content: message }).catch(() => undefined);
                    else
                        await interaction.reply({ content: message, flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
                }
            },
        };
        this.service = service;
        this.logger = logger;
    }
    getCommands() {
        return [this.giveawayCommand];
    }
}
exports.GiveawayCommands = GiveawayCommands;
