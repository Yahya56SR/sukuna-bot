// Sukuna Bot - Welcome/Goodbye Systems

import { Client, TextChannel, ChannelType, EmbedBuilder, AttachmentBuilder } from 'discord.js';
import { eq } from 'drizzle-orm';
import { Logger } from '../infrastructure/Logger';
import { welcomeCard } from '../utils/welcomecard';
import { guildSettings } from '../database/schema';
import type { DrizzleDb } from '../types/database';
import type { WelcomeCardTemplate } from '../config/CardTemplates';

export interface WelcomeConfig {
  enabled: boolean;
  channel: string;
  message: string;
  embed: boolean;
  sendImage: boolean;
  welcomeImageMessage: string;
}

export interface GoodbyeConfig {
  enabled: boolean;
  channel: string;
  message: string;
  embed: boolean;
}

export interface CommunityConfig {
  welcome: WelcomeConfig;
  goodbye: GoodbyeConfig;
  autoroles: AutorolesConfig;
}

export interface AutorolesConfig {
  enabled: boolean;
  defaultRole: string;
  configurable: boolean;
}

interface GuildOverrides {
  welcomeEnabled: boolean | null;
  welcomeChannelId: string | null;
  welcomeMessage: string | null;
  goodbyeEnabled: boolean | null;
  goodbyeChannelId: string | null;
  goodbyeMessage: string | null;
  autorolesEnabled: boolean | null;
  autoroleIds: string[];
}

export class CommunityManager {
  private client: Client | null = null;
  private logger: Logger;
  private communityConfig: CommunityConfig;
  private cardService: any | null = null;
  private db: DrizzleDb | null = null;

  constructor(logger: Logger, communityConfig: CommunityConfig) {
    this.logger = logger;
    this.communityConfig = communityConfig;
    // Back-compat: default sendImage on for existing configs
    (this.communityConfig.welcome as any).sendImage = (this.communityConfig.welcome as any).sendImage ?? true;
    (this.communityConfig.welcome as any).welcomeImageMessage = (this.communityConfig.welcome as any).welcomeImageMessage ?? 'Welcome {username} to {server}!';
  }

  public setCardService(service: any): void {
    this.cardService = service;
  }

  public setDb(db: DrizzleDb): void {
    this.db = db;
  }

  public setConfig(config: CommunityConfig): void {
    this.communityConfig = config;
  }

  public getConfig(): CommunityConfig {
    return this.communityConfig;
  }

  public async initialize(client: Client): Promise<void> {
    try {
      this.client = client;
      this.logger.info('Community Manager', 'Initializing community systems...');

      this.setupEventHandlers();

      this.logger.info('Community Manager', 'Community systems initialized successfully');
    } catch (error) {
      this.logger.error('Community Manager', 'Community systems initialization failed', error as Error);
      throw error;
    }
  }

  private setupEventHandlers(): void {
    if (!this.client) return;

    this.client.on('guildMemberAdd', async (member) => {
      await this.handleMemberJoin(member);
      await this.assignAutoroles(member);
    });

    this.client.on('guildMemberRemove', async (member) => {
      await this.handleMemberLeave(member);
    });
  }

  private fillTemplate(template: string, member: any): string {
    return (template || '')
      .replace(/\{user\}/g, `<@${member.id}>`)
      .replace(/\{username\}/g, member.displayName ?? member.user?.username ?? member.user?.tag ?? 'New Member')
      .replace(/\{server\}/g, member.guild?.name ?? '')
      .replace(/\{memberCount\}/g, String(member.guild?.memberCount ?? ''))
      .replace(/\{tag\}/g, member.user?.tag ?? '');
  }

  private fillTemplateForImage(template: string, member: any): string {
    // Image cards can't render @mentions — use plain display name
    return (template || '')
      .replace(/\{user\}/g, member.displayName ?? member.user?.username ?? 'New Member')
      .replace(/\{username\}/g, member.displayName ?? member.user?.username ?? 'New Member')
      .replace(/\{server\}/g, member.guild?.name ?? '')
      .replace(/\{memberCount\}/g, String(member.guild?.memberCount ?? ''))
      .replace(/\{tag\}/g, member.user?.tag ?? '');
  }

