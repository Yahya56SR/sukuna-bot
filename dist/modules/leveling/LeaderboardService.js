"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LeaderboardCommands = exports.LeaderboardService = exports.DEFAULT_LEADERBOARD_CONFIG = exports.BOARD_DEFINITIONS = exports.LEADERBOARD_BOARDS = void 0;
exports.normalizeBoard = normalizeBoard;
const discord_js_1 = require("discord.js");
const drizzle_orm_1 = require("drizzle-orm");
const schema_1 = require("../../database/schema");
const liveLeaderboard_1 = require("../../utils/liveLeaderboard");
const embed_1 = require("../../utils/embed");
const id_1 = require("../../utils/id");
exports.LEADERBOARD_BOARDS = ['members', 'staff'];
exports.BOARD_DEFINITIONS = {
    members: {
        board: 'members',
        track: 'member',
        title: 'Members Leaderboard',
        emoji: 'trophy',
        theme: {
            accentColor: 0x2b2d63,
            titleEmoji: 'trophy',
            scopeEmoji: 'members',
            scopeLabel: 'members',
            countMode: 'guild',
            zones: true,
        },
    },
    staff: {
        board: 'staff',
        track: 'staff',
        title: 'Staff Leaderboard',
        emoji: 'shield',
        theme: {
            accentColor: 0xef4444,
            titleEmoji: 'shield',
            scopeEmoji: 'staff',
            scopeLabel: 'staff team',
            countMode: 'ranked',
            zones: false,
        },
    },
};
function normalizeBoard(board) {
    const value = String(board ?? '').trim().toLowerCase();
    if (value === 'staff' || value === 'staffs' || value === 'staffboard')
        return 'staff';
    if (value === 'members' || value === 'member' || value === 'people')
        return 'members';
    return null;
}
exports.DEFAULT_LEADERBOARD_CONFIG = {
    enabled: true,
    refreshMinutes: 5,
    defaultRows: 25,
};
function toMs(value) {
    const n = Number(value);
    if (!Number.isFinite(n))
        return 0;
    if (n === 0)
        return 0;
    return n > 1e12 ? n : n * 1000;
}
function rowToBoard(row) {
    const board = normalizeBoard(row.board) ?? 'members';
    return {
        id: row.id,
        guildId: row.guild_id,
        board,
        channelId: row.channel_id,
        messageId: row.message_id ?? null,
        rows: Number(row.rows ?? exports.DEFAULT_LEADERBOARD_CONFIG.defaultRows),
        enabled: Boolean(row.enabled),
        createdAt: toMs(row.created_at),
        updatedAt: toMs(row.updated_at),
    };
}
/**
 * Owns the two leaderboards: rendering them, posting them into channels
 * and keeping the posted panels up to date.
 */
