"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MusicCommands = exports.MusicService = void 0;
const discord_js_1 = require("discord.js");
const lavalink_client_1 = require("lavalink-client");
const drizzle_orm_1 = require("drizzle-orm");
const schema_1 = require("../../database/schema");
const URL_RE = /^https?:\/\//i;
function trackOf(t, requesterId) {
    const info = t?.info ?? {};
    return {
        title: info.title ?? 'Unknown',
        author: info.author ?? 'Unknown',
        duration: Number(info.duration ?? 0),
        url: info.uri ?? '',
        thumbnail: info.artworkUrl ?? undefined,
        requestedBy: requesterId ?? String(t?.requester ?? ''),
    };
}
class MusicService {
    constructor(logger, config) {
        this.db = null;
        this.client = null;
        this.manager = null;
        this.ready = false;
        this.logger = logger;
        this.config = config;
    }
    setDb(db) {
        this.db = db;
    }
    setClient(client) {
        this.client = client;
    }
    getConfig() {
        return this.config;
    }
    setConfig(config) {
        this.config = { ...config };
        // Runtime port/password changes require a restart; log rather than lie.
        this.logger.info('Music Service', 'Music config updated (node changes apply after restart)');
    }
    /** True when a Lavalink node is configured and enabled. */
    get isReady() {
        return this.ready;
    }
    /**
     * Live status for the dashboard: node reachability plus what each guild is
     * currently playing. Never throws — music is optional infrastructure.
     */
    getStatus() {
        const players = [];
        try {
            const map = this.manager?.players ?? new Map();
            for (const player of map.values()) {
                let current = null;
                let queued = 0;
                try {
                    current = player?.queue?.current ?? null;
                    queued = Array.isArray(player?.queue?.tracks) ? player.queue.tracks.length : 0;
                }
                catch { /* queue shape changed */ }
                players.push({
                    guildId: String(player?.guildId ?? ''),
                    connected: Boolean(player?.connected),
                    playing: Boolean(player?.playing),
                    paused: Boolean(player?.paused),
                    volume: Number(player?.volume ?? 0),
                    queueSize: queued,
                    current: current ? {
                        title: String(current.info?.title ?? current.title ?? 'Unknown'),
                        author: String(current.info?.author ?? current.author ?? ''),
                        uri: current.info?.uri ?? current.uri ?? null,
                        length: Number(current.info?.length ?? current.length ?? 0),
                    } : null,
                });
            }
        }
        catch {
            // Manager not initialised yet.
        }
        return {
            enabled: Boolean(this.config.enabled),
            ready: Boolean(this.ready),
            host: this.config.lavalinkHost,
            port: this.config.lavalinkPort,
            secure: Boolean(this.config.lavalinkSecure),
            nodeId: this.config.lavalinkNodeId || 'main',
            players,
        };
    }
    async initialize() {
        if (!this.config.enabled) {
            this.logger.info('Music Service', 'Music system disabled');
            return;
        }
        if (!this.client) {
            this.logger.warn('Music Service', 'Music enabled but no Discord client attached — commands will reject');
            return;
        }
        const nodeId = this.config.lavalinkNodeId || 'main';
        this.manager = new lavalink_client_1.LavalinkManager({
            nodes: [{
                    id: nodeId,
                    host: this.config.lavalinkHost,
                    port: Number(this.config.lavalinkPort) || 2333,
                    authorization: this.config.lavalinkPassword,
                    secure: Boolean(this.config.lavalinkSecure),
                }],
            sendToShard: (guildId, payload) => {
                const shardId = this.client?.guilds.cache.get(guildId)?.shardId;
                const shard = shardId === undefined ? this.client?.ws.shards.first() : this.client?.ws.shards.get(shardId);
                try {
                    shard?.send(payload);
                }
                catch (error) {
                    this.logger.warn('Music Service', `Could not send voice payload to shard: ${error.message}`);
                }
            },
            autoSkip: true,
            client: {
                id: this.client.user?.id ?? 'unknown',
                username: this.client.user?.username ?? 'Sukuna',
            },
        });
        this.client.on('raw', (payload) => {
            void this.manager?.sendRawData(payload);
        });
        this.manager.nodeManager.on('connect', (node) => {
            this.ready = true;
            this.logger.info('Music Service', `Connected to Lavalink node "${node.id ?? 'main'}"`);
        });
        this.manager.nodeManager.on('disconnect', (node, reason) => {
            this.ready = false;
            this.logger.warn('Music Service', `Lavalink node disconnected: ${node?.id ?? 'main'} (${reason?.reason ?? reason?.code ?? 'unknown'})`);
        });
        this.manager.nodeManager.on('error', (_node, error) => {
            this.ready = false;
            this.logger.warn('Music Service', `Lavalink node error: ${error?.message ?? 'unknown'}`);
        });
        this.manager.on('trackStart', (player, track) => {
            void this.updateSessionRow(player.guildId, 'playing', track?.info ? `${track.info.title} — ${track.info.author}` : '');
        });
        this.manager.on('queueEnd', (player) => {
            void this.updateSessionRow(player.guildId, 'idle', '');
            player.destroy('Queue ended').catch(() => undefined);
        });
        this.manager.on('trackError', (player, track, payload) => {
            this.logger.warn('Music Service', `Track error in guild ${player.guildId} (${track?.info?.title ?? 'unknown'}): ${payload?.exception?.message ?? 'unknown'}`);
        });
        const startManager = async () => {
            try {
                await this.manager?.init({
                    id: this.client.user.id,
                    username: this.client.user.username,
                });
                this.logger.info('Music Service', 'Music system initialized');
            }
            catch (error) {
                this.logger.error('Music Service', 'Could not initialize Lavalink — music commands will fail until a node is reachable', error);
            }
        };
        if (this.client.isReady()) {
            await startManager();
        }
        else {
            this.client.once('ready', () => void startManager());
        }
    }
    async updateSessionRow(guildId, status, currentTrack) {
        if (!this.db)
            return;
        try {
            const existing = await this.db.select({ id: schema_1.musicSessions.id }).from(schema_1.musicSessions).where((0, drizzle_orm_1.eq)(schema_1.musicSessions.guild_id, guildId)).limit(1);
            const now = new Date();
            if (existing[0]) {
                await this.db.update(schema_1.musicSessions)
                    .set({ status, current_track: currentTrack, updated_at: now })
                    .where((0, drizzle_orm_1.eq)(schema_1.musicSessions.guild_id, guildId));
            }
            else {
                await this.db.insert(schema_1.musicSessions).values({
                    id: `music_${guildId}`,
                    guild_id: guildId,
                    channel_id: '',
                    status,
                    current_track: currentTrack,
                    volume: this.config.defaultVolume,
                    created_at: now,
                    updated_at: now,
                });
            }
        }
        catch (error) {
            this.logger.warn('Music Service', `Could not persist music session: ${error.message}`);
        }
    }
    async getSession(guildId) {
        if (!this.db)
            return null;
        const result = await this.db.select().from(schema_1.musicSessions).where((0, drizzle_orm_1.eq)(schema_1.musicSessions.guild_id, guildId)).limit(1);
        return result[0] || null;
    }
    async createSession(guildId, channelId) {
        if (!this.db)
            return;
        try {
            const existing = await this.db.select({ id: schema_1.musicSessions.id }).from(schema_1.musicSessions).where((0, drizzle_orm_1.eq)(schema_1.musicSessions.guild_id, guildId)).limit(1);
            const now = new Date();
            if (existing[0]) {
                await this.db.update(schema_1.musicSessions).set({ channel_id: channelId, updated_at: now }).where((0, drizzle_orm_1.eq)(schema_1.musicSessions.guild_id, guildId));
            }
            else {
                await this.db.insert(schema_1.musicSessions).values({
                    id: `music_${guildId}`,
                    guild_id: guildId,
                    channel_id: channelId,
                    status: 'idle',
                    volume: this.config.defaultVolume,
                    created_at: now,
                    updated_at: now,
                });
            }
        }
        catch (error) {
            this.logger.warn('Music Service', `Could not persist music session: ${error.message}`);
        }
    }
    assertUsable() {
        if (!this.config.enabled)
            throw new Error('Music is disabled');
        if (!this.manager)
            throw new Error('Music is not ready (voice client missing). Check the Lavalink configuration.');
        if (!this.ready)
            throw new Error('No Lavalink node is connected. Verify LAVALINK_HOST/PORT/PASSWORD and that the node is running.');
    }
    getPlayer(guildId) {
        return this.manager?.getPlayer(guildId);
    }
    getOrCreatePlayer(guildId, voiceChannelId, textChannelId) {
        if (!this.manager)
            throw new Error('Music manager is not initialized');
        return this.manager.createPlayer({
            guildId,
            voiceChannelId,
            ...(textChannelId ? { textChannelId } : {}),
            volume: Math.min(100, Math.max(0, this.config.defaultVolume)),
            selfDeaf: true,
        });
    }
    // ---- playback ----------------------------------------------------------
    async play(guildId, query, requesterId, voiceChannelId, textChannelId) {
        this.assertUsable();
        const player = this.getPlayer(guildId) ?? (voiceChannelId ? this.getOrCreatePlayer(guildId, voiceChannelId, textChannelId) : undefined);
        if (!player)
            throw new Error('Join a voice channel first.');
        if (!player.connected) {
            await player.connect();
        }
        const isUrl = URL_RE.test(query.trim());
        const result = await player.search(isUrl ? { query: query.trim() } : { query: query.trim(), source: 'ytsearch' }, requesterId);
        if (!result || result.loadType === 'error' || result.loadType === 'empty' || !result.tracks?.length) {
            throw new Error(`Nothing found for "${query}".`);
        }
        const playlist = result.loadType === 'playlist'
            ? result.tracks.slice(0, Math.max(1, this.config.maxPlaylistSize))
            : result.tracks.slice(0, 1);
        const wasPlaying = player.playing || Boolean(player.queue.current);
        await player.queue.add(playlist);
        if (!wasPlaying) {
            await player.play({ paused: false });
        }
        const first = playlist[0];
        const info = trackOf(first, requesterId);
        if (!info.url && isUrl)
            info.url = query.trim();
        await this.updateSessionRow(guildId, 'playing', `${info.title} — ${info.author}`);
        return { track: info, queued: wasPlaying, added: playlist.length };
    }
    async skip(guildId) {
        const player = this.getPlayer(guildId);
        const current = player?.queue.current;
        if (!this.config.allowSkip)
            return null;
        if (!player)
            return null;
        await player.skip(0);
        if (!current)
            return null;
        return trackOf(current);
    }
    async stop(guildId) {
        const player = this.getPlayer(guildId);
        if (player) {
            await player.destroy('Stopped by user').catch(() => undefined);
        }
        await this.updateSessionRow(guildId, 'idle', '');
        this.logger.info('Music Service', `Stopped music in guild ${guildId}`);
    }
    async pause(guildId) {
        const player = this.getPlayer(guildId);
        if (!player || !player.queue.current)
            return false;
        await player.pause();
        return true;
    }
    async resume(guildId) {
        const player = this.getPlayer(guildId);
        if (!player || !player.queue.current)
            return false;
        await player.resume();
        return true;
    }
    async getQueue(guildId) {
        const player = this.getPlayer(guildId);
        if (!player)
            return [];
        const tracks = (player.queue?.tracks ?? []);
        return tracks.map((t) => trackOf(t));
    }
    async getNowPlaying(guildId) {
        const player = this.getPlayer(guildId);
        const current = player?.queue.current;
        if (!current)
            return null;
        return {
            track: trackOf(current),
            position: Number(player?.position ?? 0),
            paused: Boolean(player?.paused),
        };
    }
    async setVolume(guildId, volume) {
        const player = this.getPlayer(guildId);
        if (!player)
            return false;
        const clamped = Math.min(100, Math.max(0, Math.floor(volume)));
        await player.setVolume(clamped);
        await this.updateSessionRow(guildId, player.queue.current ? 'playing' : 'idle', player.queue.current ? `${player.queue.current.info.title} — ${player.queue.current.info.author}` : '');
        return true;
    }
    async shutdown() {
        this.ready = false;
        if (this.manager) {
            try {
                for (const player of this.manager.players.values()) {
                    await player.destroy('Bot shutdown').catch(() => undefined);
                }
            }
            catch { /* best-effort */ }
            this.manager = null;
        }
        this.logger.info('Music Service', 'Music system shutdown');
    }
}
exports.MusicService = MusicService;
function formatDurationMs(ms) {
    if (!Number.isFinite(ms) || ms <= 0)
        return 'LIVE';
    const total = Math.floor(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
}
class MusicCommands {
    constructor(service, logger) {
        this.playCommand = {
            data: new discord_js_1.SlashCommandBuilder()
                .setName('play')
                .setDescription('Play a song or playlist')
                .addStringOption((option) => option.setName('query').setDescription('Song name or URL').setRequired(true)),
            execute: async (interaction) => {
                if (!interaction.guild || !interaction.guildId) {
                    await interaction.reply({ content: 'This command can only be used in a server.', flags: discord_js_1.MessageFlags.Ephemeral });
                    return;
                }
                const voice = await this.voiceChannelFor(interaction);
                if (!voice) {
                    await interaction.reply({ content: 'You need to be in a voice channel.', flags: discord_js_1.MessageFlags.Ephemeral });
                    return;
                }
                const query = interaction.options.getString('query', true);
                await interaction.deferReply();
                try {
                    const result = await this.service.play(interaction.guildId, query, interaction.user.id, voice.channel.id, interaction.channelId);
                    const suffix = result.added > 1 ? ` (+${result.added - 1} more from playlist)` : '';
                    if (result.queued) {
                        await interaction.editReply({ content: `🎶 Queued: **${result.track.title}** — ${result.track.author}${suffix}` });
                    }
                    else {
                        await interaction.editReply({
                            embeds: [new discord_js_1.EmbedBuilder()
                                    .setColor('#0099ff')
                                    .setTitle('🎵 Now Playing')
                                    .setDescription(`**${result.track.title}**\n${result.track.author}`)
                                    .setThumbnail(result.track.thumbnail ?? null)],
                        });
                    }
                }
                catch (error) {
                    this.logger.error('Music Commands', 'Failed to play', error);
                    await interaction.editReply({ content: `❌ ${error.message}` });
                }
            },
        };
        this.skipCommand = {
            data: new discord_js_1.SlashCommandBuilder()
                .setName('skip')
                .setDescription('Skip the current song'),
            execute: async (interaction) => {
                if (!interaction.guild || !interaction.guildId) {
                    await interaction.reply({ content: 'This command can only be used in a server.', flags: discord_js_1.MessageFlags.Ephemeral });
                    return;
                }
                try {
                    const track = await this.service.skip(interaction.guildId);
                    if (track) {
                        await interaction.reply({ content: `⏭️ Skipped: **${track.title}**` });
                    }
                    else {
                        await interaction.reply({ content: 'Nothing is playing (or skipping is disabled).', flags: discord_js_1.MessageFlags.Ephemeral });
                    }
                }
                catch (error) {
                    this.logger.error('Music Commands', 'Failed to skip', error);
                    await interaction.reply({ content: `❌ ${error.message}`, flags: discord_js_1.MessageFlags.Ephemeral });
                }
            },
        };
        this.stopCommand = {
            data: new discord_js_1.SlashCommandBuilder()
                .setName('stop')
                .setDescription('Stop music and clear the queue'),
            execute: async (interaction) => {
                if (!interaction.guild || !interaction.guildId) {
                    await interaction.reply({ content: 'This command can only be used in a server.', flags: discord_js_1.MessageFlags.Ephemeral });
                    return;
                }
                try {
                    await this.service.stop(interaction.guildId);
                    await interaction.reply({ content: '⏹️ Music stopped.' });
                }
                catch (error) {
                    this.logger.error('Music Commands', 'Failed to stop', error);
                    await interaction.reply({ content: `❌ ${error.message}`, flags: discord_js_1.MessageFlags.Ephemeral });
                }
            },
        };
        this.queueCommand = {
            data: new discord_js_1.SlashCommandBuilder()
                .setName('queue')
                .setDescription('View the music queue'),
            execute: async (interaction) => {
                if (!interaction.guild || !interaction.guildId) {
                    await interaction.reply({ content: 'This command can only be used in a server.', flags: discord_js_1.MessageFlags.Ephemeral });
                    return;
                }
                try {
                    const queue = await this.service.getQueue(interaction.guildId);
                    const nowPlaying = await this.service.getNowPlaying(interaction.guildId);
                    if (queue.length === 0 && !nowPlaying) {
                        await interaction.reply({ content: 'Queue is empty.', flags: discord_js_1.MessageFlags.Ephemeral });
                        return;
                    }
                    const lines = [];
                    if (nowPlaying)
                        lines.push(`**Now playing:** ${nowPlaying.track.title} — ${nowPlaying.track.author}`);
                    queue.slice(0, 20).forEach((t, i) => lines.push(`${i + 1}. ${t.title} — ${t.author}`));
                    if (queue.length > 20)
                        lines.push(`… and ${queue.length - 20} more`);
                    const embed = new discord_js_1.EmbedBuilder()
                        .setColor('#0099ff')
                        .setTitle('🎵 Music Queue')
                        .setDescription(lines.join('\n').slice(0, 4000))
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
                .addIntegerOption((option) => option.setName('volume').setDescription('Volume (0-100)').setRequired(true).setMinValue(0).setMaxValue(100)),
            execute: async (interaction) => {
                if (!interaction.guild || !interaction.guildId) {
                    await interaction.reply({ content: 'This command can only be used in a server.', flags: discord_js_1.MessageFlags.Ephemeral });
                    return;
                }
                const volume = interaction.options.getInteger('volume', true);
                try {
                    const ok = await this.service.setVolume(interaction.guildId, volume);
                    if (!ok) {
                        await interaction.reply({ content: 'Nothing is playing in this server.', flags: discord_js_1.MessageFlags.Ephemeral });
                        return;
                    }
                    await interaction.reply({ content: `🔊 Volume set to ${volume}%` });
                }
                catch (error) {
                    this.logger.error('Music Commands', 'Failed to set volume', error);
                    await interaction.reply({ content: `❌ ${error.message}`, flags: discord_js_1.MessageFlags.Ephemeral });
                }
            },
        };
        this.nowPlayingCommand = {
            data: new discord_js_1.SlashCommandBuilder()
                .setName('nowplaying')
                .setDescription('Show the current track'),
            execute: async (interaction) => {
                if (!interaction.guild || !interaction.guildId) {
                    await interaction.reply({ content: 'This command can only be used in a server.', flags: discord_js_1.MessageFlags.Ephemeral });
                    return;
                }
                try {
                    const np = await this.service.getNowPlaying(interaction.guildId);
                    if (!np) {
                        await interaction.reply({ content: 'Nothing is playing right now.', flags: discord_js_1.MessageFlags.Ephemeral });
                        return;
                    }
                    const { track } = np;
                    const embed = new discord_js_1.EmbedBuilder()
                        .setColor('#0099ff')
                        .setTitle('🎵 Now Playing')
                        .setDescription(`**[${track.title}](${track.url})**\n${track.author}\n\nDuration: ${formatDurationMs(track.duration)}${np.paused ? '\n⏸️ Paused' : ''}`)
                        .setThumbnail(track.thumbnail ?? null);
                    await interaction.reply({ embeds: [embed] });
                }
                catch (error) {
                    this.logger.error('Music Commands', 'Failed to show now playing', error);
                    await interaction.reply({ content: 'Failed to show now playing.', flags: discord_js_1.MessageFlags.Ephemeral });
                }
            },
        };
        this.pauseCommand = {
            data: new discord_js_1.SlashCommandBuilder()
                .setName('pause')
                .setDescription('Pause playback'),
            execute: async (interaction) => {
                if (!interaction.guild || !interaction.guildId) {
                    await interaction.reply({ content: 'This command can only be used in a server.', flags: discord_js_1.MessageFlags.Ephemeral });
                    return;
                }
                const ok = await this.service.pause(interaction.guildId);
                await interaction.reply({ content: ok ? '⏸️ Paused.' : 'Nothing to pause.', flags: discord_js_1.MessageFlags.Ephemeral });
            },
        };
        this.resumeCommand = {
            data: new discord_js_1.SlashCommandBuilder()
                .setName('resume')
                .setDescription('Resume playback'),
            execute: async (interaction) => {
                if (!interaction.guild || !interaction.guildId) {
                    await interaction.reply({ content: 'This command can only be used in a server.', flags: discord_js_1.MessageFlags.Ephemeral });
                    return;
                }
                const ok = await this.service.resume(interaction.guildId);
                await interaction.reply({ content: ok ? '▶️ Resumed.' : 'Nothing to resume.', flags: discord_js_1.MessageFlags.Ephemeral });
            },
        };
        this.service = service;
        this.logger = logger;
    }
    getCommands() {
        return [this.playCommand, this.skipCommand, this.stopCommand, this.queueCommand, this.volumeCommand, this.nowPlayingCommand, this.pauseCommand, this.resumeCommand];
    }
    async voiceChannelFor(interaction) {
        const member = interaction.member;
        const channel = member?.voice?.channel;
        if (!channel || channel.type !== 2)
            return null;
        return { member: member, channel: channel };
    }
}
exports.MusicCommands = MusicCommands;
