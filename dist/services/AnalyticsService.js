"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AnalyticsService = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const schema_1 = require("../database/schema");
const EMPTY_STATS = {
    totalGuilds: 0,
    totalUsers: 0,
    totalMessages: 0,
    totalModerationCases: 0,
    totalWarnings: 0,
    totalTransactions: 0,
    openTickets: 0,
    totalLevelUps: 0,
    uptime: 0,
};
class AnalyticsService {
    constructor(logger) {
        this.db = null;
        this.config = { enabled: true, trackMessages: false };
        this.logger = logger;
        this.startTime = Date.now();
    }
    setDb(db) {
        this.db = db;
    }
    async initialize() {
        this.logger.info('Analytics Service', 'Analytics system initialized');
    }
    /** Record a message in the analytics stream (opt-in via config.trackMessages). */
    async trackMessage(guildId, channelId, authorId, content) {
        if (!this.db || !this.config.trackMessages)
            return;
        try {
            await this.db.insert(schema_1.messages).values({
                id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                guild_id: guildId,
                channel_id: channelId,
                author_id: authorId,
                content: content.slice(0, 2000),
                created_at: new Date(),
            });
        }
        catch (error) {
            this.logger.warn('Analytics Service', `Could not record message: ${error.message}`);
        }
    }
    async rowCount(table, where) {
        const query = where
            ? this.db.select({ value: (0, drizzle_orm_1.count)() }).from(table).where(where)
            : this.db.select({ value: (0, drizzle_orm_1.count)() }).from(table);
        const [row] = await query;
        return Number(row?.value ?? 0);
    }
    async getStats() {
        if (!this.db) {
            return { ...EMPTY_STATS, uptime: Date.now() - this.startTime };
        }
        const [totalGuilds, totalUsers, totalMessages, totalModerationCases, totalWarnings, totalTransactions, totalLevelUps, openTickets,] = await Promise.all([
            this.rowCount(schema_1.guilds),
            this.rowCount(schema_1.users),
            this.rowCount(schema_1.messages),
            this.rowCount(schema_1.moderationCases),
            this.rowCount(schema_1.warnings),
            this.rowCount(schema_1.economyTransactions),
            this.rowCount(schema_1.levelingHistory),
            this.rowCount(schema_1.tickets, (0, drizzle_orm_1.eq)(schema_1.tickets.status, 'open')),
        ]);
        return {
            totalGuilds,
            totalUsers,
            totalMessages,
            totalModerationCases,
            totalWarnings,
            totalTransactions,
            openTickets,
            totalLevelUps,
            uptime: Date.now() - this.startTime,
        };
    }
    async getGuildStats(guildId) {
        if (!this.db)
            return null;
        try {
            const [trackedMembers, guildMessages, cases, guildWarnings, guildLevelUps, guildOpenTickets, guildTransactions,] = await Promise.all([
                this.rowCount(schema_1.guildMembers, (0, drizzle_orm_1.eq)(schema_1.guildMembers.guild_id, guildId)),
                this.rowCount(schema_1.messages, (0, drizzle_orm_1.eq)(schema_1.messages.guild_id, guildId)),
                this.rowCount(schema_1.moderationCases, (0, drizzle_orm_1.eq)(schema_1.moderationCases.guild_id, guildId)),
                this.rowCount(schema_1.warnings, (0, drizzle_orm_1.eq)(schema_1.warnings.guild_id, guildId)),
                this.rowCount(schema_1.levelingHistory, (0, drizzle_orm_1.eq)(schema_1.levelingHistory.guild_id, guildId)),
                this.rowCount(schema_1.tickets, (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.tickets.guild_id, guildId), (0, drizzle_orm_1.eq)(schema_1.tickets.status, 'open'))),
                this.rowCount(schema_1.economyTransactions, (0, drizzle_orm_1.eq)(schema_1.economyTransactions.guild_id, guildId)),
            ]);
            const econRows = await this.db
                .select({
                accounts: (0, drizzle_orm_1.count)(),
                total: (0, drizzle_orm_1.sql) `coalesce(sum(${schema_1.economyAccounts.balance}), 0)`,
            })
                .from(schema_1.economyAccounts)
                .where((0, drizzle_orm_1.eq)(schema_1.economyAccounts.guild_id, guildId));
            const accounts = Number(econRows[0]?.accounts ?? 0);
            const total = Number(econRows[0]?.total ?? 0);
            return {
                guildId,
                trackedMembers,
                messages: guildMessages,
                moderationCases: cases,
                warnings: guildWarnings,
                levelUps: guildLevelUps,
                openTickets: guildOpenTickets,
                transactions: guildTransactions,
                economyAccounts: accounts,
                economyTotalBalance: total,
                economyAverageBalance: accounts > 0 ? total / accounts : 0,
            };
        }
        catch (error) {
            this.logger.warn('Analytics Service', `Could not build guild stats: ${error.message}`);
            return null;
        }
    }
    /** Per-day series for the last N days, bucketed in UTC. */
    async getActivitySeries(guildId, days = 14) {
        if (!this.db)
            return [];
        const safeDays = Math.max(1, Math.min(90, Math.floor(days)));
        try {
            const since = (0, drizzle_orm_1.sql) `(strftime('%s', 'now') - ${safeDays * 86400})`;
            const guildFilter = guildId ? (0, drizzle_orm_1.sql) `AND guild_id = ${guildId}` : (0, drizzle_orm_1.sql) ``;
            const messageRows = await this.db.all((0, drizzle_orm_1.sql) `
        SELECT strftime('%Y-%m-%d', created_at, 'unixepoch') AS day, count(*) AS value
        FROM messages
        WHERE created_at >= ${since} ${guildFilter}
        GROUP BY day
        ORDER BY day
      `);
            const caseRows = await this.db.all((0, drizzle_orm_1.sql) `
        SELECT strftime('%Y-%m-%d', created_at, 'unixepoch') AS day, count(*) AS value
        FROM moderation_cases
        WHERE created_at >= ${since} ${guildFilter}
        GROUP BY day
        ORDER BY day
      `);
            const byDay = new Map();
            for (const row of messageRows)
                byDay.set(row.day, { date: row.day, messages: Number(row.value), moderationCases: 0 });
            for (const row of caseRows) {
                const existing = byDay.get(row.day) ?? { date: row.day, messages: 0, moderationCases: 0 };
                existing.moderationCases = Number(row.value);
                byDay.set(row.day, existing);
            }
            return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
        }
        catch (error) {
            this.logger.warn('Analytics Service', `Could not build activity series: ${error.message}`);
            return [];
        }
    }
    async shutdown() {
        this.logger.info('Analytics Service', 'Analytics system shutdown');
    }
}
exports.AnalyticsService = AnalyticsService;
