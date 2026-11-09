"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ModerationService = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const schema_1 = require("../../database/schema");
class ModerationService {
    constructor(logger) {
        this.client = null;
        this.db = null;
        this.config = { enabled: true, logChannelId: '', defaultReason: '' };
        this.logger = logger;
    }
    setDb(db) {
        this.db = db;
    }
    async initialize(client) {
        this.client = client;
        this.logger.info('Moderation Service', 'Moderation system initialized');
    }
    async warn(guildId, userId, moderatorId, reason) {
        if (!this.config.enabled)
            throw new Error('Moderation system is disabled');
        if (!this.db)
            throw new Error('Database not connected');
        const caseId = `warn_${Date.now()}`;
        await this.db.insert(schema_1.warnings).values({
            id: caseId,
            guild_id: guildId,
            user_id: userId,
            moderator_id: moderatorId,
            reason,
        });
        await this.db.insert(schema_1.moderationCases).values({
            id: caseId,
            guild_id: guildId,
            user_id: userId,
            moderator_id: moderatorId,
            type: 'warn',
            reason,
        });
        this.logger.info('Moderation Service', `Warned user ${userId} in guild ${guildId}: ${reason}`);
        return caseId;
    }
    async kick(guildId, userId, moderatorId, reason) {
        if (!this.config.enabled)
            throw new Error('Moderation system is disabled');
        const caseId = `kick_${Date.now()}`;
        const guild = this.client?.guilds.cache.get(guildId);
        const member = guild ? await guild.members.fetch(userId).catch(() => null) : null;
        if (member) {
            await member.kick(reason);
        }
        if (this.db) {
            await this.db.insert(schema_1.moderationCases).values({
                id: caseId,
                guild_id: guildId,
                user_id: userId,
                moderator_id: moderatorId,
                type: 'kick',
                reason,
            });
        }
        this.logger.info('Moderation Service', `Kicked user ${userId} from guild ${guildId}: ${reason}`);
        return caseId;
    }
    async ban(guildId, userId, moderatorId, reason, deleteMessageDays = 0) {
        if (!this.config.enabled)
            throw new Error('Moderation system is disabled');
        const caseId = `ban_${Date.now()}`;
        const guild = this.client?.guilds.cache.get(guildId);
        if (guild) {
            await guild.members.ban(userId, { reason, deleteMessageDays });
        }
        if (this.db) {
            await this.db.insert(schema_1.moderationCases).values({
                id: caseId,
                guild_id: guildId,
                user_id: userId,
                moderator_id: moderatorId,
                type: 'ban',
                reason,
            });
        }
        this.logger.info('Moderation Service', `Banned user ${userId} from guild ${guildId}: ${reason}`);
        return caseId;
    }
    async mute(guildId, userId, moderatorId, reason, durationMinutes) {
        if (!this.config.enabled)
            throw new Error('Moderation system is disabled');
        const caseId = `mute_${Date.now()}`;
        const expiresAt = Date.now() + durationMinutes * 60 * 1000;
        const guild = this.client?.guilds.cache.get(guildId);
        const member = guild ? await guild.members.fetch(userId).catch(() => null) : null;
        if (member) {
            await member.timeout(durationMinutes * 60 * 1000, reason);
        }
        if (this.db) {
            await this.db.insert(schema_1.moderationCases).values({
                id: caseId,
                guild_id: guildId,
                user_id: userId,
                moderator_id: moderatorId,
                type: 'mute',
                reason,
                expires_at: expiresAt,
            });
        }
        this.logger.info('Moderation Service', `Muted user ${userId} in guild ${guildId}: ${reason}`);
        return caseId;
    }
    async getWarnings(guildId, userId) {
        if (!this.db)
            return [];
        return this.db.select().from(schema_1.warnings).where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.warnings.guild_id, guildId), (0, drizzle_orm_1.eq)(schema_1.warnings.user_id, userId)));
    }
    async getCases(guildId, userId) {
        if (!this.db)
            return [];
        if (userId) {
            return this.db.select().from(schema_1.moderationCases).where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.moderationCases.guild_id, guildId), (0, drizzle_orm_1.eq)(schema_1.moderationCases.user_id, userId)));
        }
        return this.db.select().from(schema_1.moderationCases).where((0, drizzle_orm_1.eq)(schema_1.moderationCases.guild_id, guildId));
    }
    async shutdown() {
        this.logger.info('Moderation Service', 'Moderation system shutdown');
    }
}
exports.ModerationService = ModerationService;
