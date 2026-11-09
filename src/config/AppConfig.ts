// Sukuna Bot - Configuration System with Maximum Flexibility

import { GatewayIntentBits } from 'discord.js';

export interface AppConfig {
  environment: string;
  discord: DiscordConfig;
  logging: LoggingConfig;
  database: DatabaseConfig;
  commands: CommandConfig;
}

export interface DiscordConfig {
  token: string;
  intents: number[];
  partials: string[];
  intentsByName: string[];
  retryOnError: boolean;
  retryCount: number;
  retryDelay: number;
  presence?: PresenceConfig;
  activity?: ActivityConfig;
}

export interface PresenceConfig {
  status: 'online' | 'idle' | 'dnd' | 'invisible';
  activities?: ActivityConfig[];
}

export interface ActivityConfig {
  name: string;
  type: 'PLAYING' | 'STREAMING' | 'LISTENING' | 'WATCHING' | 'COMPETING' | 'CUSTOM';
  url?: string;
  state?: string;
  details?: string;
}

export interface LoggingConfig {
  level: string;
  format: string;
  destinations: LogDestination[];
  categories: LoggingCategories;
}

export interface LogDestination {
  type: 'console' | 'file' | 'remote';
  path?: string;
  level?: string;
}

export interface LoggingCategories {
  system: LogDestination;
  discord: LogDestination;
  commands: LogDestination;
  events: LogDestination;
}

export interface DatabaseConfig {
  path: string;
  migrations: boolean;
  connectionLimit: number;
}

export interface CommandConfig {
  prefix: string;
  caseInsensitive: boolean;
}

export class AppConfigManager {
  public static instance: AppConfigManager;
  private config: AppConfig | null = null;

  private constructor() {}

  public static getInstance(): AppConfigManager {
    if (!AppConfigManager.instance) {
      AppConfigManager.instance = new AppConfigManager();
    }
    return AppConfigManager.instance;
  }

  public async initialize(): Promise<AppConfig> {
    this.config = {
      environment: process.env.NODE_ENV || 'development',
      discord: {
        token: process.env.DISCORD_TOKEN || '',
        intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMembers],
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
        categories: { system: { type: 'console' } },
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

    return this.config;
  }

  public getConfig(): AppConfig {
    if (!this.config) {
      throw new Error('Configuration not initialized');
    }
    return this.config;
  }
}

export function initializeConfig(): AppConfig {
  const manager = AppConfigManager.getInstance();
  AppConfigManager.instance = manager;
  const config: AppConfig = {
    environment: process.env.NODE_ENV || 'development',
    discord: {
      token: process.env.DISCORD_TOKEN || '',
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMembers],
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
      categories: { system: { type: 'console' } },
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