  /** Per-guild overrides from `guild_settings` (nulls = not set → fall back to global config). */
  private async guildOverrides(guildId: string): Promise<GuildOverrides> {
    const empty: GuildOverrides = {
      welcomeEnabled: null,
      welcomeChannelId: null,
      welcomeMessage: null,
      goodbyeEnabled: null,
      goodbyeChannelId: null,
      goodbyeMessage: null,
      autorolesEnabled: null,
      autoroleIds: [],
    };
    if (!this.db) return empty;
    try {
      const rows = await this.db.select().from(guildSettings).where(eq(guildSettings.guild_id, guildId)).limit(1);
      const row = rows[0];
      if (!row) return empty;
      let autoroleIds: string[] = [];
      try {
        const parsed = row.autorole_ids;
        autoroleIds = Array.isArray(parsed) ? parsed.map(String) : [];
      } catch { autoroleIds = []; }
      return {
        welcomeEnabled: row.welcome_enabled ?? null,
        welcomeChannelId: row.welcome_channel_id ?? null,
        welcomeMessage: row.welcome_message ?? null,
        goodbyeEnabled: row.goodbye_enabled ?? null,
        goodbyeChannelId: row.goodbye_channel_id ?? null,
        goodbyeMessage: row.goodbye_message ?? null,
        autorolesEnabled: row.autoroles_enabled ?? null,
        autoroleIds,
      };
    } catch {
      return empty;
    }
  }

  private async handleMemberJoin(member: any): Promise<void> {
    const guildId = member.guild?.id;
    if (!guildId) return;
    const overrides = await this.guildOverrides(guildId);
    const welcome = this.communityConfig.welcome;
    const enabled = overrides.welcomeEnabled ?? welcome.enabled;
    if (!enabled) return;

    const channelId = overrides.welcomeChannelId ?? welcome.channel;
    if (!channelId) return;
    const channel = member.guild.channels.cache.get(channelId)
      ?? await member.guild.channels.fetch(channelId).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildText) {
      return;
    }

    const messageTemplate = overrides.welcomeMessage ?? welcome.message;

