"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SukunaApp = void 0;
const discord_js_1 = require("discord.js");
require('dotenv').config();
class SukunaApp {
    constructor() {
        const { initializeConfig } = require('./config/AppConfig');
        const { Logger } = require('./infrastructure/Logger');
        const { DatabaseManager } = require('./database/DatabaseManager');
        const { DiscordClientManager } = require('./core/DiscordClientManager');
        const { CommandRegistry } = require('./discord/CommandRegistry');
        const { EventRegistry } = require('./discord/EventRegistry');
        const { InteractionRouter } = require('./discord/InteractionRouter');
        const { ModerationService } = require('./modules/moderation/ModerationService');
        const { LevelingService } = require('./modules/leveling/LevelingService');
        const { EconomyService } = require('./modules/economy/EconomyService');
        const { AIService } = require('./modules/ai/AIService');
        const { MusicService } = require('./modules/music/MusicService');
        const { AutomationService } = require('./services/AutomationService');
        const { AnalyticsService } = require('./services/AnalyticsService');
        const { TempVCService } = require('./modules/tempvc/TempVCService');
        const { EconomyGamesService } = require('./modules/economy/EconomyGames');
        const { WebServer } = require('./web/WebServer');
        this.config = initializeConfig();
        this.logger = new Logger();
        this.database = new DatabaseManager(this.config.database);
        this.discord = new DiscordClientManager(this.config.discord, this.logger);
        this.commands = new CommandRegistry(this.logger);
        this.events = new EventRegistry(this.logger);
        this.interactions = new InteractionRouter(this.commands);
        this.moderation = new ModerationService(this.logger);
        this.leveling = new LevelingService(this.logger, {
            enabled: true,
            xpFormula: 'quadratic',
            baseXpPerLevel: 100,
            xpMultiplier: 1,
            customXpTable: {},
            xpSources: {
                message: { enabled: true, min: 15, max: 25, cooldownSeconds: 60 },
                voice: { enabled: true, perMinuteMin: 5, perMinuteMax: 8, cooldownSeconds: 60 },
                command: { enabled: true, amount: 10, cooldownSeconds: 300 },
            },
            xpMultipliers: {
                weekend: 1.5,
                booster: 2.0,
                role: {},
            },
            noXpChannels: [],
            xpChannelWhitelist: [],
            levelRoles: [
                { level: 5, roleId: process.env.LEVELING_DISTINCT_ROLE_ID || '', replaceLower: false },
                { level: 15, roleId: process.env.LEVELING_LOYAL_ROLE_ID || '', replaceLower: false },
            ],
            announcementChannels: [
                { channelId: process.env.LEVELING_LEVELS_CHANNEL_ID || '', minLevel: 1, color: '#0099ff' },
                { channelId: process.env.LEVELING_STAFF_CMD_CHANNEL_ID || '', minLevel: 1, color: '#ffd700' },
            ],
            defaultColor: '#0099ff',
            ignoreBots: true,
            maxLevel: 100,
        });
        this.economy = new EconomyService(this.logger);
        this.ai = new AIService(this.logger, {
            enabled: true,
            displayName: process.env.AI_DISPLAY_NAME || 'Sukuna',
            model: process.env.AI_MODEL || 'gemini-1.5-flash',
            systemPrompt: process.env.AI_SYSTEM_PROMPT || 'You are Sukuna, a helpful and powerful Discord bot assistant.',
            channelIds: process.env.AI_CHANNEL_IDS ? process.env.AI_CHANNEL_IDS.split(',') : [],
            historySize: parseInt(process.env.AI_HISTORY_SIZE || '30'),
            batchWindowMs: parseInt(process.env.AI_BATCH_WINDOW_MS || '2500'),
            replyCooldownSeconds: parseInt(process.env.AI_REPLY_COOLDOWN_SECONDS || '25'),
            decisionCooldownSeconds: parseInt(process.env.AI_DECISION_COOLDOWN_SECONDS || '10'),
            maxRepliesPerHour: parseInt(process.env.AI_MAX_REPLIES_PER_HOUR || '40'),
            maxMessageLength: parseInt(process.env.AI_MAX_MESSAGE_LENGTH || '500'),
            showTyping: false,
            temperature: parseFloat(process.env.AI_TEMPERATURE || '1'),
            requestTimeoutMs: parseInt(process.env.AI_REQUEST_TIMEOUT_MS || '20000'),
            apiKey: process.env.GEMINI_API_KEY || '',
        });
        this.music = new MusicService(this.logger, {
            enabled: true,
            lavalinkHost: 'localhost',
            lavalinkPort: 2333,
            lavalinkPassword: 'youshallnotpass',
        });
        this.automation = new AutomationService(this.logger);
        this.analytics = new AnalyticsService(this.logger);
        this.tempvc = new TempVCService(this.logger);
        this.economyGames = new EconomyGamesService(this.logger);
        this.web = new WebServer(this.logger, this, parseInt(process.env.SERVER_PORT || process.env.WEB_PORT || '3000'));
    }
    static getInstance() {
        if (!SukunaApp.instance) {
            SukunaApp.instance = new SukunaApp();
        }
        return SukunaApp.instance;
    }
    async initialize() {
        try {
            this.logger.info('Sukuna Bot', 'Starting application initialization...');
            await this.database.initialize();
            this.logger.info('Sukuna Bot', 'Database initialized successfully');
            this.moderation.setDb(this.database.getDb());
            this.logger.info('Sukuna Bot', 'Moderation service connected to database');
            const moderationCommands = new (require('./modules/moderation/ModerationCommands').ModerationCommands)(this.moderation, this.logger);
            for (const cmd of moderationCommands.getCommands()) {
                this.commands.registerCommand(cmd);
            }
            this.logger.info('Sukuna Bot', `Registered ${moderationCommands.getCommands().length} moderation commands`);
            await this.leveling.initialize();
            this.leveling.setDb(this.database.getDb());
            this.leveling.setClient(this.client);
            this.logger.info('Sukuna Bot', 'Leveling service connected to database');
            const levelingCommands = new (require('./modules/leveling/LevelingService').LevelingCommands)(this.leveling, this.logger, {
                enabled: true,
                xpFormula: 'quadratic',
                baseXpPerLevel: 100,
                xpMultiplier: 1,
                customXpTable: {},
                xpSources: {
                    message: { enabled: true, min: 15, max: 25, cooldownSeconds: 60 },
                    voice: { enabled: true, perMinuteMin: 5, perMinuteMax: 8, cooldownSeconds: 60 },
                    command: { enabled: true, amount: 10, cooldownSeconds: 300 },
                },
                xpMultipliers: {
                    weekend: 1.5,
                    booster: 2.0,
                    role: {},
                },
                noXpChannels: [],
                xpChannelWhitelist: [],
                levelRoles: [
                    { level: 5, roleId: process.env.LEVELING_DISTINCT_ROLE_ID || '', replaceLower: false },
                    { level: 15, roleId: process.env.LEVELING_LOYAL_ROLE_ID || '', replaceLower: false },
                ],
                announcementChannels: [
                    { channelId: process.env.LEVELING_LEVELS_CHANNEL_ID || '', minLevel: 1, color: '#0099ff' },
                    { channelId: process.env.LEVELING_STAFF_CMD_CHANNEL_ID || '', minLevel: 1, color: '#ffd700' },
                ],
                defaultColor: '#0099ff',
                ignoreBots: true,
                maxLevel: 100,
            });
            for (const cmd of levelingCommands.getCommands()) {
                this.commands.registerCommand(cmd);
            }
            this.logger.info('Sukuna Bot', `Registered ${levelingCommands.getCommands().length} leveling commands`);
            this.economy.setDb(this.database.getDb());
            this.logger.info('Sukuna Bot', 'Economy service connected to database');
            const economyCommands = new (require('./modules/economy/EconomyService').EconomyCommands)(this.economy, this.logger);
            for (const cmd of economyCommands.getCommands()) {
                this.commands.registerCommand(cmd);
            }
            this.logger.info('Sukuna Bot', `Registered ${economyCommands.getCommands().length} economy commands`);
            this.economyGames.setDb(this.database.getDb());
            await this.economyGames.initialize();
            this.logger.info('Sukuna Bot', 'Economy games service initialized');
            const economyGamesCommands = new (require('./modules/economy/EconomyGames').EconomyGamesCommands)(this.economyGames, this.logger);
            for (const cmd of economyGamesCommands.getCommands()) {
                this.commands.registerCommand(cmd);
            }
            this.logger.info('Sukuna Bot', `Registered ${economyGamesCommands.getCommands().length} economy games commands`);
            this.client = await this.discord.initialize();
            this.logger.info('Sukuna Bot', 'Discord client initialized successfully');
            // Set client on services that need it
            this.leveling.setClient(this.client);
            this.tempvc.setDb(this.database.getDb());
            this.tempvc.setClient(this.client);
            await this.tempvc.initialize();
            this.interactions.setTempVCService(this.tempvc);
            this.logger.info('Sukuna Bot', 'Temp VC service linked to interaction router');
            const tempvcCommands = new (require('./modules/tempvc/TempVCCommands').TempVCCommands)(this.tempvc, this.logger);
            for (const cmd of tempvcCommands.getCommands()) {
                this.commands.registerCommand(cmd);
            }
            this.logger.info('Sukuna Bot', `Registered ${tempvcCommands.getCommands().length} temp VC commands`);
            this.ai.setDb(this.database.getDb());
            this.ai.setClient(this.client);
            await this.ai.initialize();
            this.logger.info('Sukuna Bot', 'AI service initialized');
            const aiCommands = new (require('./modules/ai/AIService').AICommands)(this.ai, this.logger, {
                enabled: true,
                displayName: process.env.AI_DISPLAY_NAME || 'Sukuna',
                model: process.env.AI_MODEL || 'gemini-1.5-flash',
                systemPrompt: process.env.AI_SYSTEM_PROMPT || 'You are Sukuna, a helpful and powerful Discord bot assistant.',
                channelIds: process.env.AI_CHANNEL_IDS ? process.env.AI_CHANNEL_IDS.split(',') : [],
                historySize: parseInt(process.env.AI_HISTORY_SIZE || '30'),
                batchWindowMs: parseInt(process.env.AI_BATCH_WINDOW_MS || '2500'),
                replyCooldownSeconds: parseInt(process.env.AI_REPLY_COOLDOWN_SECONDS || '25'),
                decisionCooldownSeconds: parseInt(process.env.AI_DECISION_COOLDOWN_SECONDS || '10'),
                maxRepliesPerHour: parseInt(process.env.AI_MAX_REPLIES_PER_HOUR || '40'),
                maxMessageLength: parseInt(process.env.AI_MAX_MESSAGE_LENGTH || '500'),
                showTyping: false,
                temperature: parseFloat(process.env.AI_TEMPERATURE || '1'),
                requestTimeoutMs: parseInt(process.env.AI_REQUEST_TIMEOUT_MS || '20000'),
                apiKey: process.env.GEMINI_API_KEY || '',
            });
            for (const cmd of aiCommands.getCommands()) {
                this.commands.registerCommand(cmd);
            }
            this.logger.info('Sukuna Bot', `Registered ${aiCommands.getCommands().length} AI commands`);
            this.music.setDb(this.database.getDb());
            await this.music.initialize();
            this.logger.info('Sukuna Bot', 'Music service initialized');
            const musicCommands = new (require('./modules/music/MusicService').MusicCommands)(this.music, this.logger);
            for (const cmd of musicCommands.getCommands()) {
                this.commands.registerCommand(cmd);
            }
            this.logger.info('Sukuna Bot', `Registered ${musicCommands.getCommands().length} music commands`);
            this.automation.setDb(this.database.getDb());
            await this.automation.initialize();
            this.logger.info('Sukuna Bot', 'Automation service initialized');
            this.analytics.setDb(this.database.getDb());
            await this.analytics.initialize();
            this.logger.info('Sukuna Bot', 'Analytics service initialized');
            await this.commands.initialize(this.client);
            this.logger.info('Sukuna Bot', 'Command registry initialized successfully');
            await this.events.initialize(this.client);
            this.logger.info('Sukuna Bot', 'Event registry initialized successfully');
            await this.interactions.initialize(this.client);
            this.logger.info('Sukuna Bot', 'Interaction router initialized successfully');
            // Set up TempVC voice state handler
            this.client.on(discord_js_1.Events.VoiceStateUpdate, async (oldState, newState) => {
                const member = newState.member;
                if (!member)
                    return;
                await this.tempvc.handleVoiceStateUpdate(oldState.channelId, newState.channelId, member);
            });
            // Set up AI message handler
            this.client.on(discord_js_1.Events.MessageCreate, (message) => {
                this.ai.handleMessage(message);
            });
            this.logger.info('Sukuna Bot', 'Application initialization completed successfully');
            // Start web dashboard
            await this.web.start();
            this.logger.info('Sukuna Bot', 'Web dashboard started');
        }
        catch (error) {
            this.logger.error('Sukuna Bot', 'Application initialization failed', error);
            process.exit(1);
        }
    }
    getClient() {
        return this.client;
    }
    async shutdown(reason = 'Graceful shutdown') {
        try {
            this.logger.info('Sukuna Bot', reason);
            await this.interactions.shutdown();
            await this.events.shutdown();
            await this.commands.shutdown();
            await this.moderation.shutdown();
            await this.leveling.shutdown();
            await this.economy.shutdown();
            await this.economyGames.shutdown();
            await this.ai.shutdown();
            await this.music.shutdown();
            await this.tempvc.shutdown();
            await this.automation.shutdown();
            await this.analytics.shutdown();
            await this.web.stop();
            await this.discord.shutdown();
            await this.database.shutdown();
            this.logger.info('Sukuna Bot', 'All services shutdown successfully');
        }
        catch (error) {
            this.logger.error('Sukuna Bot', 'Error during shutdown', error);
        }
    }
}
exports.SukunaApp = SukunaApp;
process.on('SIGINT', async () => {
    const app = SukunaApp.getInstance();
    await app.shutdown('Received SIGINT');
    process.exit(0);
});
process.on('SIGTERM', async () => {
    const app = SukunaApp.getInstance();
    await app.shutdown('Received SIGTERM');
    process.exit(0);
});
async function main() {
    try {
        const app = SukunaApp.getInstance();
        await app.initialize();
        app.logger.info('Sukuna Bot', 'Bot is ready!');
    }
    catch (error) {
        console.error('Failed to start Sukuna Bot:', error);
        process.exit(1);
    }
}
if (require.main === module) {
    main();
}
exports.default = SukunaApp;
