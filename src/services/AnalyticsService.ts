import { Logger } from '../infrastructure/Logger';
import { and, eq, count, sql } from 'drizzle-orm';
import {
  users,
  guilds,
  guildMembers,
  moderationCases,
  messages,
  warnings,
  economyTransactions,
  economyAccounts,
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

export interface GuildStats {
  guildId: string;
  trackedMembers: number;
  messages: number;
  moderationCases: number;
  warnings: number;
  levelUps: number;
  openTickets: number;
  transactions: number;
  economyAccounts: number;
  economyTotalBalance: number;
  economyAverageBalance: number;
}

export interface ActivityPoint {
  date: string;
  messages: number;
  moderationCases: number;
}

const EMPTY_STATS: BotStats = {
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

export class AnalyticsService {
  private logger: Logger;
  private db: DrizzleDb | null = null;
  public config = { enabled: true, trackMessages: false };
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

  /** Record a message in the analytics stream (opt-in via config.trackMessages). */
  public async trackMessage(guildId: string, channelId: string, authorId: string, content: string): Promise<void> {
    if (!this.db || !this.config.trackMessages) return;
    try {
      await this.db.insert(messages).values({
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        guild_id: guildId,
        channel_id: channelId,
        author_id: authorId,
        content: content.slice(0, 2000),
        created_at: new Date(),
      } as any);
    } catch (error) {
      this.logger.warn('Analytics Service', `Could not record message: ${(error as Error).message}`);
    }
  }

  private async rowCount(table: any, where?: any): Promise<number> {
    const query = where
      ? this.db!.select({ value: count() }).from(table).where(where)
      : this.db!.select({ value: count() }).from(table);
    const [row] = await query;
    return Number(row?.value ?? 0);
  }

  public async getStats(): Promise<BotStats> {
    if (!this.db) {
      return { ...EMPTY_STATS, uptime: Date.now() - this.startTime };
    }

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
      this.rowCount(guilds),
      this.rowCount(users),
      this.rowCount(messages),
      this.rowCount(moderationCases),
      this.rowCount(warnings),
      this.rowCount(economyTransactions),
      this.rowCount(levelingHistory),
      this.rowCount(tickets, eq(tickets.status, 'open')),
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

  public async getGuildStats(guildId: string): Promise<GuildStats | null> {
    if (!this.db) return null;
    try {
      const [
        trackedMembers,
        guildMessages,
        cases,
        guildWarnings,
        guildLevelUps,
        guildOpenTickets,
        guildTransactions,
      ] = await Promise.all([
        this.rowCount(guildMembers, eq(guildMembers.guild_id, guildId)),
        this.rowCount(messages, eq(messages.guild_id, guildId)),
        this.rowCount(moderationCases, eq(moderationCases.guild_id, guildId)),
        this.rowCount(warnings, eq(warnings.guild_id, guildId)),
        this.rowCount(levelingHistory, eq(levelingHistory.guild_id, guildId)),
        this.rowCount(tickets, and(eq(tickets.guild_id, guildId), eq(tickets.status, 'open'))),
        this.rowCount(economyTransactions, eq(economyTransactions.guild_id, guildId)),
      ]);

      const econRows = await this.db
        .select({
          accounts: count(),
          total: sql<number>`coalesce(sum(${economyAccounts.balance}), 0)`,
        })
        .from(economyAccounts)
        .where(eq(economyAccounts.guild_id, guildId));
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
    } catch (error) {
      this.logger.warn('Analytics Service', `Could not build guild stats: ${(error as Error).message}`);
      return null;
    }
  }

  /** Per-day series for the last N days, bucketed in UTC. */
  public async getActivitySeries(guildId: string | undefined, days = 14): Promise<ActivityPoint[]> {
    if (!this.db) return [];
    const safeDays = Math.max(1, Math.min(90, Math.floor(days)));
    try {
      const since = sql`(strftime('%s', 'now') - ${safeDays * 86400})`;
      const guildFilter = guildId ? sql`AND guild_id = ${guildId}` : sql``;

      const messageRows = await this.db.all<{ day: string; value: number }>(sql`
        SELECT strftime('%Y-%m-%d', created_at, 'unixepoch') AS day, count(*) AS value
        FROM messages
        WHERE created_at >= ${since} ${guildFilter}
        GROUP BY day
        ORDER BY day
      `);
      const caseRows = await this.db.all<{ day: string; value: number }>(sql`
        SELECT strftime('%Y-%m-%d', created_at, 'unixepoch') AS day, count(*) AS value
        FROM moderation_cases
        WHERE created_at >= ${since} ${guildFilter}
        GROUP BY day
        ORDER BY day
      `);

      const byDay = new Map<string, ActivityPoint>();
      for (const row of messageRows) byDay.set(row.day, { date: row.day, messages: Number(row.value), moderationCases: 0 });
      for (const row of caseRows) {
        const existing = byDay.get(row.day) ?? { date: row.day, messages: 0, moderationCases: 0 };
        existing.moderationCases = Number(row.value);
        byDay.set(row.day, existing);
      }
      return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
    } catch (error) {
      this.logger.warn('Analytics Service', `Could not build activity series: ${(error as Error).message}`);
      return [];
    }
  }

  public async shutdown(): Promise<void> {
    this.logger.info('Analytics Service', 'Analytics system shutdown');
  }
}
