import { Client, Partials, Events } from 'discord.js';
import { Logger } from '../infrastructure/Logger';

export interface DiscordClientConfig {
  token: string;
  intents: number[];
  partials: string[];
}

export class DiscordClientManager {
  private config: DiscordClientConfig;
  private client: Client | null = null;
  private logger: Logger;
  private isReady: boolean = false;

  constructor(config: DiscordClientConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
  }

  public async initialize(): Promise<Client> {
    this.client = new Client({
      intents: this.config.intents,
      partials: this.config.partials as unknown as Partials[],
    });

    this.setupEventHandlers();

    try {
      await this.client.login(this.config.token);
      this.logger.info('Discord Client', 'Client logged in successfully');
    } catch (error) {
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
      this.logger.warn('Discord Client', `Disconnected: ${event.code}`);
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
}
