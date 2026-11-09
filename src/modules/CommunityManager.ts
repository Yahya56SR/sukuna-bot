// Sukuna Bot - Welcome/Goodbye Systems

import { Client, TextChannel, ChannelType, EmbedBuilder, AttachmentBuilder } from 'discord.js';
import { Logger } from '../infrastructure/Logger';
import { welcomeCard } from '../utils/welcomecard';
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

export class CommunityManager {
  private client: Client | null = null;
  private logger: Logger;
  private communityConfig: CommunityConfig;
  private cardService: any | null = null;

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

  private async handleMemberJoin(member: any): Promise<void> {
    if (!this.communityConfig.welcome.enabled) return;

    const channel = member.guild.channels.cache.get(this.communityConfig.welcome.channel);
    if (!channel || channel.type !== ChannelType.GuildText) {
      return;
    }

    try {
      const textMessage = this.fillTemplate(this.communityConfig.welcome.message, member);
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
          if (this.communityConfig.welcome.embed) {
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
          if (this.communityConfig.welcome.embed) {
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
      } else if (this.communityConfig.welcome.embed) {
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
    if (!this.communityConfig.goodbye.enabled) return;

    const channel = member.guild.channels.cache.get(this.communityConfig.goodbye.channel);
    if (!channel || channel.type !== ChannelType.GuildText) {
      return;
    }

    try {
      const message = this.fillTemplate(this.communityConfig.goodbye.message, member);
      if (this.communityConfig.goodbye.embed) {
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

  public async assignDefaultRole(member: any): Promise<void> {
    if (!this.communityConfig.autoroles.enabled || !this.communityConfig.autoroles.defaultRole) return;

    try {
      const role = member.guild.roles.cache.get(this.communityConfig.autoroles.defaultRole);
      if (role) {
        await member.roles.add(role);
        this.logger.info('Community Manager', `Assigned default role to ${member.user.tag} in ${member.guild.name}`);
      }
    } catch (error) {
      this.logger.error('Community Manager', `Failed to assign default role to ${member.user.tag}`, error as Error);
    }
  }

  public async shutdown(): Promise<void> {
    this.logger.info('Community Manager', 'Community systems shutdown successfully');
  }
}
