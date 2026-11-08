import { Client, Events } from 'discord.js';
import { Logger } from '../infrastructure/Logger';

export class EventRegistry {
  private client: Client | null = null;
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  public async initialize(client: Client): Promise<void> {
    this.client = client;
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    if (!this.client) return;

    this.client.once(Events.ClientReady, () => {
      this.logger.info('Event Registry', `Bot logged in as ${this.client?.user?.tag}`);
    });

    this.client.on(Events.Error, (error) => {
      this.logger.error('Event Registry', 'Discord error', error);
    });

    this.client.on(Events.Warn, (warning) => {
      this.logger.warn('Event Registry', 'Discord warning', warning);
    });

    this.client.on(Events.ShardDisconnect, (event) => {
      this.logger.warn('Event Registry', `Shard disconnected: ${event.code} ${event.reason}`);
    });

    this.client.on(Events.GuildCreate, (guild) => {
      this.logger.info('Event Registry', `Joined guild: ${guild.name} (${guild.id})`);
    });

    this.client.on(Events.GuildDelete, (guild) => {
      this.logger.info('Event Registry', `Left guild: ${guild.name} (${guild.id})`);
    });
  }

  public async shutdown(): Promise<void> {
    if (this.client) {
      this.client.removeAllListeners();
    }
    this.client = null;
  }
}
