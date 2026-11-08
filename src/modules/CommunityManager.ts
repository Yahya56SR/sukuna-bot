// Sukuna Bot - Welcome/Goodbye Systems

import { Client, TextChannel, ChannelType, EmbedBuilder } from 'discord.js';
import { Logger } from '../infrastructure/Logger';

export interface WelcomeConfig {
  enabled: boolean;
  channel: string;
  message: string;
  embed: boolean;
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

  constructor(logger: Logger, communityConfig: CommunityConfig) {
    this.logger = logger;
    this.communityConfig = communityConfig;
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

  private async handleMemberJoin(member: any): Promise<void> {
    if (!this.communityConfig.welcome.enabled) return;

    const channel = member.guild.channels.cache.get(this.communityConfig.welcome.channel);
    if (!channel || channel.type !== ChannelType.GuildText) {
      return;
    }

    try {
      if (this.communityConfig.welcome.embed) {
        const embed = new EmbedBuilder()
          .setColor('#00ff00')
          .setTitle('🎉 Welcome!')
          .setDescription(this.communityConfig.welcome.message.replace('{user}', member.user.tag).replace('{server}', member.guild.name))
          .setThumbnail(member.user.displayAvatarURL())
          .setFooter({ text: member.guild.name })
          .setTimestamp();

        await (channel as TextChannel).send({ embeds: [embed] });
      } else {
        await channel.send(this.communityConfig.welcome.message.replace('{user}', member.user.tag).replace('{server}', member.guild.name));
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
      if (this.communityConfig.goodbye.embed) {
        const embed = new EmbedBuilder()
          .setColor('#ff0000')
          .setTitle('👋 Goodbye!')
          .setDescription(this.communityConfig.goodbye.message.replace('{user}', member.user.tag).replace('{server}', member.guild.name))
          .setThumbnail(member.user.displayAvatarURL())
          .setFooter({ text: member.guild.name })
          .setTimestamp();

        await (channel as TextChannel).send({ embeds: [embed] });
      } else {
        await channel.send(this.communityConfig.goodbye.message.replace('{user}', member.user.tag).replace('{server}', member.guild.name));
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
