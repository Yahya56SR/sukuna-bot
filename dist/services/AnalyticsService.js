"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AnalyticsService = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const schema_1 = require("../database/schema");
class AnalyticsService {
    constructor(logger) {
        this.db = null;
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
                uptime: Date.now() - this.startTime,
            };
        }
        const [guildCount] = await this.db.select({ count: schema_1.guilds.id }).from(schema_1.guilds);
        const [userCount] = await this.db.select({ count: schema_1.users.id }).from(schema_1.users);
        const [messageCount] = await this.db.select({ count: schema_1.messages.id }).from(schema_1.messages);
        const [modCount] = await this.db.select({ count: schema_1.moderationCases.id }).from(schema_1.moderationCases);
        return {
            totalGuilds: Number(guildCount?.count || 0),
            totalUsers: Number(userCount?.count || 0),
            totalMessages: Number(messageCount?.count || 0),
            totalModerationCases: Number(modCount?.count || 0),
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
