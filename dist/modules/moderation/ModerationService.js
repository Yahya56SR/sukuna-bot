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
    setClient(client) {
        this.client = client;
    }
    async initialize(client) {
        this.client = client;
        this.logger.info('Moderation Service', 'Moderation system initialized');
    }
    resolveReason(reason) {
        const r = (reason ?? '').trim();
        return r || this.config.defaultReason || 'No reason provided';
    }
    async warn(guildId, userId, moderatorId, reason) {
        if (!this.config.enabled)
            throw new Error('Moderation system is disabled');
        if (!this.db)
            throw new Error('Database not connected');
        if (userId === moderatorId)
            throw new Error('You cannot warn yourself.');
        const finalReason = this.resolveReason(reason);
        const caseId = `warn_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        await this.db.insert(schema_1.warnings).values({
            id: caseId,
            guild_id: guildId,
            user_id: userId,
            moderator_id: moderatorId,
            reason: finalReason,
        });
        await this.db.insert(schema_1.moderationCases).values({
            id: caseId,
            guild_id: guildId,
            user_id: userId,
            moderator_id: moderatorId,
            type: 'warn',
            reason: finalReason,
        });
        this.logger.info('Moderation Service', `Warned user ${userId} in guild ${guildId}: ${finalReason}`);
        return caseId;
    }
    async kick(guildId, userId, moderatorId, reason) {
        if (!this.config.enabled)
            throw new Error('Moderation system is disabled');
        if (userId === moderatorId)
            throw new Error('You cannot kick yourself.');
        const finalReason = this.resolveReason(reason);
        const caseId = `kick_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const guild = this.client?.guilds.cache.get(guildId);
        const member = guild ? await guild.members.fetch(userId).catch(() => null) : null;
        if (!member)
            throw new Error('User not found in this server.');
        if (!member.kickable)
            throw new Error('Cannot kick this user (missing permissions or higher role).');
        await member.kick(finalReason);
        if (this.db) {
            await this.db.insert(schema_1.moderationCases).values({
                id: caseId,
                guild_id: guildId,
                user_id: userId,
                moderator_id: moderatorId,
                type: 'kick',
                reason: finalReason,
            });
        }
        this.logger.info('Moderation Service', `Kicked user ${userId} from guild ${guildId}: ${finalReason}`);
        return caseId;
    }
    async ban(guildId, userId, moderatorId, reason, deleteMessageDays = 0) {
        if (!this.config.enabled)
            throw new Error('Moderation system is disabled');
        if (userId === moderatorId)
            throw new Error('You cannot ban yourself.');
        const finalReason = this.resolveReason(reason);
        const days = Math.max(0, Math.min(7, Math.floor(deleteMessageDays) || 0));
        const caseId = `ban_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const guild = this.client?.guilds.cache.get(guildId);
        if (!guild)
            throw new Error('Server not found.');
        // Discord rejects banning the guild owner; surface a clear error
        if (guild.ownerId === userId)
            throw new Error('Cannot ban the server owner.');
        await guild.members.ban(userId, { reason: `Case ${caseId}: ${finalReason}`, deleteMessageDays: days });
        if (this.db) {
            await this.db.insert(schema_1.moderationCases).values({
                id: caseId,
                guild_id: guildId,
                user_id: userId,
                moderator_id: moderatorId,
                type: 'ban',
                reason: finalReason,
            });
        }
        this.logger.info('Moderation Service', `Banned user ${userId} from guild ${guildId}: ${finalReason}`);
        return caseId;
    }
    async mute(guildId, userId, moderatorId, reason, durationMinutes) {
        if (!this.config.enabled)
            throw new Error('Moderation system is disabled');
        if (userId === moderatorId)
            throw new Error('You cannot mute yourself.');
        const finalReason = this.resolveReason(reason);
        const minutes = Math.max(1, Math.min(40320, Math.floor(durationMinutes) || 60)); // 28 days max
        const caseId = `mute_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const guild = this.client?.guilds.cache.get(guildId);
        const member = guild ? await guild.members.fetch(userId).catch(() => null) : null;
        if (!member)
            throw new Error('User not found in this server.');
        if (!member.moderatable)
            throw new Error('Cannot mute this user (missing permissions or higher role).');
        await member.timeout(minutes * 60 * 1000, `Case ${caseId}: ${finalReason}`);
        if (this.db) {
            await this.db.insert(schema_1.moderationCases).values({
                id: caseId,
                guild_id: guildId,
                user_id: userId,
                moderator_id: moderatorId,
                type: 'mute',
                reason: finalReason,
                expires_at: Date.now() + minutes * 60 * 1000,
            });
        }
        this.logger.info('Moderation Service', `Muted user ${userId} in guild ${guildId}: ${finalReason} (${minutes}m)`);
        return caseId;
    }
    async unmute(guildId, userId, moderatorId, reason) {
        if (!this.config.enabled)
            throw new Error('Moderation system is disabled');
        const finalReason = this.resolveReason(reason);
        const caseId = `unmute_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const guild = this.client?.guilds.cache.get(guildId);
        const member = guild ? await guild.members.fetch(userId).catch(() => null) : null;
        if (!member)
            throw new Error('User not found in this server.');
        await member.timeout(null, `Case ${caseId}: ${finalReason}`);
        if (this.db) {
            await this.db.insert(schema_1.moderationCases).values({
                id: caseId, guild_id: guildId, user_id: userId, moderator_id: moderatorId, type: 'unmute', reason: finalReason,
            });
        }
        return caseId;
    }
    async unban(guildId, userId, moderatorId, reason) {
        if (!this.config.enabled)
            throw new Error('Moderation system is disabled');
        const finalReason = this.resolveReason(reason);
        const caseId = `unban_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const guild = this.client?.guilds.cache.get(guildId);
        if (!guild)
            throw new Error('Server not found.');
        await guild.members.unban(userId, `Case ${caseId}: ${finalReason}`).catch(() => undefined);
        if (this.db) {
            await this.db.insert(schema_1.moderationCases).values({
                id: caseId, guild_id: guildId, user_id: userId, moderator_id: moderatorId, type: 'unban', reason: finalReason,
            });
        }
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
