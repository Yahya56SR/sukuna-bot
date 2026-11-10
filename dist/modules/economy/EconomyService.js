"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EconomyCommands = exports.EconomyService = void 0;
const discord_js_1 = require("discord.js");
const drizzle_orm_1 = require("drizzle-orm");
const schema_1 = require("../../database/schema");
const embed_1 = require("../../utils/embed");
const id_1 = require("../../utils/id");
const LEGACY_GUILD = 'global';
/**
 * Guild-scoped, ledger-backed economy.
 *
 * Money is never read-then-written in JavaScript: every mutation is a single
 * conditional SQL statement executed inside a transaction, so concurrent
 * commands cannot duplicate or lose funds.
 */
class EconomyService {
    constructor(logger, config) {
        this.db = null;
        this.config = {
            enabled: true,
            startingBalance: 0,
            currencyName: 'coins',
            maxTransfer: 0,
            dailyAmount: 0,
            dailyCooldownHours: 24,
        };
        this.logger = logger;
        if (config)
            this.config = { ...this.config, ...config };
    }
    setDb(db) {
        this.db = db;
    }
    async initialize() {
        this.logger.info('Economy Service', `Economy initialized (currency: ${this.config.currencyName})`);
    }
    /**
     * Accepts both `(userId)` (legacy) and `(guildId, userId)`.
     * Guild-scoped calls are the source of truth; the single-argument form
     * resolves to the legacy `global` bucket.
     */
    resolveKey(first, second) {
        return second === undefined ? { guildId: LEGACY_GUILD, userId: first } : { guildId: first, userId: second };
    }
    assertEnabled() {
        if (!this.config.enabled)
            throw new Error('Economy system is disabled');
    }
    validateAmount(amount) {
        if (!Number.isFinite(amount))
            throw new Error('Invalid amount');
        const rounded = Math.floor(amount * 100) / 100;
        if (rounded <= 0)
            throw new Error('Amount must be positive');
        return rounded;
    }
    async getBalance(guildId, userId) {
        if (!this.db)
            return 0;
        const key = this.resolveKey(guildId, userId);
        const row = await this.db
            .select({ balance: schema_1.economyAccounts.balance })
            .from(schema_1.economyAccounts)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.economyAccounts.guild_id, key.guildId), (0, drizzle_orm_1.eq)(schema_1.economyAccounts.user_id, key.userId)))
            .limit(1);
        if (row[0])
            return Number(row[0].balance ?? 0);
        await this.ensureAccount(key.guildId, key.userId);
        return this.config.startingBalance ?? 0;
    }
    nowSeconds() {
        return Math.floor(Date.now() / 1000);
    }
    async ensureAccount(guildId, userId) {
        if (!this.db)
            return;
        await this.db.run((0, drizzle_orm_1.sql) `
      INSERT INTO economy_accounts (guild_id, user_id, balance, updated_at)
      VALUES (${guildId}, ${userId}, ${this.config.startingBalance ?? 0}, ${this.nowSeconds()})
      ON CONFLICT(guild_id, user_id) DO NOTHING
    `);
    }
    /** Add funds. Returns the resulting balance. */
    async credit(guildId, userId, amount, opts = {}) {
        const key = this.resolveKey(guildId, userId);
        return this.creditResolved(key.guildId, key.userId, amount, opts);
    }
    async creditResolved(guildId, userId, amount, opts) {
        this.assertEnabled();
        if (!this.db)
            return 0;
        const value = this.validateAmount(amount);
        const db = this.db;
        return db.transaction((tx) => {
            const now = this.nowSeconds();
            tx.run((0, drizzle_orm_1.sql) `
        INSERT INTO economy_accounts (guild_id, user_id, balance, updated_at)
        VALUES (${guildId}, ${userId}, ${this.config.startingBalance ?? 0}, ${now})
        ON CONFLICT(guild_id, user_id) DO NOTHING
      `);
            tx.run((0, drizzle_orm_1.sql) `
        UPDATE economy_accounts
        SET balance = balance + ${value}, updated_at = ${now}
        WHERE guild_id = ${guildId} AND user_id = ${userId}
      `);
            const row = tx.get((0, drizzle_orm_1.sql) `
        SELECT balance FROM economy_accounts WHERE guild_id = ${guildId} AND user_id = ${userId}
      `);
            const balance = Number(row?.balance ?? 0);
            tx.insert(schema_1.economyTransactions).values({
                id: (0, id_1.newId)('txn'),
                guild_id: guildId,
                user_id: userId,
                type: opts.type ?? 'credit',
                amount: value,
                balance_after: balance,
                description: opts.description ?? 'Balance credited',
                reference: opts.reference ?? null,
                created_at: new Date(now * 1000),
            }).run();
            this.mirrorLegacyBalance(tx, userId, balance);
            return balance;
        });
    }
    /** Remove funds atomically. Fails (without changing anything) if the user is short. */
    async debit(guildId, userId, amount, opts = {}) {
        const key = this.resolveKey(guildId, userId);
        return this.debitResolved(key.guildId, key.userId, amount, opts);
    }
    async debitResolved(guildId, userId, amount, opts) {
        this.assertEnabled();
        if (!this.db)
            return { success: false, balance: 0, amount: 0 };
        const value = this.validateAmount(amount);
        const db = this.db;
        return db.transaction((tx) => {
            const now = this.nowSeconds();
            tx.run((0, drizzle_orm_1.sql) `
        INSERT INTO economy_accounts (guild_id, user_id, balance, updated_at)
        VALUES (${guildId}, ${userId}, ${this.config.startingBalance ?? 0}, ${now})
        ON CONFLICT(guild_id, user_id) DO NOTHING
      `);
            const result = tx.run((0, drizzle_orm_1.sql) `
        UPDATE economy_accounts
        SET balance = balance - ${value}, updated_at = ${now}
        WHERE guild_id = ${guildId} AND user_id = ${userId} AND balance >= ${value}
      `);
            const row = tx.get((0, drizzle_orm_1.sql) `
        SELECT balance FROM economy_accounts WHERE guild_id = ${guildId} AND user_id = ${userId}
      `);
            const balance = Number(row?.balance ?? 0);
            if (Number(result.changes ?? 0) === 0) {
                return { success: false, balance, amount: value };
            }
            tx.insert(schema_1.economyTransactions).values({
                id: (0, id_1.newId)('txn'),
                guild_id: guildId,
                user_id: userId,
                type: opts.type ?? 'debit',
                amount: -value,
                balance_after: balance,
                description: opts.description ?? 'Balance debited',
                reference: opts.reference ?? null,
                created_at: new Date(now * 1000),
            }).run();
            this.mirrorLegacyBalance(tx, userId, balance);
            return { success: true, balance, amount: value };
        });
    }
    /**
     * Atomic transfer between two wallets. Both ledger rows and both balance
     * updates commit together, or nothing changes.
     */
    async transfer(guildId, fromUserId, toUserId, amount, description = 'Member transfer') {
        const from = { guildId, userId: fromUserId };
        const to = { guildId, userId: toUserId };
        this.assertEnabled();
        if (!this.db)
            return { success: false, balance: 0, amount: 0 };
        if (from.userId === to.userId)
            throw new Error('You cannot transfer to yourself');
        const value = this.validateAmount(amount);
        if (this.config.maxTransfer > 0 && value > this.config.maxTransfer) {
            throw new Error(`Transfers are limited to ${(0, embed_1.formatNumber)(this.config.maxTransfer)} ${this.config.currencyName}`);
        }
        const db = this.db;
        return db.transaction((tx) => {
            const now = this.nowSeconds();
            for (const uid of [from.userId, to.userId]) {
                tx.run((0, drizzle_orm_1.sql) `
          INSERT INTO economy_accounts (guild_id, user_id, balance, updated_at)
          VALUES (${from.guildId}, ${uid}, ${this.config.startingBalance ?? 0}, ${now})
          ON CONFLICT(guild_id, user_id) DO NOTHING
        `);
            }
            const result = tx.run((0, drizzle_orm_1.sql) `
        UPDATE economy_accounts
        SET balance = balance - ${value}, updated_at = ${now}
        WHERE guild_id = ${from.guildId} AND user_id = ${from.userId} AND balance >= ${value}
      `);
            const fromRow = tx.get((0, drizzle_orm_1.sql) `
        SELECT balance FROM economy_accounts WHERE guild_id = ${from.guildId} AND user_id = ${from.userId}
      `);
            const fromBalance = Number(fromRow?.balance ?? 0);
            if (Number(result.changes ?? 0) === 0) {
                return { success: false, balance: fromBalance, amount: value };
            }
            tx.run((0, drizzle_orm_1.sql) `
        UPDATE economy_accounts
        SET balance = balance + ${value}, updated_at = ${now}
        WHERE guild_id = ${to.guildId} AND user_id = ${to.userId}
      `);
            const toRow = tx.get((0, drizzle_orm_1.sql) `
        SELECT balance FROM economy_accounts WHERE guild_id = ${to.guildId} AND user_id = ${to.userId}
      `);
            const toBalance = Number(toRow?.balance ?? 0);
            const createdAt = new Date(now * 1000);
            tx.insert(schema_1.economyTransactions).values([
                {
                    id: (0, id_1.newId)('txn'), guild_id: from.guildId, user_id: from.userId, type: 'transfer_out',
                    amount: -value, balance_after: fromBalance, description, reference: to.userId, created_at: createdAt,
                },
                {
                    id: (0, id_1.newId)('txn'), guild_id: to.guildId, user_id: to.userId, type: 'transfer_in',
                    amount: value, balance_after: toBalance, description, reference: from.userId, created_at: createdAt,
                },
            ]).run();
            this.mirrorLegacyBalance(tx, from.userId, fromBalance);
            this.mirrorLegacyBalance(tx, to.userId, toBalance);
            return { success: true, balance: fromBalance, amount: value };
        });
    }
    /** Set an absolute balance (dashboard/admin). Uses credit/debit internally. */
    async setBalance(guildId, userId, target) {
        const key = this.resolveKey(guildId, userId);
        if (!Number.isFinite(target) || target < 0)
            throw new Error('Balance must be a non-negative number');
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
    async addBalance(userId, amount) {
        await this.credit(LEGACY_GUILD, userId, amount, { description: 'Balance added' });
    }
    async removeBalance(userId, amount) {
        const result = await this.debit(LEGACY_GUILD, userId, amount, { description: 'Balance removed' });
        return result.success;
    }
    async pay(fromUserId, toUserId, amount) {
        const result = await this.transfer(LEGACY_GUILD, fromUserId, toUserId, amount);
        return result.success;
    }
    /** Daily reward, once per cooldown window per guild per user. */
    async claimDaily(guildId, userId) {
        this.assertEnabled();
        if (!this.db)
            throw new Error('Database not connected');
        const amount = Math.floor(this.config.dailyAmount ?? 0);
        if (!Number.isFinite(amount) || amount <= 0)
            throw new Error('Daily rewards are disabled on this server');
        const cooldownMs = Math.max(1, Math.floor(this.config.dailyCooldownHours ?? 24)) * 60 * 60 * 1000;
        const recent = await this.db
            .select({ created_at: schema_1.economyTransactions.created_at })
            .from(schema_1.economyTransactions)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.economyTransactions.guild_id, guildId), (0, drizzle_orm_1.eq)(schema_1.economyTransactions.user_id, userId), (0, drizzle_orm_1.eq)(schema_1.economyTransactions.type, 'daily')))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.economyTransactions.created_at))
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
    async getLeaderboard(guildId, limit = 10) {
        if (!this.db)
            return [];
        const rows = await this.db
            .select({ user_id: schema_1.economyAccounts.user_id, balance: schema_1.economyAccounts.balance })
            .from(schema_1.economyAccounts)
            .where((0, drizzle_orm_1.eq)(schema_1.economyAccounts.guild_id, guildId))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.economyAccounts.balance))
            .limit(Math.max(1, Math.min(100, Math.floor(limit))));
        return rows.map((r) => ({ user_id: r.user_id, balance: Number(r.balance ?? 0) }));
    }
    async getTransactions(guildId, userId, limit = 10) {
        if (!this.db)
            return [];
        const where = userId
            ? (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.economyTransactions.guild_id, guildId), (0, drizzle_orm_1.eq)(schema_1.economyTransactions.user_id, userId))
            : (0, drizzle_orm_1.eq)(schema_1.economyTransactions.guild_id, guildId);
        return this.db
            .select()
            .from(schema_1.economyTransactions)
            .where(where)
            .orderBy((0, drizzle_orm_1.desc)(schema_1.economyTransactions.created_at))
            .limit(Math.max(1, Math.min(100, Math.floor(limit))));
    }
    /** Keep the legacy `users.balance` column in sync for old dashboard queries. */
    mirrorLegacyBalance(tx, userId, balance) {
        try {
            tx.run((0, drizzle_orm_1.sql) `UPDATE users SET balance = ${balance}, updated_at = ${this.nowSeconds()} WHERE id = ${userId}`);
        }
        catch {
            // User row may not exist yet; the guild wallet is authoritative.
        }
    }
    /** Ensure a user metadata row exists (called on first wallet write). */
    async ensureUser(userId, username = '') {
        if (!this.db)
            return;
        const now = this.nowSeconds();
        await this.db.run((0, drizzle_orm_1.sql) `
      INSERT INTO users (id, username, bot, balance, xp, level, total_xp, created_at, updated_at)
      VALUES (${userId}, ${username}, 0, 0, 0, 1, 0, ${now}, ${now})
      ON CONFLICT(id) DO NOTHING
    `);
    }
    async shutdown() {
        this.logger.info('Economy Service', 'Economy system shutdown');
    }
}
exports.EconomyService = EconomyService;
class EconomyCommands {
    constructor(service, logger) {
        this.balanceCommand = {
            data: new discord_js_1.SlashCommandBuilder()
                .setName('balance')
                .setDescription('Check your balance')
                .addUserOption((option) => option.setName('user').setDescription('User to check')),
            execute: async (interaction) => {
                const user = interaction.options.getUser('user') || interaction.user;
                if (!interaction.guildId) {
                    await interaction.reply({ content: 'This command can only be used in a server.', flags: discord_js_1.MessageFlags.Ephemeral });
                    return;
                }
                try {
                    const balance = await this.service.getBalance(interaction.guildId, user.id);
                    await interaction.reply({
                        embeds: [(0, embed_1.economyEmbed)({
                                user: { username: user.username, tag: user.tag, displayAvatarURL: () => user.displayAvatarURL() },
                                userId: user.id,
                                balance,
                                currencyName: this.service.config.currencyName,
                            })],
                    });
                }
                catch (error) {
                    this.logger.error('Economy Commands', 'Failed to get balance', error);
                    await interaction.reply({ content: 'Failed to get balance.', flags: discord_js_1.MessageFlags.Ephemeral });
                }
            },
        };
        this.payCommand = {
            data: new discord_js_1.SlashCommandBuilder()
                .setName('pay')
                .setDescription('Pay another user')
                .addUserOption((option) => option.setName('user').setDescription('User to pay').setRequired(true))
                .addIntegerOption((option) => option.setName('amount').setDescription('Amount to pay').setRequired(true).setMinValue(1)),
            execute: async (interaction) => {
                const target = interaction.options.getUser('user', true);
                const amount = interaction.options.getInteger('amount', true);
                if (!interaction.guildId) {
                    await interaction.reply({ content: 'This command can only be used in a server.', flags: discord_js_1.MessageFlags.Ephemeral });
                    return;
                }
                if (target.id === interaction.user.id) {
                    await interaction.reply({ content: 'You cannot pay yourself.', flags: discord_js_1.MessageFlags.Ephemeral });
                    return;
                }
                if (target.bot) {
                    await interaction.reply({ content: 'Bots cannot receive payments.', flags: discord_js_1.MessageFlags.Ephemeral });
                    return;
                }
                try {
                    const result = await this.service.transfer(interaction.guildId, interaction.user.id, target.id, amount);
                    if (result.success) {
                        await interaction.reply({
                            content: `✅ Paid **${(0, embed_1.formatNumber)(amount)} ${this.service.config.currencyName}** to ${target}. New balance: **${(0, embed_1.formatNumber)(result.balance)}**.`,
                            flags: discord_js_1.MessageFlags.Ephemeral,
                        });
                    }
                    else {
                        await interaction.reply({ content: 'Insufficient balance.', flags: discord_js_1.MessageFlags.Ephemeral });
                    }
                }
                catch (error) {
                    this.logger.error('Economy Commands', 'Failed to pay', error);
                    await interaction.reply({ content: `❌ ${error.message}`, flags: discord_js_1.MessageFlags.Ephemeral });
                }
            },
        };
        this.dailyCommand = {
            data: new discord_js_1.SlashCommandBuilder()
                .setName('daily')
                .setDescription('Claim your daily reward'),
            execute: async (interaction) => {
                if (!interaction.guildId) {
                    await interaction.reply({ content: 'This command can only be used in a server.', flags: discord_js_1.MessageFlags.Ephemeral });
                    return;
                }
                try {
                    const result = await this.service.claimDaily(interaction.guildId, interaction.user.id);
                    if (result.alreadyClaimed) {
                        const hours = Math.ceil(result.cooldownRemainingMs / 3600000);
                        await interaction.reply({ content: `⏳ You already claimed your daily reward. Come back in ~${hours}h.`, flags: discord_js_1.MessageFlags.Ephemeral });
                        return;
                    }
                    await interaction.reply({
                        embeds: [(0, embed_1.brandedEmbed)('#00d084').setTitle('🎁 Daily Reward').setDescription(`You received **${(0, embed_1.formatNumber)(this.service.config.dailyAmount)}** ${this.service.config.currencyName}!\nNew balance: **${(0, embed_1.formatNumber)(result.balance)}**`)],
                    });
                }
                catch (error) {
                    this.logger.error('Economy Commands', 'Failed to claim daily', error);
                    await interaction.reply({ content: `❌ ${error.message}`, flags: discord_js_1.MessageFlags.Ephemeral });
                }
            },
        };
        this.leaderboardCommand = {
            data: new discord_js_1.SlashCommandBuilder()
                .setName('rich')
                .setDescription('Richest members in this server')
                .addIntegerOption((option) => option.setName('limit').setDescription('Entries (1-25)').setMinValue(1).setMaxValue(25)),
            execute: async (interaction) => {
                if (!interaction.guildId) {
                    await interaction.reply({ content: 'This command can only be used in a server.', flags: discord_js_1.MessageFlags.Ephemeral });
                    return;
                }
                try {
                    const rows = await this.service.getLeaderboard(interaction.guildId, interaction.options.getInteger('limit') ?? 10);
                    if (!rows.length) {
                        await interaction.reply({ embeds: [(0, embed_1.brandedEmbed)(embed_1.BRAND.gold).setTitle('💰 Richest Members').setDescription('No balances recorded yet.')] });
                        return;
                    }
                    const lines = rows.map((r, i) => `${['🥇', '🥈', '🥉'][i] ?? `**${i + 1}.**`} <@${r.user_id}> — **${(0, embed_1.formatNumber)(r.balance)}** ${this.service.config.currencyName}`);
                    await interaction.reply({ embeds: [(0, embed_1.brandedEmbed)(embed_1.BRAND.gold).setTitle('💰 Richest Members').setDescription(lines.join('\n'))] });
                }
                catch (error) {
                    this.logger.error('Economy Commands', 'Failed to get leaderboard', error);
                    await interaction.reply({ embeds: [(0, embed_1.errorEmbed)('Economy', 'Failed to fetch the leaderboard.')], flags: discord_js_1.MessageFlags.Ephemeral });
                }
            },
        };
        this.service = service;
        this.logger = logger;
    }
    getCommands() {
        return [this.balanceCommand, this.payCommand, this.leaderboardCommand, this.dailyCommand];
    }
}
exports.EconomyCommands = EconomyCommands;
