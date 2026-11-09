"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EconomyCommands = exports.EconomyService = void 0;
const discord_js_1 = require("discord.js");
const drizzle_orm_1 = require("drizzle-orm");
const schema_1 = require("../../database/schema");
class EconomyService {
    constructor(logger) {
        this.db = null;
        this.config = { enabled: true, startingBalance: 0, currencyName: 'coins' };
        this.logger = logger;
    }
    setDb(db) {
        this.db = db;
    }
    async initialize() {
        this.logger.info('Economy Service', 'Economy system initialized');
    }
    async getBalance(userId) {
        if (!this.db)
            return 0;
        const result = await this.db.select().from(schema_1.users).where((0, drizzle_orm_1.eq)(schema_1.users.id, userId));
        if (!result[0]) {
            await this.db.insert(schema_1.users).values({
                id: userId,
                username: '',
                discriminator: null,
                avatar: null,
                bot: false,
                balance: this.config.startingBalance ?? 0,
                xp: 0,
                level: 1,
                total_xp: 0,
                created_at: new Date(),
                updated_at: new Date(),
            });
            return 0;
        }
        return result[0].balance || 0;
    }
    async addBalance(userId, amount) {
        if (!this.config.enabled)
            throw new Error('Economy system is disabled');
        if (!this.db)
            return;
        const current = await this.getBalance(userId);
        await this.db.update(schema_1.users)
            .set({ balance: current + amount })
            .where((0, drizzle_orm_1.eq)(schema_1.users.id, userId));
        await this.db.insert(schema_1.economyTransactions).values({
            id: `txn_${Date.now()}`,
            guild_id: '',
            user_id: userId,
            type: 'credit',
            amount,
            description: 'Balance added',
            created_at: new Date(),
        });
    }
    async removeBalance(userId, amount) {
        if (!this.config.enabled)
            throw new Error('Economy system is disabled');
        if (!this.db)
            return false;
        const current = await this.getBalance(userId);
        if (current < amount)
            return false;
        await this.db.update(schema_1.users)
            .set({ balance: current - amount })
            .where((0, drizzle_orm_1.eq)(schema_1.users.id, userId));
        await this.db.insert(schema_1.economyTransactions).values({
            id: `txn_${Date.now()}`,
            guild_id: '',
            user_id: userId,
            type: 'debit',
            amount,
            description: 'Balance removed',
            created_at: new Date(),
        });
        return true;
    }
    async pay(fromUserId, toUserId, amount) {
        if (!(await this.removeBalance(fromUserId, amount)))
            return false;
        await this.addBalance(toUserId, amount);
        return true;
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
                .addUserOption(option => option.setName('user').setDescription('User to check')),
            execute: async (interaction) => {
                const user = interaction.options.getUser('user') || interaction.user;
                try {
                    const balance = await this.service.getBalance(user.id);
                    const embed = new discord_js_1.EmbedBuilder()
                        .setColor('#00ff00')
                        .setTitle(`💰 Balance - ${user.tag}`)
                        .setDescription(`${balance} coins`)
                        .setTimestamp();
                    await interaction.reply({ embeds: [embed] });
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
                .addUserOption(option => option.setName('user').setDescription('User to pay').setRequired(true))
                .addIntegerOption(option => option.setName('amount').setDescription('Amount to pay').setRequired(true)),
            execute: async (interaction) => {
                const target = interaction.options.getUser('user', true);
                const amount = interaction.options.getInteger('amount', true);
                if (amount <= 0) {
                    await interaction.reply({ content: 'Amount must be positive.', flags: discord_js_1.MessageFlags.Ephemeral });
                    return;
                }
                if (target.id === interaction.user.id) {
                    await interaction.reply({ content: 'You cannot pay yourself.', flags: discord_js_1.MessageFlags.Ephemeral });
                    return;
                }
                try {
                    const success = await this.service.pay(interaction.user.id, target.id, amount);
                    if (success) {
                        await interaction.reply({ content: `✅ Paid ${target.tag} ${amount} coins.`, flags: discord_js_1.MessageFlags.Ephemeral });
                    }
                    else {
                        await interaction.reply({ content: 'Insufficient balance.', flags: discord_js_1.MessageFlags.Ephemeral });
                    }
                }
                catch (error) {
                    this.logger.error('Economy Commands', 'Failed to pay', error);
                    await interaction.reply({ content: 'Failed to process payment.', flags: discord_js_1.MessageFlags.Ephemeral });
                }
            },
        };
        this.service = service;
        this.logger = logger;
    }
    getCommands() {
        return [this.balanceCommand, this.payCommand];
    }
}
exports.EconomyCommands = EconomyCommands;
