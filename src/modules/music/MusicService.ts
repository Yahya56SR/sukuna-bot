import { ChatInputCommandInteraction, MessageFlags, EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { Logger } from '../../infrastructure/Logger';
import { eq } from 'drizzle-orm';
import { musicSessions } from '../../database/schema';
import type { DrizzleDb } from '../../types/database';

export interface Track {
  title: string;
  author: string;
  duration: number;
  url: string;
  thumbnail?: string;
  requestedBy: string;
}

export interface MusicConfig {
  enabled: boolean;
  lavalinkHost: string;
  lavalinkPort: number;
  lavalinkPassword: string;
  defaultVolume: number;
  maxPlaylistSize: number;
  allowSkip: boolean;
  allowRepeat: boolean;
}

export class MusicService {
  private logger: Logger;
  private config: MusicConfig;
  private db: DrizzleDb | null = null;
  private sessions: Map<string, any> = new Map();

  constructor(logger: Logger, config: MusicConfig) {
    this.logger = logger;
    this.config = config;
  }

  public setDb(db: DrizzleDb): void {
    this.db = db;
  }

  public getConfig(): MusicConfig {
    return this.config;
  }

  public setConfig(config: MusicConfig): void {
    this.config = config;
  }

  public async initialize(): Promise<void> {
    this.logger.info('Music Service', 'Music system initialized');
    this.logger.warn('Music Service', 'Lavalink integration requires a running Lavalink server');
  }

  public async getSession(guildId: string): Promise<any> {
    if (!this.db) return null;
    const result = await this.db.select().from(musicSessions).where(eq(musicSessions.guild_id, guildId));
    return result[0] || null;
  }

  public async createSession(guildId: string, channelId: string): Promise<void> {
    if (!this.db) return;
    await this.db.insert(musicSessions).values({
      id: `music_${guildId}`,
      guild_id: guildId,
      channel_id: channelId,
      status: 'idle',
      volume: 50,
      created_at: new Date(),
      updated_at: new Date(),
    } as any);
  }

  public async play(guildId: string, track: Track): Promise<void> {
    const session = this.sessions.get(guildId);
    if (session) {
      session.queue.push(track);
    } else {
      this.sessions.set(guildId, { current: track, queue: [], volume: 50 });
    }
    this.logger.info('Music Service', `Playing: ${track.title} in guild ${guildId}`);
  }

  public async skip(guildId: string): Promise<Track | null> {
    const session = this.sessions.get(guildId);
    if (!session || session.queue.length === 0) return null;
    const next = session.queue.shift()!;
    session.current = next;
    return next;
  }

  public async stop(guildId: string): Promise<void> {
    this.sessions.delete(guildId);
    this.logger.info('Music Service', `Stopped music in guild ${guildId}`);
  }

  public async getQueue(guildId: string): Promise<Track[]> {
    const session = this.sessions.get(guildId);
    return session ? session.queue : [];
  }

  public async setVolume(guildId: string, volume: number): Promise<void> {
    const session = this.sessions.get(guildId);
    if (session) {
      session.volume = Math.min(100, Math.max(0, volume));
    }
  }

  public async shutdown(): Promise<void> {
    this.sessions.clear();
    this.logger.info('Music Service', 'Music system shutdown');
  }
}

export class MusicCommands {
  private service: MusicService;
  private logger: Logger;

  constructor(service: MusicService, logger: Logger) {
    this.service = service;
    this.logger = logger;
  }

  public getCommands(): any[] {
    return [this.playCommand, this.skipCommand, this.stopCommand, this.queueCommand, this.volumeCommand];
  }

  private playCommand: any = {
    data: new SlashCommandBuilder()
      .setName('play')
      .setDescription('Play a song')
      .addStringOption(option =>
        option.setName('query').setDescription('Song name or URL').setRequired(true)
      ),
    execute: async (interaction: ChatInputCommandInteraction) => {
      if (!interaction.guild || !interaction.guild.members) {
        await interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
        return;
      }

      const query = interaction.options.getString('query', true);
      const member = interaction.guild.members.cache.get(interaction.user.id);

      if (!member?.voice.channel) {
        await interaction.reply({ content: 'You need to be in a voice channel.', flags: MessageFlags.Ephemeral });
        return;
      }

      try {
        const track: any = {
          title: query,
          author: 'Unknown',
          duration: 0,
          url: query,
          requestedBy: interaction.user.id,
        };

        await this.service.play(interaction.guildId!, track);
        await interaction.reply({ content: `🎵 Added to queue: ${query}`, flags: MessageFlags.Ephemeral });
      } catch (error) {
        this.logger.error('Music Commands', 'Failed to play', error as Error);
        await interaction.reply({ content: 'Failed to play song.', flags: MessageFlags.Ephemeral });
      }
    },
  };

  private skipCommand: any = {
    data: new SlashCommandBuilder()
      .setName('skip')
      .setDescription('Skip the current song'),
    execute: async (interaction: ChatInputCommandInteraction) => {
      if (!interaction.guild) {
        await interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
        return;
      }

      try {
        const track = await this.service.skip(interaction.guildId!);
        if (track) {
          await interaction.reply({ content: `⏭️ Skipped: ${track.title}` });
        } else {
          await interaction.reply({ content: 'No songs in queue.', flags: MessageFlags.Ephemeral });
        }
      } catch (error) {
        this.logger.error('Music Commands', 'Failed to skip', error as Error);
        await interaction.reply({ content: 'Failed to skip song.', flags: MessageFlags.Ephemeral });
      }
    },
  };

  private stopCommand: any = {
    data: new SlashCommandBuilder()
      .setName('stop')
      .setDescription('Stop music and clear queue'),
    execute: async (interaction: ChatInputCommandInteraction) => {
      if (!interaction.guild) {
        await interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
        return;
      }

      try {
        await this.service.stop(interaction.guildId!);
        await interaction.reply({ content: '⏹️ Music stopped.' });
      } catch (error) {
        this.logger.error('Music Commands', 'Failed to stop', error as Error);
        await interaction.reply({ content: 'Failed to stop music.', flags: MessageFlags.Ephemeral });
      }
    },
  };

  private queueCommand: any = {
    data: new SlashCommandBuilder()
      .setName('queue')
      .setDescription('View the music queue'),
    execute: async (interaction: ChatInputCommandInteraction) => {
      if (!interaction.guild) {
        await interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
        return;
      }

      try {
        const queue = await this.service.getQueue(interaction.guildId!);
        if (queue.length === 0) {
          await interaction.reply({ content: 'Queue is empty.', flags: MessageFlags.Ephemeral });
          return;
        }

        const embed = new EmbedBuilder()
          .setColor('#0099ff')
          .setTitle('🎵 Music Queue')
          .setDescription(queue.map((t: any, i: number) => `${i + 1}. ${t.title}`).join('\n'))
          .setTimestamp();

        await interaction.reply({ embeds: [embed] });
      } catch (error) {
        this.logger.error('Music Commands', 'Failed to get queue', error as Error);
        await interaction.reply({ content: 'Failed to get queue.', flags: MessageFlags.Ephemeral });
      }
    },
  };

  private volumeCommand: any = {
    data: new SlashCommandBuilder()
      .setName('volume')
      .setDescription('Set music volume')
      .addIntegerOption(option =>
        option.setName('volume').setDescription('Volume (0-100)').setRequired(true)
      ),
    execute: async (interaction: ChatInputCommandInteraction) => {
      if (!interaction.guild) {
        await interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
        return;
      }

      const volume = interaction.options.getInteger('volume', true);
      try {
        await this.service.setVolume(interaction.guildId!, volume);
        await interaction.reply({ content: `🔊 Volume set to ${volume}%` });
      } catch (error) {
        this.logger.error('Music Commands', 'Failed to set volume', error as Error);
        await interaction.reply({ content: 'Failed to set volume.', flags: MessageFlags.Ephemeral });
      }
    },
  };
}