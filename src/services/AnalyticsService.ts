import { Logger } from '../infrastructure/Logger';
import { eq } from 'drizzle-orm';
import { users, guilds, moderationCases, messages } from '../database/schema';
import type { DrizzleDb } from '../types/database';

export interface BotStats {
  totalGuilds: number;
  totalUsers: number;
  totalMessages: number;
  totalModerationCases: number;
  uptime: number;
}

export class AnalyticsService {
  private logger: Logger;
  private db: DrizzleDb | null = null;
  private startTime: number;

  constructor(logger: Logger) {
    this.logger = logger;
    this.startTime = Date.now();
  }

  public setDb(db: DrizzleDb): void {
    this.db = db;
  }

  public async initialize(): Promise<void> {
    this.logger.info('Analytics Service', 'Analytics system initialized');
  }

  public async getStats(): Promise<BotStats> {
    if (!this.db) {
      return {
        totalGuilds: 0,
        totalUsers: 0,
        totalMessages: 0,
        totalModerationCases: 0,
        uptime: Date.now() - this.startTime,
      };
    }

    const [guildCount] = await this.db.select({ count: guilds.id }).from(guilds);
    const [userCount] = await this.db.select({ count: users.id }).from(users);
    const [messageCount] = await this.db.select({ count: messages.id }).from(messages);
    const [modCount] = await this.db.select({ count: moderationCases.id }).from(moderationCases);

    return {
      totalGuilds: Number(guildCount?.count || 0),
      totalUsers: Number(userCount?.count || 0),
      totalMessages: Number(messageCount?.count || 0),
      totalModerationCases: Number(modCount?.count || 0),
      uptime: Date.now() - this.startTime,
    };
  }

  public async getGuildStats(guildId: string): Promise<any> {
    if (!this.db) return null;
    const [guild] = await this.db.select().from(guilds).where(eq(guilds.id, guildId));
    return guild || null;
  }

  public async shutdown(): Promise<void> {
    this.logger.info('Analytics Service', 'Analytics system shutdown');
  }
}
