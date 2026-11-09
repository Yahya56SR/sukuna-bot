import { Client, Partials, Events, GatewayIntentBits } from 'discord.js';
import { Logger } from '../infrastructure/Logger';
import type { DiscordConfig } from '../config/AppConfig';

export class DiscordClientManager {
  private config: DiscordConfig;
  private client: Client | null = null;
  private logger: Logger;
  private isReady: boolean = false;

  constructor(config: DiscordConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
  }

  public async initialize(): Promise<Client> {
    this.client = new Client({
      intents: this.convertStringIntentsToNumber(this.config.intents),
      partials: this.config.partials as unknown as Partials[],
    });

    this.setupEventHandlers();

    try {
      await this.client.login(this.config.token);
      this.logger.info('Discord Client', 'Client logged in successfully');
    } catch (error) {
      if (this.config.retryOnError && this.config.retryCount > 0) {
        this.logger.warn('Discord Client', `Login failed, retrying in ${this.config.retryDelay}ms... (Attempt: ${this.config.retryCount})`);
        await this.delay(this.config.retryDelay);
        return this.initialize();
      }
      this.logger.error('Discord Client', 'Failed to login to Discord', error as Error);
      throw error;
    }

    return this.client;
  }

  private setupEventHandlers(): void {
    if (!this.client) return;

    this.client.on(Events.ClientReady, () => {
      this.isReady = true;
      this.logger.info('Discord Client', `Bot ready as ${this.client?.user?.tag}`);
    });

    this.client.on(Events.Error, (error) => {
      this.logger.error('Discord Client', 'Discord client error', error);
    });

    this.client.on(Events.Warn, (warning) => {
      this.logger.warn('Discord Client', 'Discord client warning', warning);
    });

    this.client.on(Events.ShardDisconnect, (event) => {
      this.isReady = false;
      this.logger.warn('Discord Client', `Disconnected: ${event.code} ${event.reason}`);
    });

    this.client.on(Events.ShardReconnecting, () => {
      this.logger.info('Discord Client', 'Reconnecting to Discord...');
    });
  }

  public getClient(): Client {
    if (!this.client) {
      throw new Error('Client not initialized');
    }
    return this.client;
  }

  public isClientReady(): boolean {
    return this.isReady;
  }

  public async shutdown(): Promise<void> {
    if (this.client) {
      await this.client.destroy();
      this.client = null;
      this.isReady = false;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private convertStringIntentsToNumber(intents: string[]): number[] {
    const intentMap: Record<string, number> = {
      'Guilds': GatewayIntentBits.Guilds,
      'GuildMessages': GatewayIntentBits.GuildMessages,
      'GuildMembers': GatewayIntentBits.GuildMembers,
      'GuildPresences': GatewayIntentBits.GuildPresences,
      'GuildBans': GatewayIntentBits.GuildBans,
      'GuildEmojisAndStickers': GatewayIntentBits.GuildEmojisAndStickers,
      'GuildIntegrations': GatewayIntentBits.GuildIntegrations,
      'DirectMessages': GatewayIntentBits.DirectMessages,
      'DirectMessageReactions': GatewayIntentBits.DirectMessageReactions,
      'MessageContent': GatewayIntentBits.MessageContent,
      'GuildScheduledEvents': GatewayIntentBits.GuildScheduledEvents,
      'GuildVoiceStates': GatewayIntentBits.GuildVoiceStates,
      'ServerMember': GatewayIntentBits.GuildMembers,
    };

    const numericIntents: number[] = [];
    for (const intent of intents) {
      if (intent in intentMap) {
        numericIntents.push(intentMap[intent]);
      } else if (this.isNumericString(intent)) {
        numericIntents.push(parseInt(intent));
      } else {
        this.logger.warn('Discord Client', `Unknown intent: ${intent}, skipping`);
      }
    }

    return numericIntents;
  }

  private isNumericString(value: string): boolean {
    return !isNaN(parseInt(value));
  }
}
