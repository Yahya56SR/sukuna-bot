import { Logger } from '../infrastructure/Logger';
import { eq, count } from 'drizzle-orm';
import {
  users,
  guilds,
  moderationCases,
  messages,
  warnings,
  economyTransactions,
  tickets,
  levelingHistory,
} from '../database/schema';
import type { DrizzleDb } from '../types/database';

export interface BotStats {
  totalGuilds: number;
  totalUsers: number;
  totalMessages: number;
  totalModerationCases: number;
  totalWarnings: number;
  totalTransactions: number;
  openTickets: number;
  totalLevelUps: number;
  uptime: number;
}

export class AnalyticsService {
  private logger: Logger;
  private db: DrizzleDb | null = null;
  public config = { enabled: true };
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
        totalWarnings: 0,
        totalTransactions: 0,
        openTickets: 0,
        totalLevelUps: 0,
        uptime: Date.now() - this.startTime,
      };
    }

    // `count()` produces SELECT count(*); selecting an id column and reading
    // `count` from the first row would only ever return the first row's id.
    const rowCount = async (table: any): Promise<number> => {
      const [row] = await this.db!.select({ value: count() }).from(table);
      return Number(row?.value ?? 0);
    };

    const [
      totalGuilds,
      totalUsers,
      totalMessages,
      totalModerationCases,
      totalWarnings,
      totalTransactions,
      totalLevelUps,
      openTickets,
    ] = await Promise.all([
      rowCount(guilds),
      rowCount(users),
      rowCount(messages),
      rowCount(moderationCases),
      rowCount(warnings),
      rowCount(economyTransactions),
      rowCount(levelingHistory),
      this.db
        .select({ value: count() })
        .from(tickets)
        .where(eq(tickets.status, 'open'))
        .then((rows: any[]) => Number(rows[0]?.value ?? 0)),
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

  public async getGuildStats(guildId: string): Promise<any> {
    if (!this.db) return null;
    const [guild] = await this.db.select().from(guilds).where(eq(guilds.id, guildId));
    return guild || null;
  }

  public async shutdown(): Promise<void> {
    this.logger.info('Analytics Service', 'Analytics system shutdown');
  }
}
