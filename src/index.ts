import { Client, Events } from 'discord.js';

require('dotenv').config();

export class SukunaApp {
  private static instance: SukunaApp;
  public readonly config: any;
  public readonly logger: any;
  public readonly database: any;
  public readonly discord: any;
  public readonly commands: any;
  public readonly events: any;
  public readonly interactions: any;
  public readonly moderation: any;
  public readonly leveling: any;
  public readonly economy: any;
  public readonly ai: any;
  public readonly music: any;
  public readonly automation: any;
  public readonly analytics: any;
  public readonly tempvc: any;
  public readonly economyGames: any;
  public readonly web: any;
  private client!: Client;

  private constructor() {
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
        enabled: process.env.LEVELING_ENABLED !== 'false',
        xpFormula: (process.env.LEVELING_XP_FORMULA || 'quadratic') as any,
        baseXpPerLevel: parseInt(process.env.LEVELING_BASE_XP_PER_LEVEL || '100'),
        xpMultiplier: parseFloat(process.env.LEVELING_XP_MULTIPLIER || '1'),
        customXpTable: (() => { try { return JSON.parse(process.env.LEVELING_CUSTOM_XP_TABLE || '{}'); } catch { return {}; } })(),
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
          role: (() => { try { return JSON.parse(process.env.XP_MULTIPLIER_ROLES || '{}'); } catch { return {}; } })(),
        },
        noXpChannels: (() => { try { return JSON.parse(process.env.XP_NO_CHANNELS || '[]'); } catch { return []; } })(),
        xpChannelWhitelist: (() => { try { return JSON.parse(process.env.XP_CHANNEL_WHITELIST || '[]'); } catch { return []; } })(),
        levelRoles: (() => { try { return JSON.parse(process.env.LEVELING_LEVEL_ROLES || '[]'); } catch { return []; } })(),
        announcementChannels: (() => { try { return JSON.parse(process.env.LEVELING_ANNOUNCEMENT_CHANNELS || '[]'); } catch { return []; } })(),
        defaultColor: process.env.LEVELING_DEFAULT_COLOR || '#0099ff',
        ignoreBots: process.env.LEVELING_IGNORE_BOTS !== 'false',
        maxLevel: parseInt(process.env.LEVELING_MAX_LEVEL || '100'),
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
      // NOTE: AppConfig has no `services` key — use env vars with safe defaults
      // (this previously crashed at startup: "Cannot read properties of undefined (reading 'music')")
      this.music = new MusicService(this.logger, {
        enabled: process.env.MUSIC_ENABLED !== 'false',
        lavalinkHost: process.env.LAVALINK_HOST || 'localhost',
        lavalinkPort: parseInt(process.env.LAVALINK_PORT || '2333'),
        lavalinkPassword: process.env.LAVALINK_PASSWORD || 'youshallnotpass',
        defaultVolume: parseInt(process.env.MUSIC_DEFAULT_VOLUME || '100'),
        maxPlaylistSize: parseInt(process.env.MUSIC_MAX_PLAYLIST_SIZE || '50'),
        allowSkip: process.env.MUSIC_ALLOW_SKIP !== 'false',
        allowRepeat: process.env.MUSIC_ALLOW_REPEAT !== 'false',
      });
      this.automation = new AutomationService(this.logger);
      this.analytics = new AnalyticsService(this.logger);
      this.tempvc = new TempVCService(this.logger);
      this.economyGames = new EconomyGamesService(this.logger);
      this.web = new WebServer(this.logger, this, parseInt(process.env.SERVER_PORT || process.env.PORT || '3000'));
  }

  public static getInstance(): SukunaApp {
    if (!SukunaApp.instance) {
      SukunaApp.instance = new SukunaApp();
    }
    return SukunaApp.instance;
  }

  public async initialize(): Promise<void> {
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
        xpFormula: (process.env.LEVELING_XP_FORMULA || 'quadratic') as any,
        baseXpPerLevel: parseInt(process.env.LEVELING_BASE_XP_PER_LEVEL || '100'),
        xpMultiplier: parseFloat(process.env.LEVELING_XP_MULTIPLIER || '1'),
        customXpTable: (() => { try { return JSON.parse(process.env.LEVELING_CUSTOM_XP_TABLE || '{}'); } catch { return {}; } })(),
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
          role: (() => { try { return JSON.parse(process.env.XP_MULTIPLIER_ROLES || '{}'); } catch { return {}; } })(),
        },
        noXpChannels: (() => { try { return JSON.parse(process.env.XP_NO_CHANNELS || '[]'); } catch { return []; } })(),
        xpChannelWhitelist: (() => { try { return JSON.parse(process.env.XP_CHANNEL_WHITELIST || '[]'); } catch { return []; } })(),
        levelRoles: (() => { try { return JSON.parse(process.env.LEVELING_LEVEL_ROLES || '[]'); } catch { return []; } })(),
        announcementChannels: (() => { try { return JSON.parse(process.env.LEVELING_ANNOUNCEMENT_CHANNELS || '[]'); } catch { return []; } })(),
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
      this.client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
        const member = newState.member;
        if (!member) return;
        await this.tempvc.handleVoiceStateUpdate(oldState.channelId, newState.channelId, member);
      });

      // Set up AI message handler
      this.client.on(Events.MessageCreate, (message) => {
        this.ai.handleMessage(message);
      });

      this.logger.info('Sukuna Bot', 'Application initialization completed successfully');
    } catch (error) {
      // Do NOT exit here: the dashboard is already running and should stay up
      // (showing "Offline") so the host doesn't return 502. The bot features
      // that failed to initialize will recover on the next restart.
      this.logger.error('Sukuna Bot', 'Application initialization failed — dashboard remains available, bot features offline', error as Error);
    }
  }

  public getClient(): Client {
    return this.client;
  }

  public async shutdown(reason: string = 'Graceful shutdown'): Promise<void> {
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
    } catch (error) {
      this.logger.error('Sukuna Bot', 'Error during shutdown', error as Error);
    }
  }
}

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

async function main(): Promise<void> {
  try {
    const app = SukunaApp.getInstance();
    await app.initialize();

    app.logger.info('Sukuna Bot', 'Bot is ready!');
  } catch (error) {
    console.error('Failed to start Sukuna Bot:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export default SukunaApp;
