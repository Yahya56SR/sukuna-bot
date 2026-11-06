import {
  Client,
  GatewayIntentBits,
  Partials,
} from 'discord.js';
import { readGuildConfig, type Database } from '../db/index.js';
import type { Env } from '../config/env.js';
import type { Logger } from './logger.js';

export interface CachedSettings {
  config: any;
  updatedAt: number;
}

export class SukunaClient extends Client {
  readonly commands = new Map<string, any>();
  readonly startedAt = Date.now();

  env!: Env;
  logger!: Logger;
  db: Database | null = null;
  settingsCache = new Map<string, CachedSettings>();
  xpCooldowns = new Map<string, number>();

  constructor() {
    super({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessageReactions,
      ],
      partials: [Partials.Message, Partials.Channel, Partials.GuildMember, Partials.Reaction],
      allowedMentions: { parse: ["users"], repliedUser: false },
      // Always appear as "Do Not Disturb" with no activity text. Sent with the
      // IDENTIFY payload, so it applies on login and on every reconnect.
      presence: { status: 'dnd' },
    });
  }

  async getConfig(guildId: string): Promise<any> {
    const cached = this.settingsCache.get(guildId);
    // Single-guild pro rule: configs cannot go stale forever. 60s TTL keeps
    // dashboard edits live within a minute without a DB read per message.
    if (cached && Date.now() - cached.updatedAt < 60_000) return cached.config;
    if (cached) this.settingsCache.delete(guildId);

    const config = await this.loadConfig(guildId);
    return config;
  }

  evictGuildCache(guildId: string): void {
    this.settingsCache.delete(guildId);
    // Drop this guild's XP cooldowns too (bounded sweep below).
    const prefix = `xp_${guildId}_`;
    for (const key of this.xpCooldowns.keys()) {
      if (key.startsWith(prefix)) this.xpCooldowns.delete(key);
    }
  }

  private async loadConfig(guildId: string): Promise<any> {
    try {
      const row = await readGuildConfig(guildId);
      const config = row ?? { modules: {} };
      this.cacheSettings(guildId, config, row?.updatedAt?.getTime?.() ?? Date.now());
      return config;
    } catch (error) {
      this.logger?.warn({ err: error, guildId }, "guild settings load failed - using defaults");
      return { modules: {} };
    }
  }

  cacheSettings(guildId: string, config: any, updatedAt: number): void {
    this.settingsCache.set(guildId, { config, updatedAt });
  }

  isCategoryEnabled(category: string, config: any): boolean {
    const always = ["core", "moderation", "logging", "utility", "community"];
    if (always.includes(category)) return true;
    const modules = config?.modules ?? {};
    return modules[category] !== false;
  }
}
