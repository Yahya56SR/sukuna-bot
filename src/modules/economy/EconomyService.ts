import { ChatInputCommandInteraction, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { Logger } from '../../infrastructure/Logger';
import { and, desc, eq, sql } from 'drizzle-orm';
import { economyAccounts, economyTransactions } from '../../database/schema';
import type { DrizzleDb } from '../../types/database';
import { economyEmbed, formatNumber, BRAND, brandedEmbed, errorEmbed } from '../../utils/embed';
import { newId } from '../../utils/id';

export interface EconomyConfig {
  enabled: boolean;
  startingBalance: number;
  currencyName: string;
  /** Maximum amount a single transfer may move. 0 = unlimited. */
  maxTransfer: number;
  /** Opt-in daily reward amount. 0 disables /daily. */
  dailyAmount: number;
  dailyCooldownHours: number;
}

export interface LedgerOptions {
  type?: 'credit' | 'debit' | 'transfer_in' | 'transfer_out' | 'adjustment' | 'game' | 'daily';
  description?: string;
  reference?: string;
}

export interface BalanceChange {
  success: boolean;
  balance: number;
  amount: number;
}

const LEGACY_GUILD = 'global';

/**
 * Guild-scoped, ledger-backed economy.
 *
 * Money is never read-then-written in JavaScript: every mutation is a single
 * conditional SQL statement executed inside a transaction, so concurrent
 * commands cannot duplicate or lose funds.
 */
export class EconomyService {
  private logger: Logger;
  private db: DrizzleDb | null = null;
  public config: EconomyConfig = {
    enabled: true,
    startingBalance: 0,
    currencyName: 'coins',
    maxTransfer: 0,
    dailyAmount: 0,
    dailyCooldownHours: 24,
  };

  constructor(logger: Logger, config?: Partial<EconomyConfig>) {
    this.logger = logger;
    if (config) this.config = { ...this.config, ...config };
  }

  public setDb(db: DrizzleDb): void {
    this.db = db;
  }

  public async initialize(): Promise<void> {
    this.logger.info('Economy Service', `Economy initialized (currency: ${this.config.currencyName})`);
  }

  /**
   * Accepts both `(userId)` (legacy) and `(guildId, userId)`.
   * Guild-scoped calls are the source of truth; the single-argument form
   * resolves to the legacy `global` bucket.
   */
  private resolveKey(first: string, second?: string): { guildId: string; userId: string } {
    return second === undefined ? { guildId: LEGACY_GUILD, userId: first } : { guildId: first, userId: second };
  }

  private assertEnabled(): void {
    if (!this.config.enabled) throw new Error('Economy system is disabled');
  }

  private validateAmount(amount: number): number {
    if (!Number.isFinite(amount)) throw new Error('Invalid amount');
    const rounded = Math.floor(amount * 100) / 100;
    if (rounded <= 0) throw new Error('Amount must be positive');
    return rounded;
  }

  public async getBalance(guildId: string, userId?: string): Promise<number> {
    if (!this.db) return 0;
    const key = this.resolveKey(guildId, userId);
    const row = await this.db
      .select({ balance: economyAccounts.balance })
      .from(economyAccounts)
      .where(and(eq(economyAccounts.guild_id, key.guildId), eq(economyAccounts.user_id, key.userId)))
      .limit(1);
    if (row[0]) return Number(row[0].balance ?? 0);

    await this.ensureAccount(key.guildId, key.userId);
    return this.config.startingBalance ?? 0;
  }

  private nowSeconds(): number {
    return Math.floor(Date.now() / 1000);
  }

  private async ensureAccount(guildId: string, userId: string): Promise<void> {
    if (!this.db) return;
    await this.db.run(sql`
      INSERT INTO economy_accounts (guild_id, user_id, balance, updated_at)
      VALUES (${guildId}, ${userId}, ${this.config.startingBalance ?? 0}, ${this.nowSeconds()})
      ON CONFLICT(guild_id, user_id) DO NOTHING
    `);
  }

  /** Add funds. Returns the resulting balance. */
  public async credit(guildId: string, userId: string, amount: number, opts: LedgerOptions = {}): Promise<number> {
    const key = this.resolveKey(guildId, userId);
    return this.creditResolved(key.guildId, key.userId, amount, opts);
  }

  private async creditResolved(guildId: string, userId: string, amount: number, opts: LedgerOptions): Promise<number> {
    this.assertEnabled();
    if (!this.db) return 0;
    const value = this.validateAmount(amount);
    const db = this.db;

    return db.transaction((tx) => {
      const now = this.nowSeconds();
      tx.run(sql`
        INSERT INTO economy_accounts (guild_id, user_id, balance, updated_at)
        VALUES (${guildId}, ${userId}, ${this.config.startingBalance ?? 0}, ${now})
        ON CONFLICT(guild_id, user_id) DO NOTHING
      `);
      tx.run(sql`
        UPDATE economy_accounts
        SET balance = balance + ${value}, updated_at = ${now}
        WHERE guild_id = ${guildId} AND user_id = ${userId}
      `);
      const row = tx.get<{ balance: number }>(sql`
        SELECT balance FROM economy_accounts WHERE guild_id = ${guildId} AND user_id = ${userId}
      `);
      const balance = Number(row?.balance ?? 0);
      tx.insert(economyTransactions).values({
        id: newId('txn'),
        guild_id: guildId,
        user_id: userId,
        type: opts.type ?? 'credit',
        amount: value,
        balance_after: balance,
        description: opts.description ?? 'Balance credited',
        reference: opts.reference ?? null,
        created_at: new Date(now * 1000),
      } as any).run();
      this.mirrorLegacyBalance(tx as any, userId, balance);
      return balance;
    });
  }

  /** Remove funds atomically. Fails (without changing anything) if the user is short. */
  public async debit(guildId: string, userId: string, amount: number, opts: LedgerOptions = {}): Promise<BalanceChange> {
    const key = this.resolveKey(guildId, userId);
    return this.debitResolved(key.guildId, key.userId, amount, opts);
  }

  private async debitResolved(guildId: string, userId: string, amount: number, opts: LedgerOptions): Promise<BalanceChange> {
    this.assertEnabled();
    if (!this.db) return { success: false, balance: 0, amount: 0 };
    const value = this.validateAmount(amount);
    const db = this.db;

    return db.transaction((tx) => {
      const now = this.nowSeconds();
      tx.run(sql`
        INSERT INTO economy_accounts (guild_id, user_id, balance, updated_at)
        VALUES (${guildId}, ${userId}, ${this.config.startingBalance ?? 0}, ${now})
        ON CONFLICT(guild_id, user_id) DO NOTHING
      `);
      const result = tx.run(sql`
        UPDATE economy_accounts
        SET balance = balance - ${value}, updated_at = ${now}
        WHERE guild_id = ${guildId} AND user_id = ${userId} AND balance >= ${value}
      `);
      const row = tx.get<{ balance: number }>(sql`
        SELECT balance FROM economy_accounts WHERE guild_id = ${guildId} AND user_id = ${userId}
      `);
      const balance = Number(row?.balance ?? 0);
      if (Number(result.changes ?? 0) === 0) {
        return { success: false, balance, amount: value };
      }
      tx.insert(economyTransactions).values({
        id: newId('txn'),
        guild_id: guildId,
        user_id: userId,
        type: opts.type ?? 'debit',
        amount: -value,
        balance_after: balance,
        description: opts.description ?? 'Balance debited',
        reference: opts.reference ?? null,
        created_at: new Date(now * 1000),
      } as any).run();
      this.mirrorLegacyBalance(tx as any, userId, balance);
      return { success: true, balance, amount: value };
    });
  }

  /**
   * Atomic transfer between two wallets. Both ledger rows and both balance
   * updates commit together, or nothing changes.
   */
  public async transfer(
    guildId: string,
    fromUserId: string,
    toUserId: string,
    amount: number,
    description = 'Member transfer',
  ): Promise<BalanceChange> {
    const from = { guildId, userId: fromUserId };
    const to = { guildId, userId: toUserId };
    this.assertEnabled();
    if (!this.db) return { success: false, balance: 0, amount: 0 };
    if (from.userId === to.userId) throw new Error('You cannot transfer to yourself');
    const value = this.validateAmount(amount);
    if (this.config.maxTransfer > 0 && value > this.config.maxTransfer) {
      throw new Error(`Transfers are limited to ${formatNumber(this.config.maxTransfer)} ${this.config.currencyName}`);
    }

    const db = this.db;
    return db.transaction((tx) => {
      const now = this.nowSeconds();
      for (const uid of [from.userId, to.userId]) {
        tx.run(sql`
          INSERT INTO economy_accounts (guild_id, user_id, balance, updated_at)
          VALUES (${from.guildId}, ${uid}, ${this.config.startingBalance ?? 0}, ${now})
          ON CONFLICT(guild_id, user_id) DO NOTHING
        `);
      }
      const result = tx.run(sql`
        UPDATE economy_accounts
        SET balance = balance - ${value}, updated_at = ${now}
        WHERE guild_id = ${from.guildId} AND user_id = ${from.userId} AND balance >= ${value}
      `);
      const fromRow = tx.get<{ balance: number }>(sql`
        SELECT balance FROM economy_accounts WHERE guild_id = ${from.guildId} AND user_id = ${from.userId}
      `);
      const fromBalance = Number(fromRow?.balance ?? 0);
      if (Number(result.changes ?? 0) === 0) {
        return { success: false, balance: fromBalance, amount: value };
      }
      tx.run(sql`
        UPDATE economy_accounts
        SET balance = balance + ${value}, updated_at = ${now}
        WHERE guild_id = ${to.guildId} AND user_id = ${to.userId}
      `);
      const toRow = tx.get<{ balance: number }>(sql`
        SELECT balance FROM economy_accounts WHERE guild_id = ${to.guildId} AND user_id = ${to.userId}
      `);
      const toBalance = Number(toRow?.balance ?? 0);

      const createdAt = new Date(now * 1000);
      tx.insert(economyTransactions).values([
        {
          id: newId('txn'), guild_id: from.guildId, user_id: from.userId, type: 'transfer_out',
          amount: -value, balance_after: fromBalance, description, reference: to.userId, created_at: createdAt,
        } as any,
        {
          id: newId('txn'), guild_id: to.guildId, user_id: to.userId, type: 'transfer_in',
          amount: value, balance_after: toBalance, description, reference: from.userId, created_at: createdAt,
        } as any,
      ]).run();
      this.mirrorLegacyBalance(tx as any, from.userId, fromBalance);
      this.mirrorLegacyBalance(tx as any, to.userId, toBalance);
      return { success: true, balance: fromBalance, amount: value };
    });
  }

  /** Set an absolute balance (dashboard/admin). Uses credit/debit internally. */
  public async setBalance(guildId: string, userId: string, target: number): Promise<BalanceChange> {
    const key = this.resolveKey(guildId, userId);
    if (!Number.isFinite(target) || target < 0) throw new Error('Balance must be a non-negative number');
    const current = await this.getBalance(key.guildId, key.userId);
    const diff = Math.floor((Number(target) - current) * 100) / 100;
    if (diff > 0) {
      const balance = await this.creditResolved(key.guildId, key.userId, diff, { type: 'adjustment', description: 'Balance set by admin' });
      return { success: true, balance, amount: diff };
    }
    if (diff < 0) {
      const result = await this.debitResolved(key.guildId, key.userId, Math.abs(diff), { type: 'adjustment', description: 'Balance set by admin' });
      return result;
    }
    return { success: true, balance: current, amount: 0 };
  }

  // ---- legacy wrappers -------------------------------------------------
  public async addBalance(userId: string, amount: number): Promise<void> {
    await this.credit(LEGACY_GUILD, userId, amount, { description: 'Balance added' });
  }

  public async removeBalance(userId: string, amount: number): Promise<boolean> {
    const result = await this.debit(LEGACY_GUILD, userId, amount, { description: 'Balance removed' });
    return result.success;
  }

  public async pay(fromUserId: string, toUserId: string, amount: number): Promise<boolean> {
    const result = await this.transfer(LEGACY_GUILD, fromUserId, toUserId, amount);
    return result.success;
  }

  /** Daily reward, once per cooldown window per guild per user. */
  public async claimDaily(guildId: string, userId: string): Promise<{ success: boolean; balance: number; alreadyClaimed: boolean; cooldownRemainingMs: number }> {
    this.assertEnabled();
    if (!this.db) throw new Error('Database not connected');
    const amount = Math.floor(this.config.dailyAmount ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('Daily rewards are disabled on this server');

    const cooldownMs = Math.max(1, Math.floor(this.config.dailyCooldownHours ?? 24)) * 60 * 60 * 1000;

    const recent = await this.db
      .select({ created_at: economyTransactions.created_at })
      .from(economyTransactions)
      .where(and(
        eq(economyTransactions.guild_id, guildId),
        eq(economyTransactions.user_id, userId),
        eq(economyTransactions.type, 'daily'),
      ))
      .orderBy(desc(economyTransactions.created_at))
      .limit(1);

    const last = recent[0]?.created_at;
    if (last) {
      const lastMs = last instanceof Date ? last.getTime() : Number(last) * 1000;
      const remaining = cooldownMs - (Date.now() - lastMs);
      if (remaining > 0) {
        const balance = await this.getBalance(guildId, userId);
        return { success: false, balance, alreadyClaimed: true, cooldownRemainingMs: remaining };
      }
    }

    const balance = await this.credit(guildId, userId, amount, { type: 'daily', description: 'Daily reward' });
    return { success: true, balance, alreadyClaimed: false, cooldownRemainingMs: 0 };
  }

  // ---- reads -----------------------------------------------------------
  public async getLeaderboard(guildId: string, limit = 10): Promise<Array<{ user_id: string; balance: number }>> {
    if (!this.db) return [];
    const rows = await this.db
      .select({ user_id: economyAccounts.user_id, balance: economyAccounts.balance })
      .from(economyAccounts)
      .where(eq(economyAccounts.guild_id, guildId))
      .orderBy(desc(economyAccounts.balance))
      .limit(Math.max(1, Math.min(100, Math.floor(limit))));
    return rows.map((r: any) => ({ user_id: r.user_id, balance: Number(r.balance ?? 0) }));
  }

  public async getTransactions(guildId: string, userId?: string, limit = 10): Promise<any[]> {
    if (!this.db) return [];
    const where = userId
      ? and(eq(economyTransactions.guild_id, guildId), eq(economyTransactions.user_id, userId))
      : eq(economyTransactions.guild_id, guildId);
    return this.db
      .select()
      .from(economyTransactions)
      .where(where)
      .orderBy(desc(economyTransactions.created_at))
      .limit(Math.max(1, Math.min(100, Math.floor(limit))));
  }

  /** Keep the legacy `users.balance` column in sync for old dashboard queries. */
  private mirrorLegacyBalance(tx: any, userId: string, balance: number): void {
    try {
      tx.run(sql`UPDATE users SET balance = ${balance}, updated_at = ${this.nowSeconds()} WHERE id = ${userId}`);
    } catch {
      // User row may not exist yet; the guild wallet is authoritative.
    }
  }

  /** Ensure a user metadata row exists (called on first wallet write). */
  public async ensureUser(userId: string, username = ''): Promise<void> {
    if (!this.db) return;
    const now = this.nowSeconds();
    await this.db.run(sql`
      INSERT INTO users (id, username, bot, balance, xp, level, total_xp, created_at, updated_at)
      VALUES (${userId}, ${username}, 0, 0, 0, 1, 0, ${now}, ${now})
      ON CONFLICT(id) DO NOTHING
    `);
  }

  public async shutdown(): Promise<void> {
    this.logger.info('Economy Service', 'Economy system shutdown');
  }
}

export class EconomyCommands {
  private service: EconomyService;
  private logger: Logger;

  constructor(service: EconomyService, logger: Logger) {
    this.service = service;
    this.logger = logger;
  }

  public getCommands(): any[] {
    return [this.balanceCommand, this.payCommand, this.leaderboardCommand, this.dailyCommand];
  }

  private balanceCommand: any = {
    data: new SlashCommandBuilder()
      .setName('balance')
      .setDescription('Check your balance')
      .addUserOption((option) => option.setName('user').setDescription('User to check')),
    execute: async (interaction: ChatInputCommandInteraction) => {
      const user = interaction.options.getUser('user') || interaction.user;
      if (!interaction.guildId) {
        await interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
        return;
      }
      try {
        const balance = await this.service.getBalance(interaction.guildId, user.id);
        await interaction.reply({
          embeds: [economyEmbed({
            user: { username: user.username, tag: user.tag, displayAvatarURL: () => user.displayAvatarURL() },
            userId: user.id,
            balance,
            currencyName: this.service.config.currencyName,
          })],
        });
      } catch (error) {
        this.logger.error('Economy Commands', 'Failed to get balance', error as Error);
        await interaction.reply({ content: 'Failed to get balance.', flags: MessageFlags.Ephemeral });
      }
    },
  };

  private payCommand: any = {
    data: new SlashCommandBuilder()
      .setName('pay')
      .setDescription('Pay another user')
      .addUserOption((option) => option.setName('user').setDescription('User to pay').setRequired(true))
      .addIntegerOption((option) => option.setName('amount').setDescription('Amount to pay').setRequired(true).setMinValue(1)),
    execute: async (interaction: ChatInputCommandInteraction) => {
      const target = interaction.options.getUser('user', true);
      const amount = interaction.options.getInteger('amount', true);
      if (!interaction.guildId) {
        await interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
        return;
      }
      if (target.id === interaction.user.id) {
        await interaction.reply({ content: 'You cannot pay yourself.', flags: MessageFlags.Ephemeral });
        return;
      }
      if (target.bot) {
        await interaction.reply({ content: 'Bots cannot receive payments.', flags: MessageFlags.Ephemeral });
        return;
      }
      try {
        const result = await this.service.transfer(interaction.guildId, interaction.user.id, target.id, amount);
        if (result.success) {
          await interaction.reply({
            content: `✅ Paid **${formatNumber(amount)} ${this.service.config.currencyName}** to ${target}. New balance: **${formatNumber(result.balance)}**.`,
            flags: MessageFlags.Ephemeral,
          });
        } else {
          await interaction.reply({ content: 'Insufficient balance.', flags: MessageFlags.Ephemeral });
        }
      } catch (error) {
        this.logger.error('Economy Commands', 'Failed to pay', error as Error);
        await interaction.reply({ content: `❌ ${(error as Error).message}`, flags: MessageFlags.Ephemeral });
      }
    },
  };

  private dailyCommand: any = {
    data: new SlashCommandBuilder()
      .setName('daily')
      .setDescription('Claim your daily reward'),
    execute: async (interaction: ChatInputCommandInteraction) => {
      if (!interaction.guildId) {
        await interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
        return;
      }
      try {
        const result = await this.service.claimDaily(interaction.guildId, interaction.user.id);
        if (result.alreadyClaimed) {
          const hours = Math.ceil(result.cooldownRemainingMs / 3600000);
          await interaction.reply({ content: `⏳ You already claimed your daily reward. Come back in ~${hours}h.`, flags: MessageFlags.Ephemeral });
          return;
        }
        await interaction.reply({
          embeds: [brandedEmbed('#00d084').setTitle('🎁 Daily Reward').setDescription(`You received **${formatNumber(this.service.config.dailyAmount)}** ${this.service.config.currencyName}!\nNew balance: **${formatNumber(result.balance)}**`)],
        });
      } catch (error) {
        this.logger.error('Economy Commands', 'Failed to claim daily', error as Error);
        await interaction.reply({ content: `❌ ${(error as Error).message}`, flags: MessageFlags.Ephemeral });
      }
    },
  };

  private leaderboardCommand: any = {
    data: new SlashCommandBuilder()
      .setName('rich')
      .setDescription('Richest members in this server')
      .addIntegerOption((option) => option.setName('limit').setDescription('Entries (1-25)').setMinValue(1).setMaxValue(25)),
    execute: async (interaction: ChatInputCommandInteraction) => {
      if (!interaction.guildId) {
        await interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
        return;
      }
      try {
        const rows = await this.service.getLeaderboard(interaction.guildId, interaction.options.getInteger('limit') ?? 10);
        if (!rows.length) {
          await interaction.reply({ embeds: [brandedEmbed(BRAND.gold).setTitle('💰 Richest Members').setDescription('No balances recorded yet.')] });
          return;
        }
        const lines = rows.map((r, i) => `${['🥇', '🥈', '🥉'][i] ?? `**${i + 1}.**`} <@${r.user_id}> — **${formatNumber(r.balance)}** ${this.service.config.currencyName}`);
        await interaction.reply({ embeds: [brandedEmbed(BRAND.gold).setTitle('💰 Richest Members').setDescription(lines.join('\n'))] });
      } catch (error) {
        this.logger.error('Economy Commands', 'Failed to get leaderboard', error as Error);
        await interaction.reply({ embeds: [errorEmbed('Economy', 'Failed to fetch the leaderboard.')], flags: MessageFlags.Ephemeral });
      }
    },
  };
}
