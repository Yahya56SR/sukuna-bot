"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ModerationService = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const schema_1 = require("../../database/schema");
const embed_1 = require("../../utils/embed");
const id_1 = require("../../utils/id");
class ModerationService {
    constructor(logger) {
        this.client = null;
        this.db = null;
        this.config = {
            enabled: true,
            logChannelId: '',
            defaultReason: '',
            warnThreshold: 0,
            warnThresholdDuration: 60,
        };
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
    assertEnabled() {
        if (!this.config.enabled)
            throw new Error('Moderation system is disabled');
    }
    /** Per-guild kill switch: an explicit moderation_enabled=false row in guild_settings wins. */
    async assertGuildEnabled(guildId) {
        if (!this.db)
            return;
        try {
            const rows = await this.db
                .select({ moderation_enabled: schema_1.guildSettings.moderation_enabled })
                .from(schema_1.guildSettings)
                .where((0, drizzle_orm_1.eq)(schema_1.guildSettings.guild_id, guildId))
                .limit(1);
            const row = rows[0];
            if (row && row.moderation_enabled === false) {
                throw new Error('Moderation is disabled for this server (guild settings).');
            }
        }
        catch (error) {
            if (error instanceof Error && error.message.includes('disabled for this server'))
                throw error;
            // Settings unreadable — fail open rather than blocking moderation.
        }
    }
    getGuild(guildId) {
        const guild = this.client?.guilds.cache.get(guildId);
        if (!guild)
            throw new Error('Server not found.');
        return guild;
    }
    async fetchMember(guild, userId) {
        const cached = guild.members.cache.get(userId);
        if (cached)
            return cached;
        return guild.members.fetch(userId).catch(() => null);
    }
    /**
     * Validates that `moderatorId` may act on `userId`:
     * - no self-moderation
     * - neither the guild owner nor the bot may be targeted
     * - the moderator must outrank the target (unless they are the owner)
     * - the bot itself must outrank the target
     */
    async assertCanAct(guild, moderatorId, userId, action, requireMember) {
        if (moderatorId === userId)
            throw new Error(`You cannot ${action} yourself.`);
        if (userId === guild.ownerId)
            throw new Error(`Cannot ${action} the server owner.`);
        if (this.client?.user && userId === this.client.user.id)
            throw new Error(`Cannot ${action} the bot.`);
        const [moderator, target] = await Promise.all([
            this.fetchMember(guild, moderatorId),
            this.fetchMember(guild, userId),
        ]);
        if (!moderator)
            throw new Error('Could not resolve your membership in this server.');
        if (!target) {
            if (requireMember)
                throw new Error('User not found in this server.');
            return null;
        }
        const isOwner = moderator.id === guild.ownerId;
        if (!isOwner && moderator.roles.highest.position <= target.roles.highest.position) {
            throw new Error('You cannot moderate a member with an equal or higher role.');
        }
        const me = guild.members.me;
        if (me && me.id !== guild.ownerId && me.roles.highest.position <= target.roles.highest.position) {
            throw new Error('I do not have a high enough role to moderate this member.');
        }
        return target;
    }
    formatDuration(minutes) {
        if (minutes < 60)
            return `${minutes} minute${minutes === 1 ? '' : 's'}`;
        const hours = Math.floor(minutes / 60);
        const rest = minutes % 60;
        return `${hours} hour${hours === 1 ? '' : 's'}${rest ? ` ${rest}m` : ''}`;
    }
    async recordCase(params) {
        if (!this.db)
            return;
        await this.db.insert(schema_1.moderationCases).values({
            id: params.id,
            guild_id: params.guildId,
            user_id: params.userId,
            moderator_id: params.moderatorId,
            type: params.type,
            reason: params.reason,
            expires_at: params.expiresAt ?? null,
        });
    }
    async logAction(params) {
        const channelId = this.config.logChannelId;
        if (!channelId || !this.client)
            return;
        try {
            const channel = await this.client.channels.fetch(channelId).catch(() => null);
            if (!channel || !('send' in channel))
                return;
            const embed = (0, embed_1.moderationEmbed)({
                action: params.action,
                target: params.target,
                moderator: params.moderator,
                reason: params.reason,
                caseId: params.caseId,
                duration: params.duration,
            });
            await channel.send({ embeds: [embed] });
        }
        catch (error) {
            this.logger.warn('Moderation Service', `Failed to send moderation log: ${error.message}`);
        }
    }
    async warn(guildId, userId, moderatorId, reason) {
        this.assertEnabled();
        await this.assertGuildEnabled(guildId);
        if (!this.db)
            throw new Error('Database not connected');
        const guild = this.getGuild(guildId);
        const target = await this.assertCanAct(guild, moderatorId, userId, 'warn', true);
        const finalReason = this.resolveReason(reason);
        const caseId = (0, id_1.newId)('warn');
        const moderator = await this.fetchMember(guild, moderatorId);
        await this.db.insert(schema_1.warnings).values({
            id: caseId,
            guild_id: guildId,
            user_id: userId,
            moderator_id: moderatorId,
            reason: finalReason,
            active: true,
        });
        await this.recordCase({
            id: caseId, guildId, userId, moderatorId, type: 'warn', reason: finalReason,
        });
        await this.logAction({
            guildId,
            action: 'warn',
            caseId,
            target: { id: userId, username: target?.user.username ?? userId, tag: target?.user.tag },
            moderator: { id: moderatorId, username: moderator?.user.username ?? moderatorId, tag: moderator?.user.tag },
            reason: finalReason,
        });
        this.logger.info('Moderation Service', `Warned user ${userId} in guild ${guildId}: ${finalReason}`);
        // Optional automatic escalation.
        if (this.config.warnThreshold > 0) {
            const active = await this.getWarnings(guildId, userId);
            if (active.length >= this.config.warnThreshold && target?.moderatable) {
                try {
                    await this.mute(guildId, userId, moderatorId, `Automatic mute after ${active.length} warnings`, this.config.warnThresholdDuration);
                }
                catch (error) {
                    this.logger.warn('Moderation Service', `Auto-mute escalation failed: ${error.message}`);
                }
            }
        }
        return caseId;
    }
    async kick(guildId, userId, moderatorId, reason) {
        this.assertEnabled();
        await this.assertGuildEnabled(guildId);
        const guild = this.getGuild(guildId);
        const target = await this.assertCanAct(guild, moderatorId, userId, 'kick', true);
        if (!target)
            throw new Error('User not found in this server.');
        if (!target.kickable)
            throw new Error('Cannot kick this user (missing permissions or higher role).');
        const finalReason = this.resolveReason(reason);
        const caseId = (0, id_1.newId)('kick');
        const moderator = await this.fetchMember(guild, moderatorId);
        await target.kick(finalReason);
        await this.recordCase({ id: caseId, guildId, userId, moderatorId, type: 'kick', reason: finalReason });
        await this.logAction({
            guildId, action: 'kick', caseId,
            target: { id: userId, username: target.user.username, tag: target.user.tag },
            moderator: { id: moderatorId, username: moderator?.user.username ?? moderatorId, tag: moderator?.user.tag },
            reason: finalReason,
        });
        this.logger.info('Moderation Service', `Kicked user ${userId} from guild ${guildId}: ${finalReason}`);
        return caseId;
    }
    async ban(guildId, userId, moderatorId, reason, deleteMessageDays = 0) {
        this.assertEnabled();
        await this.assertGuildEnabled(guildId);
        const guild = this.getGuild(guildId);
        await this.assertCanAct(guild, moderatorId, userId, 'ban', false);
        const finalReason = this.resolveReason(reason);
        const days = Math.max(0, Math.min(7, Math.floor(deleteMessageDays) || 0));
        const caseId = (0, id_1.newId)('ban');
        const moderator = await this.fetchMember(guild, moderatorId);
        const targetUser = await this.client?.users.fetch(userId).catch(() => null);
        await guild.members.ban(userId, {
            reason: `Case ${caseId}: ${finalReason}`,
            deleteMessageSeconds: days * 24 * 60 * 60,
        });
        await this.recordCase({ id: caseId, guildId, userId, moderatorId, type: 'ban', reason: finalReason });
        await this.logAction({
            guildId, action: 'ban', caseId,
            target: { id: userId, username: targetUser?.username ?? userId, tag: targetUser?.tag },
            moderator: { id: moderatorId, username: moderator?.user.username ?? moderatorId, tag: moderator?.user.tag },
            reason: finalReason,
        });
        this.logger.info('Moderation Service', `Banned user ${userId} from guild ${guildId}: ${finalReason}`);
        return caseId;
    }
    async mute(guildId, userId, moderatorId, reason, durationMinutes) {
        this.assertEnabled();
        await this.assertGuildEnabled(guildId);
        const guild = this.getGuild(guildId);
        const target = await this.assertCanAct(guild, moderatorId, userId, 'mute', true);
        if (!target)
            throw new Error('User not found in this server.');
        if (!target.moderatable)
            throw new Error('Cannot mute this user (missing permissions or higher role).');
        const finalReason = this.resolveReason(reason);
        const minutes = Math.max(1, Math.min(40320, Math.floor(durationMinutes) || 60)); // 28 days max
        const caseId = (0, id_1.newId)('mute');
        const moderator = await this.fetchMember(guild, moderatorId);
        const expiresAt = new Date(Date.now() + minutes * 60 * 1000);
        await target.timeout(minutes * 60 * 1000, `Case ${caseId}: ${finalReason}`);
        await this.recordCase({
            id: caseId, guildId, userId, moderatorId, type: 'mute', reason: finalReason, expiresAt,
        });
        await this.logAction({
            guildId, action: 'mute', caseId,
            target: { id: userId, username: target.user.username, tag: target.user.tag },
            moderator: { id: moderatorId, username: moderator?.user.username ?? moderatorId, tag: moderator?.user.tag },
            reason: finalReason,
            duration: this.formatDuration(minutes),
        });
        this.logger.info('Moderation Service', `Muted user ${userId} in guild ${guildId}: ${finalReason} (${minutes}m)`);
        return caseId;
    }
    async unmute(guildId, userId, moderatorId, reason) {
        this.assertEnabled();
        const guild = this.getGuild(guildId);
        const target = await this.assertCanAct(guild, moderatorId, userId, 'unmute', true);
        if (!target)
            throw new Error('User not found in this server.');
        if (!target.isCommunicationDisabled())
            throw new Error('This user is not currently muted.');
        const finalReason = this.resolveReason(reason);
        const caseId = (0, id_1.newId)('unmute');
        const moderator = await this.fetchMember(guild, moderatorId);
        await target.timeout(null, `Case ${caseId}: ${finalReason}`);
        await this.recordCase({ id: caseId, guildId, userId, moderatorId, type: 'unmute', reason: finalReason });
        await this.logAction({
            guildId, action: 'unmute', caseId,
            target: { id: userId, username: target.user.username, tag: target.user.tag },
            moderator: { id: moderatorId, username: moderator?.user.username ?? moderatorId, tag: moderator?.user.tag },
            reason: finalReason,
        });
        this.logger.info('Moderation Service', `Unmuted user ${userId} in guild ${guildId}`);
        return caseId;
    }
    async unban(guildId, userId, moderatorId, reason) {
        this.assertEnabled();
        const guild = this.getGuild(guildId);
        const finalReason = this.resolveReason(reason);
        const caseId = (0, id_1.newId)('unban');
        const ban = await guild.bans.fetch(userId).catch(() => null);
        if (!ban)
            throw new Error('This user is not banned.');
        const moderator = await this.fetchMember(guild, moderatorId);
        await guild.members.unban(userId, `Case ${caseId}: ${finalReason}`);
        await this.recordCase({ id: caseId, guildId, userId, moderatorId, type: 'unban', reason: finalReason });
        await this.logAction({
            guildId, action: 'unban', caseId,
            target: { id: userId, username: ban.user.username, tag: ban.user.tag },
            moderator: { id: moderatorId, username: moderator?.user.username ?? moderatorId, tag: moderator?.user.tag },
            reason: finalReason,
        });
        this.logger.info('Moderation Service', `Unbanned user ${userId} in guild ${guildId}`);
        return caseId;
    }
    /** Active warnings by default; pass `true` to include removed ones. */
    async getWarnings(guildId, userId, includeInactive = false) {
        if (!this.db)
            return [];
        const where = includeInactive
            ? (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.warnings.guild_id, guildId), (0, drizzle_orm_1.eq)(schema_1.warnings.user_id, userId))
            : (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.warnings.guild_id, guildId), (0, drizzle_orm_1.eq)(schema_1.warnings.user_id, userId), (0, drizzle_orm_1.eq)(schema_1.warnings.active, true));
        return this.db
            .select()
            .from(schema_1.warnings)
            .where(where)
            .orderBy((0, drizzle_orm_1.desc)(schema_1.warnings.created_at));
    }
    async removeWarning(guildId, warningId, moderatorId, reason) {
        if (!this.db)
            return false;
        const row = await this.db
            .select({ id: schema_1.warnings.id, user_id: schema_1.warnings.user_id, active: schema_1.warnings.active })
            .from(schema_1.warnings)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.warnings.id, warningId), (0, drizzle_orm_1.eq)(schema_1.warnings.guild_id, guildId)))
            .limit(1);
        const warning = row[0];
        if (!warning || !warning.active)
            return false;
        await this.db
            .update(schema_1.warnings)
            .set({
            active: false,
            removed_at: new Date(),
            removed_by: moderatorId,
        })
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.warnings.id, warningId), (0, drizzle_orm_1.eq)(schema_1.warnings.guild_id, guildId)));
        await this.recordCase({
            id: (0, id_1.newId)('unwarn'),
            guildId,
            userId: warning.user_id,
            moderatorId,
            type: 'warn',
            reason: reason ? `Warning ${warningId} removed: ${reason}` : `Warning ${warningId} removed`,
        });
        this.logger.info('Moderation Service', `Removed warning ${warningId} (guild ${guildId})`);
        return true;
    }
    async clearWarnings(guildId, userId, moderatorId) {
        if (!this.db)
            return 0;
        const result = await this.db
            .update(schema_1.warnings)
            .set({
            active: false,
            removed_at: new Date(),
            removed_by: moderatorId,
        })
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.warnings.guild_id, guildId), (0, drizzle_orm_1.eq)(schema_1.warnings.user_id, userId), (0, drizzle_orm_1.eq)(schema_1.warnings.active, true)))
            .run();
        const changes = Number(result.changes ?? 0);
        if (changes > 0) {
            await this.recordCase({
                id: (0, id_1.newId)('unwarn'),
                guildId,
                userId,
                moderatorId,
                type: 'warn',
                reason: `Cleared ${changes} warning${changes === 1 ? '' : 's'}`,
            });
            this.logger.info('Moderation Service', `Cleared ${changes} warnings for ${userId} in guild ${guildId}`);
        }
        return changes;
    }
    async getCases(guildId, userId, limit = 50, offset = 0) {
        if (!this.db)
            return [];
        const where = userId
            ? (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.moderationCases.guild_id, guildId), (0, drizzle_orm_1.eq)(schema_1.moderationCases.user_id, userId))
            : (0, drizzle_orm_1.eq)(schema_1.moderationCases.guild_id, guildId);
        return this.db
            .select()
            .from(schema_1.moderationCases)
            .where(where)
            .orderBy((0, drizzle_orm_1.desc)(schema_1.moderationCases.created_at))
            .limit(Math.max(1, Math.min(200, Math.floor(limit))))
            .offset(Math.max(0, Math.floor(offset)));
    }
    async getCase(guildId, caseId) {
        if (!this.db)
            return null;
        const rows = await this.db
            .select()
            .from(schema_1.moderationCases)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.moderationCases.guild_id, guildId), (0, drizzle_orm_1.eq)(schema_1.moderationCases.id, caseId)))
            .limit(1);
        return rows[0] ?? null;
    }
    async shutdown() {
        this.logger.info('Moderation Service', 'Moderation system shutdown');
    }
}
exports.ModerationService = ModerationService;