    try {
      const textMessage = this.fillTemplate(messageTemplate, member);
      const imageMessage = this.fillTemplateForImage(
        (this.communityConfig.welcome as any).welcomeImageMessage || 'Welcome {username} to {server}!',
        member,
      );

      const shouldSendImage = (this.communityConfig.welcome as any).sendImage !== false;

      if (shouldSendImage) {
        try {
          const tmpl: Partial<WelcomeCardTemplate> | undefined = this.cardService?.getConfig?.()?.welcome;
          const buffer = await welcomeCard.generate({
            avatarUrl: member.user.displayAvatarURL({ extension: 'png', size: 256 }),
            displayName: member.displayName ?? member.user.username,
            guildName: member.guild.name,
            memberCount: member.guild.memberCount,
            welcomeMessage: imageMessage,
            template: tmpl,
          });
          const file = new AttachmentBuilder(buffer, { name: 'welcome.png' });
          if (welcome.embed) {
            const embed = new EmbedBuilder()
              .setColor('#ef4444')
              .setTitle('🎉 Welcome!')
              .setDescription(textMessage)
              .setThumbnail(member.user.displayAvatarURL())
              .setImage('attachment://welcome.png')
              .setFooter({ text: member.guild.name })
              .setTimestamp();
            await (channel as TextChannel).send({ embeds: [embed], files: [file] });
          } else {
            await (channel as TextChannel).send({ content: textMessage, files: [file] });
          }
        } catch (cardErr) {
          this.logger.warn('Community Manager', 'Welcome card render failed, sending text only', cardErr as Error);
          // Fallback to text/embed without image
          if (welcome.embed) {
            const embed = new EmbedBuilder()
              .setColor('#ef4444')
              .setTitle('🎉 Welcome!')
              .setDescription(textMessage)
              .setThumbnail(member.user.displayAvatarURL())
              .setFooter({ text: member.guild.name })
              .setTimestamp();
            await (channel as TextChannel).send({ embeds: [embed] });
          } else {
            await channel.send(textMessage);
          }
        }
      } else if (welcome.embed) {
        const embed = new EmbedBuilder()
          .setColor('#ef4444')
          .setTitle('🎉 Welcome!')
          .setDescription(textMessage)
          .setThumbnail(member.user.displayAvatarURL())
          .setFooter({ text: member.guild.name })
          .setTimestamp();
        await (channel as TextChannel).send({ embeds: [embed] });
      } else {
        await channel.send(textMessage);
      }

      this.logger.info('Community Manager', `Welcome message sent for ${member.user.tag} in ${member.guild.name}`);
    } catch (error) {
      this.logger.error('Community Manager', `Failed to send welcome message for ${member.user.tag}`, error as Error);
    }
  }

  private async handleMemberLeave(member: any): Promise<void> {
    const guildId = member.guild?.id;
    if (!guildId) return;
    const overrides = await this.guildOverrides(guildId);
    const goodbye = this.communityConfig.goodbye;
    const enabled = overrides.goodbyeEnabled ?? goodbye.enabled;
    if (!enabled) return;

    const channelId = overrides.goodbyeChannelId ?? goodbye.channel;
    if (!channelId) return;
    const channel = member.guild.channels.cache.get(channelId)
      ?? await member.guild.channels.fetch(channelId).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildText) {
      return;
    }

    const messageTemplate = overrides.goodbyeMessage ?? goodbye.message;

    try {
      const message = this.fillTemplate(messageTemplate, member);
      if (goodbye.embed) {
        const embed = new EmbedBuilder()
          .setColor('#ff0000')
          .setTitle('👋 Goodbye!')
          .setDescription(message)
          .setThumbnail(member.user.displayAvatarURL())
          .setFooter({ text: member.guild.name })
          .setTimestamp();

        await (channel as TextChannel).send({ embeds: [embed] });
      } else {
        await channel.send(message);
      }

      this.logger.info('Community Manager', `Goodbye message sent for ${member.user.tag} in ${member.guild.name}`);
    } catch (error) {
      this.logger.error('Community Manager', `Failed to send goodbye message for ${member.user.tag}`, error as Error);
    }
  }

  /**
   * Assign the configured autorole(s) to a new member.
   * Per-guild `guild_settings.autorole_ids` (JSON array) take precedence over
   * the global `autoroles.defaultRole`. Roles that are unmanaged, above the
   * bot, or missing are skipped instead of failing the whole join.
   */
  public async assignAutoroles(member: any): Promise<number> {
    const guildId = member.guild?.id;
    if (!guildId) return 0;
    const overrides = await this.guildOverrides(guildId);
    const autoroles = this.communityConfig.autoroles;

    const enabled = overrides.autorolesEnabled ?? autoroles.enabled;
    if (!enabled) return 0;

    const roleIds = overrides.autoroleIds.length > 0
      ? overrides.autoroleIds
      : (autoroles.defaultRole ? [autoroles.defaultRole] : []);
    if (roleIds.length === 0) return 0;

    const botMember = member.guild.members?.me
      ?? (member.guild.members?.cache?.get?.(this.client?.user?.id ?? ''));
    const botHighest = botMember?.roles?.highest?.position ?? Number.MAX_SAFE_INTEGER;

    let assigned = 0;
    for (const roleId of roleIds) {
      try {
        const role = member.guild.roles.cache.get(roleId)
          ?? await member.guild.roles.fetch(roleId).catch(() => null);
        if (!role) {
          this.logger.warn('Community Manager', `Autorole ${roleId} not found in ${member.guild.name}`);
          continue;
        }
        if (role.managed) {
          this.logger.warn('Community Manager', `Autorole ${role.name} is managed and cannot be assigned`);
          continue;
        }
        if (role.position >= botHighest) {
          this.logger.warn('Community Manager', `Autorole ${role.name} is above the bot's highest role`);
          continue;
        }
        await member.roles.add(role, 'Autorole assignment');
        assigned += 1;
      } catch (error) {
        this.logger.error('Community Manager', `Failed to assign autorole ${roleId} to ${member.user?.tag ?? member.id}`, error as Error);
      }
    }

    if (assigned > 0) {
      this.logger.info('Community Manager', `Assigned ${assigned} autorole(s) to ${member.user?.tag ?? member.id} in ${member.guild.name}`);
    }
    return assigned;
  }

  /** Legacy wrapper kept for callers that used assignDefaultRole directly. */
  public async assignDefaultRole(member: any): Promise<void> {
    await this.assignAutoroles(member);
  }

  public async shutdown(): Promise<void> {
    this.logger.info('Community Manager', 'Community systems shutdown successfully');
  }
}
