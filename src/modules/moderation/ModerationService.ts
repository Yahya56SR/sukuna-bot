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

  public async initialize(client: Client): Promise<void> {
    this.client = client;
    this.logger.info('Moderation Service', 'Moderation system initialized');
  }

  public async warn(
    guildId: string,
    userId: string,
    moderatorId: string,
    reason: string
  ): Promise<string> {
    if (!this.config.enabled) throw new Error('Moderation system is disabled');
    if (!this.db) throw new Error('Database not connected');
    const caseId = `warn_${Date.now()}`;

    await this.db.insert(warnings).values({
      id: caseId,
      guild_id: guildId,
      user_id: userId,
      moderator_id: moderatorId,
      reason,
    } as any);

    await this.db.insert(moderationCases).values({
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

  public async kick(
    guildId: string,
    userId: string,
    moderatorId: string,
    reason: string
  ): Promise<string> {
    if (!this.config.enabled) throw new Error('Moderation system is disabled');
    const caseId = `kick_${Date.now()}`;

    const guild = this.client?.guilds.cache.get(guildId);
    const member = guild ? await guild.members.fetch(userId).catch(() => null) : null;
    if (member) {
      await member.kick(reason);
    }

    if (this.db) {
      await this.db.insert(moderationCases).values({
        id: caseId,
        guild_id: guildId,
        user_id: userId,
        moderator_id: moderatorId,
        type: 'kick',
        reason,
      } as any);
    }

    this.logger.info('Moderation Service', `Kicked user ${userId} from guild ${guildId}: ${reason}`);
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
    const caseId = `ban_${Date.now()}`;

    const guild = this.client?.guilds.cache.get(guildId);
    if (guild) {
      await guild.members.ban(userId, { reason, deleteMessageDays });
    }

    if (this.db) {
      await this.db.insert(moderationCases).values({
        id: caseId,
        guild_id: guildId,
        user_id: userId,
        moderator_id: moderatorId,
        type: 'ban',
        reason,
      } as any);
    }

    this.logger.info('Moderation Service', `Banned user ${userId} from guild ${guildId}: ${reason}`);
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
    const caseId = `mute_${Date.now()}`;
    const expiresAt = Date.now() + durationMinutes * 60 * 1000;

    const guild = this.client?.guilds.cache.get(guildId);
    const member = guild ? await guild.members.fetch(userId).catch(() => null) : null;
    if (member) {
      await member.timeout(durationMinutes * 60 * 1000, reason);
    }

    if (this.db) {
      await this.db.insert(moderationCases).values({
        id: caseId,
        guild_id: guildId,
        user_id: userId,
        moderator_id: moderatorId,
        type: 'mute',
        reason,
        expires_at: expiresAt,
      } as any);
    }

    this.logger.info('Moderation Service', `Muted user ${userId} in guild ${guildId}: ${reason}`);
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
