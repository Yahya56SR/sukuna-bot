import { Client, Routes } from 'discord.js';
import { Logger } from '../infrastructure/Logger';
import { emojiRegistry, type CustomEmoji } from '../utils/emoji';
import { setPanelAccent, setPanelBannerEnabled } from '../utils/panel';

/**
 * Panel settings + custom emoji discovery.
 *
 * The bot keeps its own emoji server; panels should use those emojis so the
 * look is identical everywhere. The admin points the bot at that server
 * (by id or name) and maps semantic keys to emoji names:
 *
 *   staff = sukuna_staff
 *   ticket = sukuna_ticket
 *   donate = <a:money:123456789012345678>
 */
export interface PanelConfig {
  /** Master switch for the generated banner artwork. */
  banner: boolean;
  /** Id or name of the guild holding the bot's custom emojis. */
  emojiGuild: string;
  /** `key = emojiName` (or `key = <a:name:id>`) — one per line. */
  emojiMap: string;
  /** Banner accent colour (hex). Empty = per-panel default. */
  accent: string;
}

export const DEFAULT_PANEL_CONFIG: PanelConfig = {
  banner: true,
  emojiGuild: '',
  emojiMap: '',
  accent: '',
};

export function getDefaultPanelConfig(): PanelConfig {
  return { ...DEFAULT_PANEL_CONFIG };
}

export class PanelService {
  private logger: Logger;
  private config: PanelConfig = getDefaultPanelConfig();
  private client: Client | null = null;
  private lastEmojiCount = 0;
  private lastEmojiGuild = '';

  constructor(logger: Logger, config?: Partial<PanelConfig>) {
    this.logger = logger;
    if (config) this.config = { ...this.config, ...config };
    this.applyEmojiMap(this.config.emojiMap);
    setPanelBannerEnabled(this.config.banner !== false);
    setPanelAccent(this.config.accent ?? '');
  }

  public getConfig(): PanelConfig {
    return this.config;
  }

  public setConfig(next: Partial<PanelConfig>): PanelConfig {
    this.config = { ...this.config, ...(next ?? {}) };
    if (typeof this.config.emojiMap === 'string') this.applyEmojiMap(this.config.emojiMap);
    setPanelBannerEnabled(this.config.banner !== false);
    setPanelAccent(this.config.accent ?? '');
    return this.config;
  }

  public setClient(client: Client): void {
    this.client = client;
  }

  public getEmojiStats(): { count: number; guild: string } {
    return { count: this.lastEmojiCount, guild: this.lastEmojiGuild };
  }

  /** Custom emoji the bot can use, plus the resolved value of every key. */
  public getEmojiOverview(): {
    count: number;
    guild: string;
    custom: { name: string; value: string }[];
    resolved: Record<string, string>;
  } {
    return {
      count: this.lastEmojiCount,
      guild: this.lastEmojiGuild,
      custom: emojiRegistry.listCustomEmojis(),
      resolved: emojiRegistry.snapshot(),
    };
  }

  /**
   * Splits the emoji map into aliases (`key = name`) and direct overrides
   * (`key = <a:name:id>`), then hands both to the registry.
   */
  public applyEmojiMap(text: string): void {
    const aliases: Record<string, string> = {};
    const direct: Record<string, string> = {};

    for (const line of String(text ?? '').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const separator = trimmed.indexOf('=');
      if (separator <= 0) continue;
      const key = trimmed.slice(0, separator).trim().toLowerCase();
      const value = trimmed.slice(separator + 1).trim();
      if (!key || !value) continue;
      if (value.startsWith('<') && value.endsWith('>')) direct[key] = value;
      else aliases[key] = value;
    }

    emojiRegistry.setAliases(aliases);
    emojiRegistry.setDirect(direct);
  }

  /** Finds the guild that holds the bot's custom emojis. */
  public async resolveEmojiGuild(client?: Client | null): Promise<string | null> {
    const active = client ?? this.client;
    if (!active) return null;

    const configured = String(this.config.emojiGuild ?? '').trim();
    if (configured) {
      if (/^\d+$/.test(configured)) {
        const guild = active.guilds.cache.get(configured);
        if (guild) return guild.id;
        try {
          await active.rest.get(Routes.guild(configured));
          return configured;
        } catch {
          this.logger.warn('Panel Service', `Emoji guild ${configured} is not available to the bot`);
          return null;
        }
      }
      const byName = active.guilds.cache.find((g) => g.name.toLowerCase() === configured.toLowerCase());
      return byName?.id ?? null;
    }

    // No guild configured — look for an obvious "emoji" server.
    const guess = active.guilds.cache.find((g) => /emoji/i.test(g.name));
    return guess?.id ?? null;
  }

  /**
   * Pulls the emoji server's emoji list into the registry. Works without the
   * emoji gateway intent because it goes through the REST API.
   */
  public async refreshEmojis(client?: Client | null): Promise<number> {
    const active = client ?? this.client;
    if (!active) return 0;

    const guildId = await this.resolveEmojiGuild(active);
    if (!guildId) {
      this.lastEmojiCount = 0;
      this.lastEmojiGuild = '';
      emojiRegistry.setCustomEmojis([]);
      return 0;
    }

    let emojis: CustomEmoji[] = [];
    try {
      const raw = await active.rest.get(Routes.guildEmojis(guildId)) as any[];
      emojis = (raw ?? []).map((e) => ({ id: String(e.id), name: String(e.name), animated: Boolean(e.animated) }));
    } catch (error) {
      this.logger.warn('Panel Service', `Could not fetch emojis for guild ${guildId}: ${(error as Error).message}`);
      const guild = active.guilds.cache.get(guildId);
      if (guild?.emojis?.cache?.size) {
        emojis = [...guild.emojis.cache.values()].map((e) => ({ id: e.id, name: e.name ?? '', animated: e.animated }));
      }
    }

    const count = emojiRegistry.setCustomEmojis(emojis);
    this.lastEmojiCount = count;
    this.lastEmojiGuild = guildId;
    this.logger.info('Panel Service', `Loaded ${count} custom emoji(s) from guild ${guildId}`);
    return count;
  }
}
