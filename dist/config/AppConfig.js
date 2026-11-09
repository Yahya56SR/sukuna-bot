"use strict";
// Sukuna Bot - Configuration System with Maximum Flexibility
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppConfigManager = void 0;
exports.initializeConfig = initializeConfig;
const discord_js_1 = require("discord.js");
class AppConfigManager {
    constructor() {
        this.config = null;
    }
    static getInstance() {
        if (!AppConfigManager.instance) {
            AppConfigManager.instance = new AppConfigManager();
        }
        return AppConfigManager.instance;
    }
    async initialize() {
        this.config = {
            environment: process.env.NODE_ENV || 'development',
            discord: {
                token: process.env.DISCORD_TOKEN || '',
                intents: [discord_js_1.GatewayIntentBits.Guilds, discord_js_1.GatewayIntentBits.GuildMessages, discord_js_1.GatewayIntentBits.GuildMembers],
                partials: ['Message'],
                intentsByName: [],
                retryOnError: process.env.DISCORD_RETRY_ON_ERROR !== 'false',
                retryCount: parseInt(process.env.DISCORD_RETRY_COUNT || '3'),
                retryDelay: parseInt(process.env.DISCORD_RETRY_DELAY || '5000'),
            },
            logging: {
                level: process.env.LOG_LEVEL || 'info',
                format: process.env.LOG_FORMAT || 'pretty',
                destinations: [{ type: 'console' }],
                categories: { system: { type: 'console' }, discord: { type: 'console' }, commands: { type: 'console' }, events: { type: 'console' } },
            },
            database: {
                path: process.env.DATABASE_PATH || './data/sukuna.db',
                migrations: process.env.DB_MIGRATIONS === 'true' || true,
                connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT || '10'),
            },
            commands: {
                prefix: process.env.COMMAND_PREFIX || '!',
                caseInsensitive: process.env.COMMAND_CASE_INSENSITIVE !== 'false',
            },
        };
        if (!this.config) {
            throw new Error('Configuration not initialized');
        }
        return this.config;
    }
    getConfig() {
        if (!this.config) {
            throw new Error('Configuration not initialized');
        }
        return this.config;
    }
}
exports.AppConfigManager = AppConfigManager;
function initializeConfig() {
    const manager = AppConfigManager.getInstance();
    AppConfigManager.instance = manager;
    const config = {
        environment: process.env.NODE_ENV || 'development',
        discord: {
            token: process.env.DISCORD_TOKEN || '',
            intents: [discord_js_1.GatewayIntentBits.Guilds, discord_js_1.GatewayIntentBits.GuildMessages, discord_js_1.GatewayIntentBits.GuildMembers],
            partials: ['Message'],
            intentsByName: [],
            retryOnError: process.env.DISCORD_RETRY_ON_ERROR !== 'false',
            retryCount: parseInt(process.env.DISCORD_RETRY_COUNT || '3'),
            retryDelay: parseInt(process.env.DISCORD_RETRY_DELAY || '5000'),
        },
        logging: {
            level: process.env.LOG_LEVEL || 'info',
            format: process.env.LOG_FORMAT || 'pretty',
            destinations: [{ type: 'console' }],
            categories: { system: { type: 'console' }, discord: { type: 'console' }, commands: { type: 'console' }, events: { type: 'console' } },
        },
        database: {
            path: process.env.DATABASE_PATH || './data/sukuna.db',
            migrations: process.env.DB_MIGRATIONS === 'true' || true,
            connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT || '10'),
        },
        commands: {
            prefix: process.env.COMMAND_PREFIX || '!',
            caseInsensitive: process.env.COMMAND_CASE_INSENSITIVE !== 'false',
        },
    };
    manager['config'] = config;
    return config;
}
