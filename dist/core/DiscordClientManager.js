"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DiscordClientManager = void 0;
const discord_js_1 = require("discord.js");
class DiscordClientManager {
    constructor(config, logger) {
        this.client = null;
        this.isReady = false;
        this.config = config;
        this.logger = logger;
    }
    async initialize() {
        this.client = new discord_js_1.Client({
            intents: this.config.intents,
            partials: this.config.partials,
        });
        this.setupEventHandlers();
        try {
            await this.client.login(this.config.token);
            this.logger.info('Discord Client', 'Client logged in successfully');
        }
        catch (error) {
            this.logger.error('Discord Client', 'Failed to login to Discord', error);
            throw error;
        }
        return this.client;
    }
    setupEventHandlers() {
        if (!this.client)
            return;
        this.client.on(discord_js_1.Events.ClientReady, () => {
            this.isReady = true;
            this.logger.info('Discord Client', `Bot ready as ${this.client?.user?.tag}`);
        });
        this.client.on(discord_js_1.Events.Error, (error) => {
            this.logger.error('Discord Client', 'Discord client error', error);
        });
        this.client.on(discord_js_1.Events.Warn, (warning) => {
            this.logger.warn('Discord Client', 'Discord client warning', warning);
        });
        this.client.on(discord_js_1.Events.ShardDisconnect, (event) => {
            this.isReady = false;
            this.logger.warn('Discord Client', `Disconnected: ${event.code}`);
        });
        this.client.on(discord_js_1.Events.ShardReconnecting, () => {
            this.logger.info('Discord Client', 'Reconnecting to Discord...');
        });
    }
    getClient() {
        if (!this.client) {
            throw new Error('Client not initialized');
        }
        return this.client;
    }
    isClientReady() {
        return this.isReady;
    }
    async shutdown() {
        if (this.client) {
            await this.client.destroy();
            this.client = null;
            this.isReady = false;
        }
    }
}
exports.DiscordClientManager = DiscordClientManager;
