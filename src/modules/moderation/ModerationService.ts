import { Client } from 'discord.js';
import { Logger } from '../../infrastructure/Logger';
import { eq, and } from 'drizzle-orm';
import { warnings, moderationCases } from '../../database/schema';
import type { DrizzleDb } from '../../types/database';

export interface ModerationConfig {
  enabled: boolean;
  logChannelId: string;
  defaultReason: string;
}

export class ModerationService {
  private client: Client | null = null;
  private logger: Logger;
  private db: DrizzleDb | null = null;
  public config: ModerationConfig = { enabled: true, logChannelId: '', defaultReason: '' };

  constructor(logger: Logger) {
    this.logger = logger;
  }

  public setDb(db: DrizzleDb): void {
    this.db = db;
  }

  public setClient(client: Client): void {
    this.client = client;
  }

  public async initialize(client: Client): Promise<void> {
    this.client = client;
    this.logger.info('Moderation Service', 'Moderation system initialized');
  }

  private resolveReason(reason?: string): string {
    const r = (reason ?? '').trim();
    return r || this.config.defaultReason || 'No reason provided';
  }

  public async warn(
    guildId: string,
    userId: string,
    moderatorId: string,
    reason: string
  ): Promise<string> {
    if (!this.config.enabled) throw new Error('Moderation system is disabled');
    if (!this.db) throw new Error('Database not connected');
    if (userId === moderatorId) throw new Error('You cannot warn yourself.');
    const finalReason = this.resolveReason(reason);
    const caseId = `warn_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    await this.db.insert(warnings).values({
      id: caseId,
      guild_id: guildId,
      user_id: userId,
      moderator_id: moderatorId,
      reason: finalReason,
    } as any);

    await this.db.insert(moderationCases).values({
      id: caseId,
      guild_id: guildId,
      user_id: userId,
      moderator_id: moderatorId,
      type: 'warn',
      reason: finalReason,
    } as any);

    this.logger.info('Moderation Service', `Warned user ${userId} in guild ${guildId}: ${finalReason}`);
    return caseId;
  }

  public async kick(
    guildId: string,
    userId: string,
    moderatorId: string,
    reason: string
  ): Promise<string> {
    if (!this.config.enabled) throw new Error('Moderation system is disabled');
    if (userId === moderatorId) throw new Error('You cannot kick yourself.');
    const finalReason = this.resolveReason(reason);
    const caseId = `kick_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    const guild = this.client?.guilds.cache.get(guildId);
    const member = guild ? await guild.members.fetch(userId).catch(() => null) : null;
    if (!member) throw new Error('User not found in this server.');
    if (!member.kickable) throw new Error('Cannot kick this user (missing permissions or higher role).');

    await member.kick(finalReason);

    if (this.db) {
      await this.db.insert(moderationCases).values({
        id: caseId,
        guild_id: guildId,
        user_id: userId,
        moderator_id: moderatorId,
        type: 'kick',
        reason: finalReason,
      } as any);
    }

    this.logger.info('Moderation Service', `Kicked user ${userId} from guild ${guildId}: ${finalReason}`);
    return caseId;
  }