class LeaderboardService {
    constructor(logger, leveling, config) {
        this.db = null;
        this.client = null;
        this.timer = null;
        this.refreshing = false;
        this.logger = logger;
        this.leveling = leveling;
        this.config = { ...exports.DEFAULT_LEADERBOARD_CONFIG, ...(config ?? {}) };
    }
    getConfig() { return this.config; }
    setConfig(next) {
        this.config = { ...this.config, ...(next ?? {}) };
        this.restartScheduler();
        return this.config;
    }
    setDb(db) { this.db = db; }
    setClient(client) { this.client = client; }
    async initialize() {
        this.restartScheduler();
        this.logger.info('Leaderboard Service', `Leaderboards initialized (${exports.LEADERBOARD_BOARDS.join(' + ')}, refresh every ${this.config.refreshMinutes} min)`);
    }
    // ------------------------------------------------------------------
    // Rendering
    // ------------------------------------------------------------------
    definition(board) {
        return exports.BOARD_DEFINITIONS[board] ?? exports.BOARD_DEFINITIONS.members;
    }
    titleFor(guild, board) {
        return `${guild.name} • ${this.definition(board).title}`;
    }
    /** The leveling service behind the boards (rank + staff checks). */
    get levelingService() {
        return this.leveling;
    }
    /** Ranked entries of a board (staff refreshes first so the boards match the roles). */
    async entries(guild, board, limit) {
        const definition = this.definition(board);
        // Keep the stored track in sync with the live guild roles before reading.
        await this.leveling.refreshGuildTracks(guild.id).catch(() => undefined);
        const rows = Math.max(3, Math.min(100, limit ?? this.config.defaultRows));
        return (0, liveLeaderboard_1.collectEntries)(this.leveling, guild, rows, this.client, definition.track);
    }
    /**
     * Full message payload (components + podium artwork) for a board.
     *
     * `podium` is only used for the interactive commands — a live board in a
     * channel is refreshed with a component-only edit, so it never re-uploads
     * the artwork (and can never pile up attachments).
     */
    async payload(guild, board, rows, updatedAt = Date.now(), podium = true) {
        const definition = this.definition(board);
        const limit = Math.max(3, Math.min(100, rows ?? this.config.defaultRows));
        const entries = await this.entries(guild, board, limit);
        if (podium) {
            return (0, liveLeaderboard_1.buildMessagePayload)(entries, guild, limit, this.titleFor(guild, board), updatedAt, definition.theme);
        }
        return {
            components: [(0, liveLeaderboard_1.buildContentPanel)({
                    entries,
                    guild,
                    rows: limit,
                    title: this.titleFor(guild, board),
                    updatedAt,
                    theme: definition.theme,
                })],
            files: [],
            flags: discord_js_1.MessageFlags.IsComponentsV2,
        };
    }
    // ------------------------------------------------------------------
    // Live boards
    // ------------------------------------------------------------------
    async listBoards(guildId) {
        if (!this.db)
            return [];
        const rows = guildId
            ? await this.db.select().from(schema_1.leaderboardBoards).where((0, drizzle_orm_1.eq)(schema_1.leaderboardBoards.guild_id, guildId))
            : await this.db.select().from(schema_1.leaderboardBoards);
        return rows.map(rowToBoard);
    }
    async getBoard(guildId, board) {
        if (!this.db)
            return null;
        const rows = await this.db
            .select()
            .from(schema_1.leaderboardBoards)
            .where((0, drizzle_orm_1.sql) `${schema_1.leaderboardBoards.guild_id} = ${guildId} AND ${schema_1.leaderboardBoards.board} = ${board}`)
            .limit(1);
        return rows[0] ? rowToBoard(rows[0]) : null;
    }
    /**
     * Posts (or re-posts) a board in a channel and remembers the message so
     * it can be refreshed later.
     *
     * Reposting in the same channel re-uses the existing message; moving the
     * board to another channel deletes the old one so a server never ends up
     * with two copies of the same board.
     */
    async postBoard(guild, board, channelId, rows) {
        if (!this.db)
            throw new Error('Database not connected');
        const channel = await this.client?.channels.fetch(channelId).catch(() => null);
        if (!channel || channel.type !== discord_js_1.ChannelType.GuildText) {
            throw new Error('That channel is not a text channel.');
        }
        const limit = Math.max(3, Math.min(100, rows ?? this.config.defaultRows));
        const existing = await this.getBoard(guild.id, board);
        // Same channel → update the panel that is already there.
        if (existing?.messageId && existing.channelId === channelId) {
            const current = await channel.messages.fetch(existing.messageId).catch(() => null);
            if (current) {
                const payload = await this.payload(guild, board, limit, Date.now(), false);
                await current.edit({ components: payload.components }).catch(() => undefined);
                await this.db
                    .update(schema_1.leaderboardBoards)
                    .set({ rows: limit, enabled: true, updated_at: new Date() })
                    .where((0, drizzle_orm_1.sql) `${schema_1.leaderboardBoards.guild_id} = ${guild.id} AND ${schema_1.leaderboardBoards.board} = ${board}`);
                this.logger.info('Leaderboard Service', `Updated ${board} leaderboard in ${channelId} (${guild.name})`);
                return { ...existing, rows: limit, enabled: true };
            }
        }
        // The board moved → clean up the old message first.
        if (existing) {
            await this.deleteBoardMessage(existing);
        }
        // Live boards are text-only: a component edit is enough to refresh them.
        const payload = await this.payload(guild, board, limit, Date.now(), false);
        const message = await channel.send({
            components: payload.components,
            flags: payload.flags,
            allowedMentions: { parse: [] },
        });
        const now = new Date();
        const record = {
            id: existing?.id ?? (0, id_1.newId)('lbl'),
            guild_id: guild.id,
            board,
            channel_id: channelId,
            message_id: message.id,
            rows: limit,
            enabled: true,
            created_at: existing ? new Date(existing.createdAt || Date.now()) : now,
            updated_at: now,
        };
        await this.db
            .insert(schema_1.leaderboardBoards)
            .values(record)
            .onConflictDoUpdate({
            target: [schema_1.leaderboardBoards.guild_id, schema_1.leaderboardBoards.board],
            set: {
                channel_id: record.channel_id,
                message_id: record.message_id,
                rows: record.rows,
                enabled: true,
                updated_at: record.updated_at,
            },
        });
        this.logger.info('Leaderboard Service', `Posted ${board} leaderboard in ${channelId} (${guild.name})`);
        const saved = await this.getBoard(guild.id, board);
        return saved ?? rowToBoard(record);
    }
    /** Re-renders a posted board in place. */
    async refreshBoard(guild, board) {
        if (!this.db)
            return false;
        const live = await this.getBoard(guild.id, board);
        if (!live?.messageId)
            return false;
        const channel = await this.client?.channels.fetch(live.channelId).catch(() => null);
        if (!channel || channel.type !== discord_js_1.ChannelType.GuildText)
            return false;
        const message = await channel.messages.fetch(live.messageId).catch(() => null);
        if (!message) {
            this.logger.warn('Leaderboard Service', `Board message ${live.messageId} is gone — skipping refresh`);
            return false;
        }
        const payload = await this.payload(guild, board, live.rows, Date.now(), false);
        await message.edit({ components: payload.components }).catch(async (err) => {
            this.logger.warn('Leaderboard Service', `Board edit failed (${err.message}) — reposting`);
            await this.postBoard(guild, board, live.channelId, live.rows).catch(() => undefined);
        });
        await this.db
            .update(schema_1.leaderboardBoards)
            .set({ updated_at: new Date() })
            .where((0, drizzle_orm_1.sql) `${schema_1.leaderboardBoards.guild_id} = ${guild.id} AND ${schema_1.leaderboardBoards.board} = ${board}`);
        return true;
    }
    /** Deletes the message of a live board (best effort). */
    async deleteBoardMessage(live) {
        if (!live.messageId || !this.client)
            return;
        const channel = await this.client.channels.fetch(live.channelId).catch(() => null);
        if (!channel || !('messages' in channel))
            return;
        const message = await channel.messages.fetch(live.messageId).catch(() => null);
        await message?.delete().catch(() => undefined);
    }
    /** Removes a live board (and its message). */
    async removeBoard(guildId, board, deleteMessage = true) {
        if (!this.db)
            return false;
        const live = await this.getBoard(guildId, board);
        if (!live)
            return false;
        if (deleteMessage)
            await this.deleteBoardMessage(live);
        await this.db
            .delete(schema_1.leaderboardBoards)
            .where((0, drizzle_orm_1.sql) `${schema_1.leaderboardBoards.guild_id} = ${guildId} AND ${schema_1.leaderboardBoards.board} = ${board}`);
        this.logger.info('Leaderboard Service', `Removed ${board} leaderboard for guild ${guildId}`);
        return true;
    }
    /** Refreshes every enabled board (used by the scheduler). */
    async refreshAll() {
        if (this.refreshing || !this.config.enabled || !this.client)
            return 0;
        this.refreshing = true;
        let refreshed = 0;
        try {
            const boards = (await this.listBoards()).filter((b) => b.enabled);
            for (const live of boards) {
                const guild = this.client.guilds.cache.get(live.guildId);
                if (!guild)
                    continue;
                try {
                    if (await this.refreshBoard(guild, live.board))
                        refreshed++;
                }
                catch (err) {
                    this.logger.warn('Leaderboard Service', `Could not refresh ${live.board} board in ${live.guildId}: ${err.message}`);
                }
                // Small gap so several boards never hit the rate limit at once.
                await new Promise((resolve) => setTimeout(resolve, 1_000));
            }
        }
        catch (err) {
            this.logger.error('Leaderboard Service', 'Board refresh cycle failed', err);
        }
        finally {
            this.refreshing = false;
        }
        return refreshed;
    }
    restartScheduler() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        if (!this.config.enabled)
            return;
        const minutes = Math.max(1, Math.floor(this.config.refreshMinutes) || 5);
        this.timer = setInterval(() => {
            void this.refreshAll().catch((err) => {
                this.logger.error('Leaderboard Service', 'Scheduled refresh failed', err);
            });
        }, minutes * 60_000);
        this.timer?.unref?.();
    }
    async shutdown() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        this.logger.info('Leaderboard Service', 'Leaderboard service shutdown');
    }
}
exports.LeaderboardService = LeaderboardService;
/**
 * Slash commands for the two boards:
 *   /leaderboard  — the public members leaderboard
 *   /staffboard   — the staff leaderboard (staff only)
 *   /board        — manage the live boards (admin)
 */
