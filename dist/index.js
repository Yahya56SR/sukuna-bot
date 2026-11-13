"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SukunaApp = void 0;
const discord_js_1 = require("discord.js");
require('dotenv').config();
/** Single source for the env-derived AI config (used for both service and commands). */
function aiConfigFromEnv() {
    return {
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
        apiKey: process.env.AI_API_KEY || process.env.GEMINI_API_KEY || '',
        provider: process.env.AI_PROVIDER || 'gemini',
        baseUrl: process.env.AI_BASE_URL || undefined,
    };
}
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
        const { CardService } = require('./services/CardService');
        const { CommunityManager } = require('./modules/CommunityManager');
        const { TicketsManager } = require('./modules/TicketsManager');
        const { StaffApplications } = require('./modules/StaffApplications');
        const { PanelService } = require('./services/PanelService');
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
            enabled: process.env.LEVELING_ENABLED !== 'false',
            xpFormula: (process.env.LEVELING_XP_FORMULA || 'quadratic'),
            baseXpPerLevel: parseInt(process.env.LEVELING_BASE_XP_PER_LEVEL || '100'),
            xpMultiplier: parseFloat(process.env.LEVELING_XP_MULTIPLIER || '1'),
            customXpTable: (() => { try {
                return JSON.parse(process.env.LEVELING_CUSTOM_XP_TABLE || '{}');
            }
            catch {
                return {};
            } })(),
            xpSources: {
                message: {
                    enabled: process.env.XP_SOURCE_MESSAGE !== 'false',
                    min: parseInt(process.env.XP_SOURCE_MESSAGE_MIN || '15'),
                    max: parseInt(process.env.XP_SOURCE_MESSAGE_MAX || '25'),
                    cooldownSeconds: parseInt(process.env.XP_SOURCE_MESSAGE_COOLDOWN || '60'),
                },
                voice: {
                    enabled: process.env.XP_SOURCE_VOICE !== 'false',
                    perMinuteMin: parseInt(process.env.XP_SOURCE_VOICE_MIN || '5'),
                    perMinuteMax: parseInt(process.env.XP_SOURCE_VOICE_MAX || '8'),
                    cooldownSeconds: parseInt(process.env.XP_SOURCE_VOICE_COOLDOWN || '60'),
                },
                command: {
                    enabled: process.env.XP_SOURCE_COMMAND !== 'false',
                    amount: parseInt(process.env.XP_SOURCE_COMMAND_AMOUNT || '10'),
                    cooldownSeconds: parseInt(process.env.XP_SOURCE_COMMAND_COOLDOWN || '300'),
                },
            },
            xpMultipliers: {
                weekend: parseFloat(process.env.XP_MULTIPLIER_WEEKEND || '1.5'),
                booster: parseFloat(process.env.XP_MULTIPLIER_BOOSTER || '2.0'),
                role: (() => { try {
                    return JSON.parse(process.env.XP_MULTIPLIER_ROLES || '{}');
                }
                catch {
                    return {};
                } })(),
            },
            noXpChannels: (() => { try {
                return JSON.parse(process.env.XP_NO_CHANNELS || '[]');
            }
            catch {
                return [];
            } })(),
            xpChannelWhitelist: (() => { try {
                return JSON.parse(process.env.XP_CHANNEL_WHITELIST || '[]');
            }
            catch {
                return [];
            } })(),
            levelRoles: (() => { try {
                return JSON.parse(process.env.LEVELING_LEVEL_ROLES || '[]');
            }
            catch {
                return [];
            } })(),
            announcementChannels: (() => { try {
                return JSON.parse(process.env.LEVELING_ANNOUNCEMENT_CHANNELS || '[]');
            }
            catch {
                return [];
            } })(),
            staffRoleIds: (() => { try {
                return JSON.parse(process.env.LEVELING_STAFF_ROLES || '[]');
            }
            catch {
                return [];
            } })(),
            staffLevelRoles: (() => { try {
                return JSON.parse(process.env.LEVELING_STAFF_LEVEL_ROLES || '[]');
            }
            catch {
                return [];
            } })(),
            staffAnnouncementChannels: (() => { try {
                return JSON.parse(process.env.LEVELING_STAFF_ANNOUNCE || '[]');
            }
            catch {
                return [];
            } })(),
            memberLevelRoles: (() => { try {
                return JSON.parse(process.env.LEVELING_MEMBER_LEVEL_ROLES || process.env.LEVELING_LEVEL_ROLES || '[]');
            }
            catch {
                return [];
            } })(),
            memberAnnouncementChannels: (() => { try {
                return JSON.parse(process.env.LEVELING_MEMBER_ANNOUNCE || process.env.LEVELING_ANNOUNCEMENT_CHANNELS || '[]');
            }
            catch {
                return [];
            } })(),
            defaultColor: process.env.LEVELING_DEFAULT_COLOR || '#0099ff',
            ignoreBots: process.env.LEVELING_IGNORE_BOTS !== 'false',
            maxLevel: parseInt(process.env.LEVELING_MAX_LEVEL || '100'),
        });
        this.economy = new EconomyService(this.logger);
        this.ai = new AIService(this.logger, aiConfigFromEnv());
        // NOTE: AppConfig has no `services` key — use env vars with safe defaults
        // (this previously crashed at startup: "Cannot read properties of undefined (reading 'music')")
        this.music = new MusicService(this.logger, {
            enabled: process.env.MUSIC_ENABLED !== 'false',
            lavalinkHost: process.env.LAVALINK_HOST || 'localhost',
            lavalinkPort: parseInt(process.env.LAVALINK_PORT || '2333'),
            lavalinkPassword: process.env.LAVALINK_PASSWORD || 'youshallnotpass',
            lavalinkSecure: process.env.LAVALINK_SECURE === 'true',
            lavalinkNodeId: process.env.LAVALINK_NODE_ID || 'main',
            defaultVolume: parseInt(process.env.MUSIC_DEFAULT_VOLUME || '50'),
            maxPlaylistSize: parseInt(process.env.MUSIC_MAX_PLAYLIST_SIZE || '50'),
            allowSkip: process.env.MUSIC_ALLOW_SKIP !== 'false',
            allowRepeat: process.env.MUSIC_ALLOW_REPEAT !== 'false',
        });
        this.automation = new AutomationService(this.logger);
        this.analytics = new AnalyticsService(this.logger);
        this.tempvc = new TempVCService(this.logger);
        this.economyGames = new EconomyGamesService(this.logger);
        this.cards = new CardService(this.logger);
        this.tickets = new TicketsManager(this.logger, {
            enabled: process.env.TICKETS_ENABLED !== 'false',
            category: process.env.TICKETS_CATEGORY_ID || '',
            supportRoles: process.env.TICKETS_SUPPORT_ROLES ? process.env.TICKETS_SUPPORT_ROLES.split(',') : [],
            closeVote: process.env.TICKETS_CLOSE_VOTE === 'true',
        });
        const { GiveawaysManager } = require('./modules/GiveawaysManager');
        this.giveaways = new GiveawaysManager(this.logger, {
            enabled: process.env.GIVEAWAYS_ENABLED !== 'false',
            channel: process.env.GIVEAWAYS_CHANNEL_ID || '',
            roleRestrictions: process.env.GIVEAWAYS_ROLE_RESTRICTIONS === 'true',
            minWinners: 1,
            maxWinners: parseInt(process.env.GIVEAWAYS_MAX_WINNERS || '20'),
        });
        this.staffapps = new StaffApplications(this.logger, {
            enabled: process.env.STAFFAPPS_ENABLED !== 'false',
            panelChannelId: process.env.STAFFAPPS_PANEL_CHANNEL_ID || '',
            reviewChannelId: process.env.STAFFAPPS_REVIEW_CHANNEL_ID || process.env.STAFFAPPS_PANEL_CHANNEL_ID || '',
            staffRoles: (() => { try {
                return JSON.parse(process.env.STAFFAPPS_ROLES || '[]');
            }
            catch {
                return [];
            } })(),
            approverRoleIds: (() => { try {
                return JSON.parse(process.env.STAFFAPPS_APPROVER_ROLES || '[]');
            }
            catch {
                return [];
            } })(),
            questions: (() => { try {
                return JSON.parse(process.env.STAFFAPPS_QUESTIONS || '["Why do you want to join the staff team?","How active are you on Discord?","Have you been staff elsewhere before?","What would you do if two members are arguing?","Anything else we should know?"]');
            }
            catch {
                return [];
            } })(),
        });
        this.community = new CommunityManager(this.logger, {
            welcome: {
                enabled: process.env.WELCOME_ENABLED === 'true',
                channel: process.env.WELCOME_CHANNEL_ID || '',
                message: process.env.WELCOME_MESSAGE || 'Welcome {user} to {server}! 🎉',
                embed: process.env.WELCOME_EMBED !== 'false',
                sendImage: process.env.WELCOME_SEND_IMAGE !== 'false',
                welcomeImageMessage: process.env.WELCOME_IMAGE_MESSAGE || 'Welcome {username} to {server}!',
            },
            goodbye: {
                enabled: process.env.GOODBYE_ENABLED === 'true',
                channel: process.env.GOODBYE_CHANNEL_ID || '',
                message: process.env.GOODBYE_MESSAGE || 'Goodbye {username}, we will miss you! 👋',
                embed: false,
            },
            autoroles: {
                enabled: false,
                defaultRole: '',
                configurable: false,
            },
        });
        this.panels = new PanelService(this.logger, {
            banner: process.env.PANELS_BANNER !== 'false',
            emojiGuild: process.env.PANELS_EMOJI_GUILD || '',
            emojiMap: process.env.PANELS_EMOJI_MAP || '',
            accent: process.env.PANELS_ACCENT || '',
        });
        this.web = new WebServer(this.logger, this, parseInt(process.env.SERVER_PORT || process.env.PORT || '3000'));
    }
    static getInstance() {
        if (!SukunaApp.instance) {
            SukunaApp.instance = new SukunaApp();
        }
        return SukunaApp.instance;
    }
    async initialize() {
        // Start the web dashboard FIRST so it stays up (and the hosting proxy
        // doesn't return 502) even if Discord login / DB init below fails.
        // The API routes already handle a not-yet-connected client gracefully.
        await this.web.start();
        this.logger.info('Sukuna Bot', 'Web dashboard started');
        try {
            this.logger.info('Sukuna Bot', 'Starting application initialization...');
            await this.database.initialize();
            this.logger.info('Sukuna Bot', 'Database initialized successfully');
            this.moderation.setDb(this.database.getDb());
            this.tickets.setDb(this.database.getDb());
            this.logger.info('Sukuna Bot', 'Moderation service connected to database');
            // Apply dashboard-persisted config overrides (service_configs table) over env
            // defaults NOW — before Discord login, so they apply even if login fails.
            await this.web.loadPersistedConfigs();
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
                enabled: process.env.LEVELING_ENABLED !== 'false',
                xpFormula: (process.env.LEVELING_XP_FORMULA || 'quadratic'),
                baseXpPerLevel: parseInt(process.env.LEVELING_BASE_XP_PER_LEVEL || '100'),
                xpMultiplier: parseFloat(process.env.LEVELING_XP_MULTIPLIER || '1'),
                customXpTable: (() => { try {
                    return JSON.parse(process.env.LEVELING_CUSTOM_XP_TABLE || '{}');
                }
                catch {
                    return {};
                } })(),
                xpSources: {
                    message: {
                        enabled: process.env.XP_SOURCE_MESSAGE !== 'false',
                        min: parseInt(process.env.XP_SOURCE_MESSAGE_MIN || '15'),
                        max: parseInt(process.env.XP_SOURCE_MESSAGE_MAX || '25'),
                        cooldownSeconds: parseInt(process.env.XP_SOURCE_MESSAGE_COOLDOWN || '60'),
                    },
                    voice: {
                        enabled: process.env.XP_SOURCE_VOICE !== 'false',
                        perMinuteMin: parseInt(process.env.XP_SOURCE_VOICE_MIN || '5'),
                        perMinuteMax: parseInt(process.env.XP_SOURCE_VOICE_MAX || '8'),
                        cooldownSeconds: parseInt(process.env.XP_SOURCE_VOICE_COOLDOWN || '60'),
                    },
                    command: {
                        enabled: process.env.XP_SOURCE_COMMAND !== 'false',
                        amount: parseInt(process.env.XP_SOURCE_COMMAND_AMOUNT || '10'),
                        cooldownSeconds: parseInt(process.env.XP_SOURCE_COMMAND_COOLDOWN || '300'),
                    },
                },
                xpMultipliers: {
                    weekend: parseFloat(process.env.XP_MULTIPLIER_WEEKEND || '1.5'),
                    booster: parseFloat(process.env.XP_MULTIPLIER_BOOSTER || '2.0'),
                    role: (() => { try {
                        return JSON.parse(process.env.XP_MULTIPLIER_ROLES || '{}');
                    }
                    catch {
                        return {};
                    } })(),
                },
                noXpChannels: (() => { try {
                    return JSON.parse(process.env.XP_NO_CHANNELS || '[]');
                }
                catch {
                    return [];
                } })(),
                xpChannelWhitelist: (() => { try {
                    return JSON.parse(process.env.XP_CHANNEL_WHITELIST || '[]');
                }
                catch {
                    return [];
                } })(),
                levelRoles: (() => { try {
                    return JSON.parse(process.env.LEVELING_LEVEL_ROLES || '[]');
                }
                catch {
                    return [];
                } })(),
                announcementChannels: (() => { try {
                    return JSON.parse(process.env.LEVELING_ANNOUNCEMENT_CHANNELS || '[]');
                }
                catch {
                    return [];
                } })(),
                staffRoleIds: (() => { try {
                    return JSON.parse(process.env.LEVELING_STAFF_ROLES || '[]');
                }
                catch {
                    return [];
                } })(),
                staffLevelRoles: (() => { try {
                    return JSON.parse(process.env.LEVELING_STAFF_LEVEL_ROLES || '[]');
                }
                catch {
                    return [];
                } })(),
                staffAnnouncementChannels: (() => { try {
                    return JSON.parse(process.env.LEVELING_STAFF_ANNOUNCE || '[]');
                }
                catch {
                    return [];
                } })(),
                memberLevelRoles: (() => { try {
                    return JSON.parse(process.env.LEVELING_MEMBER_LEVEL_ROLES || process.env.LEVELING_LEVEL_ROLES || '[]');
                }
                catch {
                    return [];
                } })(),
                memberAnnouncementChannels: (() => { try {
                    return JSON.parse(process.env.LEVELING_MEMBER_ANNOUNCE || process.env.LEVELING_ANNOUNCEMENT_CHANNELS || '[]');
                }
                catch {
                    return [];
                } })(),
                defaultColor: process.env.LEVELING_DEFAULT_COLOR || '#0099ff',
                ignoreBots: process.env.LEVELING_IGNORE_BOTS !== 'false',
                maxLevel: parseInt(process.env.LEVELING_MAX_LEVEL || '100'),
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
            this.economyGames.setEconomy(this.economy);
            await this.economyGames.initialize();
            this.logger.info('Sukuna Bot', 'Economy games service initialized');
            const economyGamesCommands = new (require('./modules/economy/EconomyGames').EconomyGamesCommands)(this.economyGames, this.logger);
            for (const cmd of economyGamesCommands.getCommands()) {
                this.commands.registerCommand(cmd);
            }
            this.logger.info('Sukuna Bot', `Registered ${economyGamesCommands.getCommands().length} economy games commands`);
            this.client = await this.discord.initialize();
            this.logger.info('Sukuna Bot', 'Discord client initialized successfully');
            this.economyGames.setClient(this.client);
            // Panels use the bot's own custom emoji — pull them from the emoji server.
            this.panels.setClient(this.client);
            await this.panels.refreshEmojis(this.client).catch(() => 0);
            // Set client on services that need it
            this.leveling.setClient(this.client);
            this.tempvc.setDb(this.database.getDb());
            this.tempvc.setClient(this.client);
            await this.tempvc.initialize();
            // TempVC loads its own config from the DB in initialize() — re-apply
            // persisted dashboard overrides afterwards (idempotent for other services).
            await this.web.loadPersistedConfigs();
            this.interactions.setTempVCService(this.tempvc);
            this.logger.info('Sukuna Bot', 'Temp VC service linked to interaction router');
            const tempvcCommands = new (require('./modules/tempvc/TempVCCommands').TempVCCommands)(this.tempvc, this.logger);
            for (const cmd of tempvcCommands.getCommands()) {
                this.commands.registerCommand(cmd);
            }
            this.logger.info('Sukuna Bot', `Registered ${tempvcCommands.getCommands().length} temp VC commands`);
            this.ai.setDb(this.database.getDb());
            this.ai.setClient(this.client);
            if (this.ai.setLeveling)
                this.ai.setLeveling(this.leveling);
            await this.ai.initialize();
            this.logger.info('Sukuna Bot', 'AI service initialized');
            const aiCommands = new (require('./modules/ai/AIService').AICommands)(this.ai, this.logger, aiConfigFromEnv());
            for (const cmd of aiCommands.getCommands()) {
                this.commands.registerCommand(cmd);
            }
            this.logger.info('Sukuna Bot', `Registered ${aiCommands.getCommands().length} AI commands`);
            this.music.setDb(this.database.getDb());
            this.music.setClient(this.client);
            await this.music.initialize();
            this.logger.info('Sukuna Bot', 'Music service initialized');
            const musicCommands = new (require('./modules/music/MusicService').MusicCommands)(this.music, this.logger);
            for (const cmd of musicCommands.getCommands()) {
                this.commands.registerCommand(cmd);
            }
            this.logger.info('Sukuna Bot', `Registered ${musicCommands.getCommands().length} music commands`);
            this.automation.setDb(this.database.getDb());
            this.automation.setClient(this.client);
            await this.automation.initialize();
            try {
                const { AutomationCommands } = require('./services/AutomationService');
                const automationCommands = new AutomationCommands(this.automation, this.logger);
                for (const cmd of automationCommands.getCommands()) {
                    this.commands.registerCommand(cmd);
                }
                this.logger.info('Sukuna Bot', `Registered ${automationCommands.getCommands().length} automation commands`);
            }
            catch (err) {
                this.logger.warn('Sukuna Bot', 'Automation commands registration failed', err);
            }
            this.logger.info('Sukuna Bot', 'Automation service initialized');
            this.analytics.setDb(this.database.getDb());
            await this.analytics.initialize();
            this.logger.info('Sukuna Bot', 'Analytics service initialized');
            await this.cards.initialize();
            this.logger.info('Sukuna Bot', 'Card service initialized');
            // Tickets (private support channels)
            await this.tickets.initialize(this.client);
            this.logger.info('Sukuna Bot', 'Tickets service initialized');
            try {
                const { TicketsCommands } = require('./modules/TicketsManager');
                const ticketCommands = new TicketsCommands(this.tickets, this.logger);
                for (const cmd of ticketCommands.getCommands()) {
                    this.commands.registerCommand(cmd);
                }
                this.logger.info('Sukuna Bot', `Registered ${ticketCommands.getCommands().length} ticket commands`);
            }
            catch (err) {
                this.logger.warn('Sukuna Bot', 'Tickets commands registration failed', err);
            }
            if (this.interactions.setTicketsService)
                this.interactions.setTicketsService(this.tickets);
            if (this.interactions.setEconomyGamesService)
                this.interactions.setEconomyGamesService(this.economyGames);
            // Giveaways (persistent, restart-safe timers, escrowed prizes)
            this.giveaways.setDb(this.database.getDb());
            this.giveaways.setEconomy(this.economy);
            await this.giveaways.initialize(this.client);
            this.logger.info('Sukuna Bot', 'Giveaways service initialized');
            try {
                const { GiveawayCommands } = require('./modules/GiveawaysManager');
                const giveawayCommands = new GiveawayCommands(this.giveaways, this.logger);
                for (const cmd of giveawayCommands.getCommands()) {
                    this.commands.registerCommand(cmd);
                }
                this.logger.info('Sukuna Bot', `Registered ${giveawayCommands.getCommands().length} giveaway commands`);
            }
            catch (err) {
                this.logger.warn('Sukuna Bot', 'Giveaway commands registration failed', err);
            }
            if (this.interactions.setGiveawaysService)
                this.interactions.setGiveawaysService(this.giveaways);
            // Staff applications
            this.staffapps.setDb(this.database.getDb());
            await this.staffapps.initialize(this.client);
            this.logger.info('Sukuna Bot', 'Staff applications service initialized');
            try {
                const { StaffApplicationsCommands } = require('./modules/StaffApplications');
                const staffAppCommands = new StaffApplicationsCommands(this.staffapps, this.logger);
                for (const cmd of staffAppCommands.getCommands()) {
                    this.commands.registerCommand(cmd);
                }
                this.logger.info('Sukuna Bot', `Registered ${staffAppCommands.getCommands().length} staff application commands`);
            }
            catch (err) {
                this.logger.warn('Sukuna Bot', 'Staff application commands registration failed', err);
            }
            if (this.interactions.setStaffApplications)
                this.interactions.setStaffApplications(this.staffapps);
            // Community (welcome/goodbye) needs Discord client + card templates
            this.community.setCardService(this.cards);
            this.community.setDb(this.database.getDb());
            await this.community.initialize(this.client);
            this.logger.info('Sukuna Bot', 'Community service initialized');
            await this.commands.initialize(this.client);
            this.logger.info('Sukuna Bot', 'Command registry initialized successfully');
            await this.events.initialize(this.client);
            this.logger.info('Sukuna Bot', 'Event registry initialized successfully');
            await this.interactions.initialize(this.client);
            this.logger.info('Sukuna Bot', 'Interaction router initialized successfully');
            // Set up TempVC + leveling voice handler
            this.client.on(discord_js_1.Events.VoiceStateUpdate, async (oldState, newState) => {
                const member = newState.member ?? oldState.member;
                if (!member)
                    return;
                await this.tempvc.handleVoiceStateUpdate(oldState.channelId, newState.channelId, member);
                try {
                    if (member.user.bot)
                        return;
                    const guildId = member.guild.id;
                    const userId = member.id;
                    const key = `${guildId}-${userId}`;
                    const wasInVoice = !!oldState.channelId;
                    const isInVoice = !!newState.channelId;
                    if (!wasInVoice && isInVoice) {
                        this.leveling.startVoiceSession(key);
                    }
                    else if (wasInVoice && !isInVoice) {
                        const minutes = this.leveling.endVoiceSession(key);
                        if (minutes >= 1 && this.leveling.config?.xpSources?.voice?.enabled) {
                            await this.leveling.addXpFromVoice(guildId, userId, member, minutes);
                        }
                    }
                }
                catch (err) {
                    this.logger.warn('Sukuna Bot', 'Voice XP handling failed', err);
                }
            });
            // Set up AI + leveling message handlers
            this.client.on(discord_js_1.Events.MessageCreate, async (message) => {
                // AI first (it intentionally ignores bots internally).
                this.ai.handleMessage(message);
                try {
                    if (!message.inGuild())
                        return;
                    if (!this.leveling.config?.enabled)
                        return;
                    if (!this.leveling.config?.xpSources?.message?.enabled)
                        return;
                    if (message.author.bot && this.leveling.config?.ignoreBots !== false)
                        return;
                    const member = message.member ?? await message.guild.members.fetch(message.author.id).catch(() => null);
                    await this.leveling.addXpFromMessage(message.guildId, message.author.id, message.channelId, member ?? undefined);
                }
                catch (err) {
                    this.logger.warn('Sukuna Bot', 'Message XP handling failed', err);
                }
            });
            this.logger.info('Sukuna Bot', 'Application initialization completed successfully');
        }
        catch (error) {
            // Do NOT exit here: the dashboard is already running and should stay up
            // (showing "Offline") so the host doesn't return 502. The bot features
            // that failed to initialize will recover on the next restart.
            this.logger.error('Sukuna Bot', 'Application initialization failed — dashboard remains available, bot features offline', error);
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
            await this.cards.shutdown();
            await this.community.shutdown();
            try {
                await this.tickets.shutdown();
            }
            catch { /* best-effort */ }
            try {
                await this.giveaways.shutdown();
            }
            catch { /* best-effort */ }
            try {
                await this.staffapps.shutdown();
            }
            catch { /* best-effort */ }
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
        app.logger.info('Sukuna Bot', 'Sukuna Bot startup complete');
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