  public async ban(
    guildId: string,
    userId: string,
    moderatorId: string,
    reason: string,
    deleteMessageDays: number = 0
  ): Promise<string> {
    if (!this.config.enabled) throw new Error('Moderation system is disabled');
    if (userId === moderatorId) throw new Error('You cannot ban yourself.');
    const finalReason = this.resolveReason(reason);
    const days = Math.max(0, Math.min(7, Math.floor(deleteMessageDays) || 0));
    const caseId = `ban_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    const guild = this.client?.guilds.cache.get(guildId);
    if (!guild) throw new Error('Server not found.');

    // Discord rejects banning the guild owner; surface a clear error
    if (guild.ownerId === userId) throw new Error('Cannot ban the server owner.');

    await guild.members.ban(userId, { reason: `Case ${caseId}: ${finalReason}`, deleteMessageDays: days });

    if (this.db) {
      await this.db.insert(moderationCases).values({
        id: caseId,
        guild_id: guildId,
        user_id: userId,
        moderator_id: moderatorId,
        type: 'ban',
        reason: finalReason,
      } as any);
    }

    this.logger.info('Moderation Service', `Banned user ${userId} from guild ${guildId}: ${finalReason}`);
    return caseId;
  }

  public async mute(
    guildId: string,
    userId: string,
    moderatorId: string,
    reason: string,
    durationMinutes: number
  ): Promise<string> {
    if (!this.config.enabled) throw new Error('Moderation system is disabled');
    if (userId === moderatorId) throw new Error('You cannot mute yourself.');
    const finalReason = this.resolveReason(reason);
    const minutes = Math.max(1, Math.min(40320, Math.floor(durationMinutes) || 60)); // 28 days max
    const caseId = `mute_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    const guild = this.client?.guilds.cache.get(guildId);
    const member = guild ? await guild.members.fetch(userId).catch(() => null) : null;
    if (!member) throw new Error('User not found in this server.');
    if (!member.moderatable) throw new Error('Cannot mute this user (missing permissions or higher role).');

    await member.timeout(minutes * 60 * 1000, `Case ${caseId}: ${finalReason}`);

    if (this.db) {
      await this.db.insert(moderationCases).values({
        id: caseId,
        guild_id: guildId,
        user_id: userId,
        moderator_id: moderatorId,
        type: 'mute',
        reason: finalReason,
        expires_at: Date.now() + minutes * 60 * 1000,
      } as any);
    }

    this.logger.info('Moderation Service', `Muted user ${userId} in guild ${guildId}: ${finalReason} (${minutes}m)`);
    return caseId;
  }

  public async unmute(guildId: string, userId: string, moderatorId: string, reason?: string): Promise<string> {
    if (!this.config.enabled) throw new Error('Moderation system is disabled');
    const finalReason = this.resolveReason(reason);
    const caseId = `unmute_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const guild = this.client?.guilds.cache.get(guildId);
    const member = guild ? await guild.members.fetch(userId).catch(() => null) : null;
    if (!member) throw new Error('User not found in this server.');
    await member.timeout(null, `Case ${caseId}: ${finalReason}`);
    if (this.db) {
      await this.db.insert(moderationCases).values({
        id: caseId, guild_id: guildId, user_id: userId, moderator_id: moderatorId, type: 'unmute', reason: finalReason,
      } as any);
    }
    return caseId;
  }

  public async unban(guildId: string, userId: string, moderatorId: string, reason?: string): Promise<string> {
    if (!this.config.enabled) throw new Error('Moderation system is disabled');
    const finalReason = this.resolveReason(reason);
    const caseId = `unban_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const guild = this.client?.guilds.cache.get(guildId);
    if (!guild) throw new Error('Server not found.');
    await guild.members.unban(userId, `Case ${caseId}: ${finalReason}`).catch(() => undefined);
    if (this.db) {
      await this.db.insert(moderationCases).values({
        id: caseId, guild_id: guildId, user_id: userId, moderator_id: moderatorId, type: 'unban', reason: finalReason,
      } as any);
    }
    return caseId;
  }

  public async getWarnings(guildId: string, userId: string): Promise<any[]> {
    if (!this.db) return [];
    return this.db.select().from(warnings).where(and(eq(warnings.guild_id, guildId), eq(warnings.user_id, userId)));
  }

  public async getCases(guildId: string, userId?: string): Promise<any[]> {
    if (!this.db) return [];
    if (userId) {
      return this.db.select().from(moderationCases).where(and(eq(moderationCases.guild_id, guildId), eq(moderationCases.user_id, userId)));
    }
    return this.db.select().from(moderationCases).where(eq(moderationCases.guild_id, guildId));
  }

  public async shutdown(): Promise<void> {
    this.logger.info('Moderation Service', 'Moderation system shutdown');
  }
}
