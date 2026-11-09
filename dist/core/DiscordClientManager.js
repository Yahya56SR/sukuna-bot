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
            intents: this.convertStringIntentsToNumber(this.config.intents),
            partials: this.config.partials,
        });
        this.setupEventHandlers();
        try {
            await this.client.login(this.config.token);
            this.logger.info('Discord Client', 'Client logged in successfully');
        }
        catch (error) {
            if (this.config.retryOnError && this.config.retryCount > 0) {
                this.logger.warn('Discord Client', `Login failed, retrying in ${this.config.retryDelay}ms... (Attempt: ${this.config.retryCount})`);
                await this.delay(this.config.retryDelay);
                return this.initialize();
            }
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
            this.logger.warn('Discord Client', `Disconnected: ${event.code} ${event.reason}`);
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
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    convertStringIntentsToNumber(intents) {
        const intentMap = {
            'Guilds': discord_js_1.GatewayIntentBits.Guilds,
            'GuildMessages': discord_js_1.GatewayIntentBits.GuildMessages,
            'GuildMembers': discord_js_1.GatewayIntentBits.GuildMembers,
            'GuildPresences': discord_js_1.GatewayIntentBits.GuildPresences,
            'GuildBans': discord_js_1.GatewayIntentBits.GuildBans,
            'GuildEmojisAndStickers': discord_js_1.GatewayIntentBits.GuildEmojisAndStickers,
            'GuildIntegrations': discord_js_1.GatewayIntentBits.GuildIntegrations,
            'DirectMessages': discord_js_1.GatewayIntentBits.DirectMessages,
            'DirectMessageReactions': discord_js_1.GatewayIntentBits.DirectMessageReactions,
            'MessageContent': discord_js_1.GatewayIntentBits.MessageContent,
            'GuildScheduledEvents': discord_js_1.GatewayIntentBits.GuildScheduledEvents,
            'GuildVoiceStates': discord_js_1.GatewayIntentBits.GuildVoiceStates,
            'ServerMember': discord_js_1.GatewayIntentBits.GuildMembers,
        };
        const numericIntents = [];
        for (const intent of intents) {
            if (typeof intent === 'number') {
                numericIntents.push(intent);
            }
            else if (intent in intentMap) {
                numericIntents.push(intentMap[intent]);
            }
            else if (this.isNumericString(intent)) {
                numericIntents.push(parseInt(intent));
            }
            else {
                this.logger.warn('Discord Client', `Unknown intent: ${intent}, skipping`);
            }
        }
        return numericIntents;
    }
    isNumericString(value) {
        return !isNaN(parseInt(value));
    }
}
exports.DiscordClientManager = DiscordClientManager;
