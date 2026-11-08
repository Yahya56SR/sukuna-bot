"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MusicCommands = exports.MusicService = void 0;
const discord_js_1 = require("discord.js");
const drizzle_orm_1 = require("drizzle-orm");
const schema_1 = require("../../database/schema");
class MusicService {
    constructor(logger) {
        this.db = null;
        this.sessions = new Map();
        this.logger = logger;
    }
    setDb(db) {
        this.db = db;
    }
    async initialize() {
        this.logger.info('Music Service', 'Music system initialized');
        this.logger.warn('Music Service', 'Lavalink integration requires a running Lavalink server');
    }
    async getSession(guildId) {
        if (!this.db)
            return null;
        const result = await this.db.select().from(schema_1.musicSessions).where((0, drizzle_orm_1.eq)(schema_1.musicSessions.guild_id, guildId));
        return result[0] || null;
    }
    async createSession(guildId, channelId) {
        if (!this.db)
            return;
        await this.db.insert(schema_1.musicSessions).values({
            id: `music_${guildId}`,
            guild_id: guildId,
            channel_id: channelId,
            status: 'idle',
            volume: 50,
            created_at: new Date(),
            updated_at: new Date(),
        });
    }
    async play(guildId, track) {
        const session = this.sessions.get(guildId);
        if (session) {
            session.queue.push(track);
        }
        else {
            this.sessions.set(guildId, { current: track, queue: [], volume: 50 });
        }
        this.logger.info('Music Service', `Playing: ${track.title} in guild ${guildId}`);
    }
    async skip(guildId) {
        const session = this.sessions.get(guildId);
        if (!session || session.queue.length === 0)
            return null;
        const next = session.queue.shift();
        session.current = next;
        return next;
    }
    async stop(guildId) {
        this.sessions.delete(guildId);
        this.logger.info('Music Service', `Stopped music in guild ${guildId}`);
    }
    async getQueue(guildId) {
        const session = this.sessions.get(guildId);
        return session ? session.queue : [];
    }
    async setVolume(guildId, volume) {
        const session = this.sessions.get(guildId);
        if (session) {
            session.volume = Math.min(100, Math.max(0, volume));
        }
    }
    async shutdown() {
        this.sessions.clear();
        this.logger.info('Music Service', 'Music system shutdown');
    }
}
exports.MusicService = MusicService;
class MusicCommands {
    constructor(service, logger) {
        this.playCommand = {
            data: new discord_js_1.SlashCommandBuilder()
                .setName('play')
                .setDescription('Play a song')
                .addStringOption(option => option.setName('query').setDescription('Song name or URL').setRequired(true)),
            execute: async (interaction) => {
                if (!interaction.guild || !interaction.guild.members) {
                    await interaction.reply({ content: 'This command can only be used in a server.', flags: discord_js_1.MessageFlags.Ephemeral });
                    return;
                }
                const query = interaction.options.getString('query', true);
                const member = interaction.guild.members.cache.get(interaction.user.id);
                if (!member?.voice.channel) {
                    await interaction.reply({ content: 'You need to be in a voice channel.', flags: discord_js_1.MessageFlags.Ephemeral });
                    return;
                }
                try {
                    const track = {
                        title: query,
                        author: 'Unknown',
                        duration: 0,
                        url: query,
                        requestedBy: interaction.user.id,
                    };
                    await this.service.play(interaction.guildId, track);
                    await interaction.reply({ content: `🎵 Added to queue: ${query}`, flags: discord_js_1.MessageFlags.Ephemeral });
                }
                catch (error) {
                    this.logger.error('Music Commands', 'Failed to play', error);
                    await interaction.reply({ content: 'Failed to play song.', flags: discord_js_1.MessageFlags.Ephemeral });
                }
            },
        };
        this.skipCommand = {
            data: new discord_js_1.SlashCommandBuilder()
                .setName('skip')
                .setDescription('Skip the current song'),
            execute: async (interaction) => {
                if (!interaction.guild) {
                    await interaction.reply({ content: 'This command can only be used in a server.', flags: discord_js_1.MessageFlags.Ephemeral });
                    return;
                }
                try {
                    const track = await this.service.skip(interaction.guildId);
                    if (track) {
                        await interaction.reply({ content: `⏭️ Skipped: ${track.title}` });
                    }
                    else {
                        await interaction.reply({ content: 'No songs in queue.', flags: discord_js_1.MessageFlags.Ephemeral });
                    }
                }
                catch (error) {
                    this.logger.error('Music Commands', 'Failed to skip', error);
                    await interaction.reply({ content: 'Failed to skip song.', flags: discord_js_1.MessageFlags.Ephemeral });
                }
            },
        };
        this.stopCommand = {
            data: new discord_js_1.SlashCommandBuilder()
                .setName('stop')
                .setDescription('Stop music and clear queue'),
            execute: async (interaction) => {
                if (!interaction.guild) {
                    await interaction.reply({ content: 'This command can only be used in a server.', flags: discord_js_1.MessageFlags.Ephemeral });
                    return;
                }
                try {
                    await this.service.stop(interaction.guildId);
                    await interaction.reply({ content: '⏹️ Music stopped.' });
                }
                catch (error) {
                    this.logger.error('Music Commands', 'Failed to stop', error);
                    await interaction.reply({ content: 'Failed to stop music.', flags: discord_js_1.MessageFlags.Ephemeral });
                }
            },
        };
        this.queueCommand = {
            data: new discord_js_1.SlashCommandBuilder()
                .setName('queue')
                .setDescription('View the music queue'),
            execute: async (interaction) => {
                if (!interaction.guild) {
                    await interaction.reply({ content: 'This command can only be used in a server.', flags: discord_js_1.MessageFlags.Ephemeral });
                    return;
                }
                try {
                    const queue = await this.service.getQueue(interaction.guildId);
                    if (queue.length === 0) {
                        await interaction.reply({ content: 'Queue is empty.', flags: discord_js_1.MessageFlags.Ephemeral });
                        return;
                    }
                    const embed = new discord_js_1.EmbedBuilder()
                        .setColor('#0099ff')
                        .setTitle('🎵 Music Queue')
                        .setDescription(queue.map((t, i) => `${i + 1}. ${t.title}`).join('\n'))
                        .setTimestamp();
                    await interaction.reply({ embeds: [embed] });
                }
                catch (error) {
                    this.logger.error('Music Commands', 'Failed to get queue', error);
                    await interaction.reply({ content: 'Failed to get queue.', flags: discord_js_1.MessageFlags.Ephemeral });
                }
            },
        };
        this.volumeCommand = {
            data: new discord_js_1.SlashCommandBuilder()
                .setName('volume')
                .setDescription('Set music volume')
                .addIntegerOption(option => option.setName('volume').setDescription('Volume (0-100)').setRequired(true)),
            execute: async (interaction) => {
                if (!interaction.guild) {
                    await interaction.reply({ content: 'This command can only be used in a server.', flags: discord_js_1.MessageFlags.Ephemeral });
                    return;
                }
                const volume = interaction.options.getInteger('volume', true);
                try {
                    await this.service.setVolume(interaction.guildId, volume);
                    await interaction.reply({ content: `🔊 Volume set to ${volume}%` });
                }
                catch (error) {
                    this.logger.error('Music Commands', 'Failed to set volume', error);
                    await interaction.reply({ content: 'Failed to set volume.', flags: discord_js_1.MessageFlags.Ephemeral });
                }
            },
        };
        this.service = service;
        this.logger = logger;
    }
    getCommands() {
        return [this.playCommand, this.skipCommand, this.stopCommand, this.queueCommand, this.volumeCommand];
    }
}
exports.MusicCommands = MusicCommands;
