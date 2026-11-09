"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AnalyticsService = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const schema_1 = require("../database/schema");
class AnalyticsService {
    constructor(logger) {
        this.db = null;
        this.config = { enabled: true };
        this.logger = logger;
        this.startTime = Date.now();
    }
    setDb(db) {
        this.db = db;
    }
    async initialize() {
        this.logger.info('Analytics Service', 'Analytics system initialized');
    }
    async getStats() {
        if (!this.db) {
            return {
                totalGuilds: 0,
                totalUsers: 0,
                totalMessages: 0,
                totalModerationCases: 0,
                totalWarnings: 0,
                totalTransactions: 0,
                openTickets: 0,
                totalLevelUps: 0,
                uptime: Date.now() - this.startTime,
            };
        }
        // `count()` produces SELECT count(*); selecting an id column and reading
        // `count` from the first row would only ever return the first row's id.
        const rowCount = async (table) => {
            const [row] = await this.db.select({ value: (0, drizzle_orm_1.count)() }).from(table);
            return Number(row?.value ?? 0);
        };
        const [totalGuilds, totalUsers, totalMessages, totalModerationCases, totalWarnings, totalTransactions, totalLevelUps, openTickets,] = await Promise.all([
            rowCount(schema_1.guilds),
            rowCount(schema_1.users),
            rowCount(schema_1.messages),
            rowCount(schema_1.moderationCases),
            rowCount(schema_1.warnings),
            rowCount(schema_1.economyTransactions),
            rowCount(schema_1.levelingHistory),
            this.db
                .select({ value: (0, drizzle_orm_1.count)() })
                .from(schema_1.tickets)
                .where((0, drizzle_orm_1.eq)(schema_1.tickets.status, 'open'))
                .then((rows) => Number(rows[0]?.value ?? 0)),
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
        const [guild] = await this.db.select().from(schema_1.guilds).where((0, drizzle_orm_1.eq)(schema_1.guilds.id, guildId));
        return guild || null;
    }
    async shutdown() {
        this.logger.info('Analytics Service', 'Analytics system shutdown');
    }
}
exports.AnalyticsService = AnalyticsService;