class LeaderboardCommands {
    constructor(service, logger) {
        this.leaderboardCommand = {
            data: new discord_js_1.SlashCommandBuilder()
                .setName('leaderboard')
                .setDescription('View the members leaderboard')
                .addIntegerOption((option) => option.setName('limit').setDescription('Number of entries (default 10)').setMinValue(1).setMaxValue(25)),
            execute: async (interaction) => {
                await this.showBoard(interaction, 'members');
            },
        };
        this.staffboardCommand = {
            data: new discord_js_1.SlashCommandBuilder()
                .setName('staffboard')
                .setDescription('View the staff team leaderboard')
                .addIntegerOption((option) => option.setName('limit').setDescription('Number of entries (default 10)').setMinValue(1).setMaxValue(25)),
            execute: async (interaction) => {
                if (!interaction.guildId || !interaction.guild) {
                    await interaction.reply({ content: 'This command can only be used in a server.', flags: discord_js_1.MessageFlags.Ephemeral });
                    return;
                }
                const isStaff = await this.service.levelingService.isStaffMember(interaction.member);
                if (!isStaff) {
                    await interaction.reply({
                        embeds: [(0, embed_1.errorEmbed)('Staff only', 'The staff leaderboard is only visible to the staff team.')],
                        flags: discord_js_1.MessageFlags.Ephemeral,
                    });
                    return;
                }
                await this.showBoard(interaction, 'staff');
            },
        };
        this.boardCommand = {
            data: new discord_js_1.SlashCommandBuilder()
                .setName('board')
                .setDescription('Manage the live leaderboard panels')
                .setDefaultMemberPermissions(discord_js_1.PermissionFlagsBits.ManageGuild)
                .addSubcommand((sub) => sub
                .setName('post')
                .setDescription('Post a live leaderboard in a channel')
                .addStringOption((o) => o.setName('board').setDescription('Which leaderboard').setRequired(true)
                .addChoices({ name: 'Members', value: 'members' }, { name: 'Staff', value: 'staff' }))
                .addChannelOption((o) => o.setName('channel').setDescription('Channel to post the board in').setRequired(true).addChannelTypes(discord_js_1.ChannelType.GuildText))
                .addIntegerOption((o) => o.setName('rows').setDescription('How many ranks to show (default 25)').setMinValue(3).setMaxValue(100)))
                .addSubcommand((sub) => sub
                .setName('refresh')
                .setDescription('Refresh a live leaderboard now')
                .addStringOption((o) => o.setName('board').setDescription('Which leaderboard').setRequired(true)
                .addChoices({ name: 'Members', value: 'members' }, { name: 'Staff', value: 'staff' })))
                .addSubcommand((sub) => sub
                .setName('remove')
                .setDescription('Remove a live leaderboard')
                .addStringOption((o) => o.setName('board').setDescription('Which leaderboard').setRequired(true)
                .addChoices({ name: 'Members', value: 'members' }, { name: 'Staff', value: 'staff' })))
                .addSubcommand((sub) => sub.setName('list').setDescription('Show the live leaderboards of this server')),
            execute: async (interaction) => {
                if (!interaction.guild || !interaction.guildId) {
                    await interaction.reply({ content: 'This command can only be used in a server.', flags: discord_js_1.MessageFlags.Ephemeral });
                    return;
                }
                const sub = interaction.options.getSubcommand();
                try {
                    if (sub === 'post') {
                        const board = normalizeBoard(interaction.options.getString('board', true)) ?? 'members';
                        const channel = interaction.options.getChannel('channel', true);
                        const rows = interaction.options.getInteger('rows') ?? undefined;
                        await interaction.deferReply();
                        const live = await this.service.postBoard(interaction.guild, board, channel.id, rows);
                        await interaction.editReply({
                            embeds: [(0, embed_1.brandedEmbed)(embed_1.BRAND.green)
                                    .setTitle('✅ Leaderboard posted')
                                    .setDescription(`**Board:** ${this.service.definition(board).title}\n` +
                                    `**Channel:** <#${live.channelId}>\n` +
                                    `**Ranks shown:** ${live.rows}\n` +
                                    `The board refreshes every ${this.service.getConfig().refreshMinutes} minute(s).`)],
                        });
                        return;
                    }
                    if (sub === 'refresh') {
                        const board = normalizeBoard(interaction.options.getString('board', true)) ?? 'members';
                        await interaction.deferReply();
                        const ok = await this.service.refreshBoard(interaction.guild, board);
                        await interaction.editReply({
                            content: ok
                                ? `🔄 ${this.service.definition(board).title} refreshed.`
                                : `No live ${board} board is set up yet — use \`/board post\`.`,
                        });
                        return;
                    }
                    if (sub === 'remove') {
                        const board = normalizeBoard(interaction.options.getString('board', true)) ?? 'members';
                        const removed = await this.service.removeBoard(interaction.guildId, board);
                        await interaction.reply({
                            content: removed ? `🗑️ ${this.service.definition(board).title} removed.` : 'No live board was set up.',
                            flags: discord_js_1.MessageFlags.Ephemeral,
                        });
                        return;
                    }
                    if (sub === 'list') {
                        const boards = await this.service.listBoards(interaction.guildId);
                        const description = boards.length
                            ? boards.map((b) => {
                                const definition = this.service.definition(b.board);
                                return `${definition.emoji === 'shield' ? '🛡️' : '🏆'} **${definition.title}** — <#${b.channelId}> • ${b.rows} ranks • ${b.enabled ? '🟢 live' : '🔴 paused'}`;
                            }).join('\n')
                            : 'No live leaderboards yet. Use `/board post` to create one.';
                        await interaction.reply({
                            embeds: [(0, embed_1.brandedEmbed)(embed_1.BRAND.blue).setTitle('📋 Live Leaderboards').setDescription(description)],
                            flags: discord_js_1.MessageFlags.Ephemeral,
                        });
                    }
                }
                catch (error) {
                    this.logger.error('Leaderboard Commands', `Failed /board ${sub}`, error);
                    await this.replyError(interaction, error.message || 'Failed to manage the leaderboard.');
                }
            },
        };
        this.service = service;
        this.logger = logger;
    }
    getCommands() {
        return [this.leaderboardCommand, this.staffboardCommand, this.boardCommand];
    }
    /** Shared renderer for both boards. */
    async showBoard(interaction, board) {
        if (!interaction.guild || !interaction.guildId) {
            await interaction.reply({ content: 'This command can only be used in a server.', flags: discord_js_1.MessageFlags.Ephemeral });
            return;
        }
        const limit = interaction.options.getInteger('limit') ?? 10;
        try {
            const definition = this.service.definition(board);
            const entries = await this.service.entries(interaction.guild, board, limit);
            if (entries.length === 0) {
                await interaction.reply({
                    content: board === 'staff'
                        ? 'No staff members have earned XP yet.'
                        : 'No members have earned XP yet — chat to earn XP!',
                    flags: discord_js_1.MessageFlags.Ephemeral,
                });
                return;
            }
            await interaction.deferReply();
            const payload = await this.service.payload(interaction.guild, board, Math.max(10, limit));
            await interaction.editReply(payload).catch(async (err) => {
                this.logger.warn('Leaderboard Commands', `Panel send failed: ${err.message}`);
                const embed = (0, embed_1.brandedEmbed)(embed_1.BRAND.gold)
                    .setTitle(`${definition.emoji === 'shield' ? '🛡️' : '🏆'} ${definition.title}`)
                    .setDescription(entries
                    .map((entry, index) => {
                    const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `**${index + 1}.**`;
                    return `${medal} <@${entry.userId}> — level **${entry.level}** (\`${entry.totalXp.toLocaleString()}\` XP)`;
                })
                    .join('\n'));
                await interaction.editReply({ embeds: [embed] });
            });
        }
        catch (error) {
            this.logger.error('Leaderboard Commands', `Failed to get ${board} leaderboard`, error);
            await this.replyError(interaction, 'Failed to get the leaderboard.');
        }
    }
    async replyError(interaction, message) {
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ embeds: [(0, embed_1.errorEmbed)('Leaderboard', message)], flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => undefined);
        }
        else {
            await interaction.editReply({ content: message }).catch(() => undefined);
        }
    }
}
exports.LeaderboardCommands = LeaderboardCommands;
