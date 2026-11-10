"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebServer = void 0;
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const drizzle_orm_1 = require("drizzle-orm");
const schema_1 = require("../database/schema");
const CardTemplates_1 = require("../config/CardTemplates");
const welcomecard_1 = require("../utils/welcomecard");
const rankcard_1 = require("../utils/rankcard");
class WebServer {
    constructor(logger, appRef, port = 3000) {
        this.logger = logger;
        this.appRef = appRef;
        this.port = port;
        this.app = (0, express_1.default)();
        this.app.use((0, cors_1.default)());
        this.app.use(express_1.default.json());
        this.app.use(express_1.default.urlencoded({ extended: true }));
        // Request logging — without this, API calls never appear in the console
        this.app.use((req, res, next) => {
            const start = Date.now();
            res.on('finish', () => {
                const status = res.statusCode;
                const msg = `${req.method} ${req.originalUrl} -> ${status} (${Date.now() - start}ms)`;
                if (status >= 400) {
                    this.logger.warn('Web Server', msg);
                }
                else {
                    this.logger.info('Web Server', msg);
                }
            });
            next();
        });
        this.app.use('/static', express_1.default.static(path_1.default.join(__dirname, 'public')));
        this.app.get('/', (_req, res) => {
            res.sendFile(path_1.default.join(__dirname, 'views', 'index.html'));
        });
        // Browsers request this automatically — 204 instead of a 404
        this.app.get('/favicon.ico', (_req, res) => {
            res.status(204).end();
        });
        this.setupRoutes();
    }
    setupRoutes() {
        // ---- Bot Status ----
        this.app.get('/api/status', (_req, res) => {
            try {
                const client = this.appRef.getClient?.();
                res.json({
                    online: !!client,
                    ready: client?.isReady?.() ?? false,
                    user: client?.user?.tag ?? null,
                    userId: client?.user?.id ?? null,
                    guilds: client?.guilds?.cache?.size ?? 0,
                    users: client?.users?.cache?.size ?? 0,
                    channels: client?.channels?.cache?.size ?? 0,
                    uptime: process.uptime(),
                    ping: client?.ws?.ping ?? 0,
                    latency: Date.now(),
                    memory: process.memoryUsage(),
                    platform: process.platform,
                    nodeVersion: process.version,
                    env: process.env.NODE_ENV ?? 'development',
                });
            }
            catch (err) {
                this.logger.error('Web Server', 'GET /api/status failed', err);
                res.json({
                    online: false,
                    ready: false,
                    user: null,
                    userId: null,
                    guilds: 0,
                    users: 0,
                    channels: 0,
                    uptime: process.uptime(),
                    ping: 0,
                    latency: Date.now(),
                    memory: process.memoryUsage(),
                    platform: process.platform,
                    nodeVersion: process.version,
                    env: process.env.NODE_ENV ?? 'development',
                });
            }
        });
        // ---- Bot Stats ----
        this.app.get('/api/stats', async (_req, res) => {
            try {
                const stats = await this.appRef.analytics.getStats?.();
                res.json(stats ?? {
                    totalGuilds: 0,
                    totalUsers: 0,
                    totalMessages: 0,
                    totalModerationCases: 0,
                    uptime: process.uptime(),
                });
            }
            catch (err) {
                this.logger.error('Web Server', 'GET /api/stats failed', err);
                res.status(500).json({ error: 'Failed to fetch stats' });
            }
        });
        // ---- Dashboard overview (single request for the landing page) ----
        this.app.get('/api/overview', async (_req, res) => {
            const client = this.appRef.getClient?.();
            const guildMap = client?.guilds?.cache ?? new Map();
            const guildList = [...guildMap.values()];
            const memory = process.memoryUsage();
            let stats = {};
            try {
                stats = (await this.appRef.analytics?.getStats?.()) ?? {};
            }
            catch (err) {
                this.logger.warn('Web Server', 'Overview stats unavailable', err);
            }
            const status = {
                online: !!client,
                ready: client?.isReady?.() ?? false,
                user: client?.user?.tag ?? null,
                displayName: client?.user?.globalName ?? client?.user?.username ?? null,
                userId: client?.user?.id ?? null,
                avatar: client?.user?.avatar ?? null,
                guilds: guildList.length,
                members: guildList.reduce((sum, g) => sum + (g.memberCount ?? 0), 0),
                users: client?.users?.cache?.size ?? 0,
                channels: client?.channels?.cache?.size ?? 0,
                uptime: process.uptime(),
                ping: client?.ws?.ping ?? 0,
                memory,
                platform: process.platform,
                nodeVersion: process.version,
                env: process.env.NODE_ENV ?? 'development',
            };
            const overview = {
                generatedAt: new Date().toISOString(),
                status,
                stats,
                economy: {
                    totalBalance: 0,
                    fundedUsers: 0,
                    trackedUsers: 0,
                    transactions: 0,
                    currency: this.appRef.economy?.config?.currencyName || 'coins',
                    recent: [],
                },
                topServers: guildList
                    .sort((a, b) => (b.memberCount ?? 0) - (a.memberCount ?? 0))
                    .slice(0, 6)
                    .map((g) => ({
                    id: g.id,
                    name: g.name,
                    icon: g.icon,
                    memberCount: g.memberCount ?? 0,
                    ownerId: g.ownerId ?? null,
                })),
                topMembers: [],
                recentCases: [],
                activity: { days: this.buildActivityDays() },
                logs: { warnings: 0, errors: 0, recent: [] },
            };
            const sqlite = this.sqliteOrNull();
            if (sqlite) {
                overview.economy = this.buildEconomyStats(sqlite);
                overview.topMembers = this.safeAll(sqlite, `SELECT u.id, u.username, u.avatar,
                  MAX(lp.level) AS level,
                  COALESCE(SUM(lp.total_xp), 0) AS total_xp,
                  COALESCE((SELECT SUM(balance) FROM economy_accounts WHERE user_id = u.id), 0) AS balance
           FROM users u
           LEFT JOIN leveling_profiles lp ON lp.user_id = u.id
           GROUP BY u.id
           HAVING total_xp > 0 OR balance > 0
           ORDER BY total_xp DESC, balance DESC
           LIMIT 6`).map((u) => ({
                    id: u.id,
                    username: u.username || `Member ${String(u.id).slice(0, 6)}`,
                    avatar: u.avatar ?? null,
                    level: Number(u.level ?? 1),
                    totalXp: Number(u.total_xp ?? 0),
                    balance: Number(u.balance ?? 0),
                }));
                overview.recentCases = this.safeAll(sqlite, `SELECT c.id, c.type, c.user_id, c.moderator_id, c.reason, c.created_at,
                  c.guild_id, u.username AS user_name, g.name AS guild_name
           FROM moderation_cases c
           LEFT JOIN users u ON u.id = c.user_id
           LEFT JOIN guilds g ON g.id = c.guild_id
           ORDER BY c.created_at DESC
           LIMIT 6`).map((c) => ({
                    id: c.id,
                    type: c.type,
                    userId: c.user_id,
                    username: c.user_name || `Member ${String(c.user_id ?? '').slice(0, 6)}`,
                    moderatorId: c.moderator_id,
                    guildId: c.guild_id,
                    guildName: c.guild_name || null,
                    reason: c.reason || 'No reason provided',
                    createdAt: this.toIso(c.created_at),
                }));
                if (overview.topServers.length === 0) {
                    overview.topServers = this.safeAll(sqlite, `SELECT id, name, icon, owner_id FROM guilds ORDER BY name LIMIT 6`).map((g) => ({
                        id: g.id,
                        name: g.name,
                        icon: g.icon,
                        memberCount: 0,
                        ownerId: g.owner_id ?? null,
                    }));
                }
                const days = overview.activity.days;
                const sinceMs = Date.now() - 6 * 86400000;
                this.bucketActivity(sqlite, 'messages', 'messages', days, sinceMs);
                this.bucketActivity(sqlite, 'moderation_cases', 'moderation', days, sinceMs);
                this.bucketActivity(sqlite, 'users', 'users', days, sinceMs);
            }
            try {
                const logs = this.appRef.logger?.getLogs?.() ?? [];
                overview.logs = {
                    warnings: logs.filter((l) => l.level === 'warn').length,
                    errors: logs.filter((l) => l.level === 'error').length,
                    recent: logs.slice(-12).reverse(),
                };
            }
            catch { /* logger is optional for the overview */ }
            res.json(overview);
        });
        // ---- Economy aggregate (used by the Economy page) ----
        this.app.get('/api/economy/stats', (_req, res) => {
            const sqlite = this.sqliteOrNull();
            if (!sqlite) {
                return res.json({
                    totalBalance: 0,
                    fundedUsers: 0,
                    trackedUsers: 0,
                    transactions: 0,
                    currency: this.appRef.economy?.config?.currencyName || 'coins',
                    recent: [],
                });
            }
            res.json(this.buildEconomyStats(sqlite));
        });
        // ---- Commands ----
        this.app.get('/api/commands', (_req, res) => {
            const commands = this.appRef.commands.getCommands?.() ?? [];
            const cmdArray = commands instanceof Map ? [...commands.values()] : Array.isArray(commands) ? commands : [];
            res.json(cmdArray.map((cmd) => ({
                name: cmd.data?.name ?? cmd.name ?? 'unknown',
                description: cmd.data?.description ?? cmd.description ?? '',
                category: cmd.category ?? 'General',
            })));
        });
        // ---- Guilds ----
        this.app.get('/api/guilds', (_req, res) => {
            try {
                const client = this.appRef.getClient?.();
                const guilds = client?.guilds?.cache ?? new Map();
                const list = [...guilds.values()].map((g) => ({
                    id: g.id,
                    name: g.name,
                    icon: g.icon,
                    memberCount: g.memberCount,
                    ownerId: g.ownerId,
                    features: g.features ?? [],
                    verificationLevel: g.verificationLevel,
                    preferredTier: g.premiumTier,
                    joinedAt: g.joinedAt?.toISOString?.() ?? null,
                }));
                res.json(list);
            }
            catch (err) {
                this.logger.error('Web Server', 'GET /api/guilds failed', err);
                res.json([]);
            }
        });
        this.app.get('/api/guilds/:guildId', (_req, res) => {
            try {
                const client = this.appRef.getClient?.();
                const guild = client?.guilds?.cache?.get(_req.params.guildId);
                if (!guild) {
                    return res.status(404).json({ error: 'Guild not found' });
                }
                res.json({
                    id: guild.id,
                    name: guild.name,
                    icon: guild.icon,
                    description: guild.description,
                    memberCount: guild.memberCount,
                    ownerId: guild.ownerId,
                    region: guild.region ?? 'unknown',
                    verificationLevel: guild.verificationLevel,
                    explicitContentFilter: guild.explicitContentFilter,
                    preferredTier: guild.premiumTier,
                    features: guild.features ?? [],
                    channels: [...guild.channels.cache.values()].map((c) => ({
                        id: c.id,
                        name: c.name,
                        type: c.type,
                        position: c.position,
                        nsfw: c.nsfw ?? false,
                        parentId: c.parentId ?? null,
                        topic: c.topic ?? null,
                        bitrate: c.bitrate ?? null,
                        userLimit: c.userLimit ?? null,
                        rateLimitPerUser: c.rateLimitPerUser ?? null,
                    })),
                    roles: [...guild.roles.cache.values()].map((r) => ({
                        id: r.id,
                        name: r.name,
                        color: r.color,
                        position: r.position,
                        hoist: r.hoist,
                        mentionable: r.mentionable,
                        managed: r.managed,
                        permissions: r.permissions.bitfield?.toString?.() ?? '0',
                    })),
                });
            }
            catch (err) {
                res.status(404).json({ error: 'Guild not found' });
            }
        });
        this.app.get('/api/guilds/:guildId/members', (_req, res) => {
            const client = this.appRef.getClient?.();
            const guild = client?.guilds?.cache?.get(_req.params.guildId);
            if (!guild) {
                return res.status(404).json({ error: 'Guild not found' });
            }
            const members = [...guild.members.cache.values()].map((m) => ({
                id: m.id,
                user: {
                    id: m.user.id,
                    username: m.user.username,
                    discriminator: m.user.discriminator,
                    tag: m.user.tag,
                    avatar: m.user.avatar,
                    bot: m.user.bot,
                },
                nickname: m.nickname,
                roles: [...m.roles.cache.values()].map((r) => r.id),
                joinedAt: m.joinedAt?.toISOString?.() ?? null,
                premiumSince: m.premiumSince?.toISOString?.() ?? null,
                pending: m.pending ?? false,
            }));
            res.json(members);
        });
        // ---- Channels ----
        this.app.get('/api/guilds/:guildId/channels', (_req, res) => {
            const client = this.appRef.getClient?.();
            const guild = client?.guilds?.cache?.get(_req.params.guildId);
            if (!guild) {
                return res.status(404).json({ error: 'Guild not found' });
            }
            res.json([...guild.channels.cache.values()].map((c) => ({
                id: c.id,
                name: c.name,
                type: c.type,
                position: c.position,
                nsfw: c.nsfw ?? false,
                parentId: c.parentId ?? null,
                topic: c.topic ?? null,
                bitrate: c.bitrate ?? null,
                userLimit: c.userLimit ?? null,
                rateLimitPerUser: c.rateLimitPerUser ?? null,
            })));
        });
        // ---- Moderation ----
        this.app.get('/api/moderation/cases', async (_req, res) => {
            try {
                const guildId = _req.query.guildId;
                const cases = await this.appRef.moderation.getCases?.(guildId ?? '') ?? [];
                res.json(cases);
            }
            catch (err) {
                res.status(500).json({ error: 'Failed to fetch moderation cases' });
            }
        });
        this.app.post('/api/moderation/warn', async (req, res) => {
            try {
                const { guildId, userId, moderatorId, reason } = req.body;
                const caseId = await this.appRef.moderation.warn?.(guildId, userId, moderatorId, reason ?? '');
                res.json({ success: true, caseId });
            }
            catch (err) {
                res.status(500).json({ error: err.message || 'Failed to warn user' });
            }
        });
        this.app.post('/api/moderation/kick', async (req, res) => {
            try {
                const { guildId, userId, moderatorId, reason } = req.body;
                const caseId = await this.appRef.moderation.kick?.(guildId, userId, moderatorId, reason ?? '');
                res.json({ success: true, caseId });
            }
            catch (err) {
                res.status(500).json({ error: err.message || 'Failed to kick user' });
            }
        });
        this.app.post('/api/moderation/ban', async (req, res) => {
            try {
                const { guildId, userId, moderatorId, reason, deleteMessageDays } = req.body;
                const caseId = await this.appRef.moderation.ban?.(guildId, userId, moderatorId, reason ?? '', deleteMessageDays ?? 0);
                res.json({ success: true, caseId });
            }
            catch (err) {
                res.status(500).json({ error: err.message || 'Failed to ban user' });
            }
        });
        this.app.post('/api/moderation/mute', async (req, res) => {
            try {
                const { guildId, userId, moderatorId, reason, durationMinutes } = req.body;
                const caseId = await this.appRef.moderation.mute?.(guildId, userId, moderatorId, reason ?? '', durationMinutes ?? 60);
                res.json({ success: true, caseId });
            }
            catch (err) {
                res.status(500).json({ error: err.message || 'Failed to mute user' });
            }
        });
        // ---- Economy ----
        this.app.get('/api/economy/balance/:userId', async (req, res) => {
            try {
                const balance = await this.appRef.economy.getBalance(req.params.userId);
                res.json({ userId: req.params.userId, balance });
            }
            catch (err) {
                res.status(500).json({ error: 'Failed to fetch balance' });
            }
        });
        this.app.post('/api/economy/set-balance', async (req, res) => {
            try {
                const { userId, balance } = req.body;
                const current = await this.appRef.economy.getBalance(userId);
                if (balance > current) {
                    await this.appRef.economy.addBalance(userId, balance - current);
                }
                else if (balance < current) {
                    await this.appRef.economy.removeBalance(userId, current - balance);
                }
                const newBalance = await this.appRef.economy.getBalance(userId);
                res.json({ success: true, userId, balance: newBalance });
            }
            catch (err) {
                res.status(500).json({ error: err.message || 'Failed to set balance' });
            }
        });
        // ---- Leveling ----
        this.app.get('/api/leveling/level/:userId', async (req, res) => {
            try {
                const guildId = req.query.guildId;
                const data = await this.appRef.leveling.getLevel?.(guildId ?? '', req.params.userId);
                if (!data) {
                    return res.status(404).json({ error: 'No leveling data found' });
                }
                res.json(data);
            }
            catch (err) {
                res.status(500).json({ error: 'Failed to fetch level data' });
            }
        });
        this.app.get('/api/leveling/leaderboard', async (_req, res) => {
            try {
                const guildId = _req.query.guildId;
                const limit = parseInt(_req.query.limit) || 20;
                const leaderboard = await this.appRef.leveling.getLeaderboard?.(guildId ?? '', limit) ?? [];
                res.json(leaderboard);
            }
            catch (err) {
                res.status(500).json({ error: 'Failed to fetch leaderboard' });
            }
        });
        this.app.post('/api/leveling/set-xp', async (req, res) => {
            try {
                const { guildId, userId, xp } = req.body;
                if (!userId) {
                    return res.status(400).json({ error: 'userId is required' });
                }
                const amount = Number(xp);
                if (!Number.isFinite(amount) || amount < 0) {
                    return res.status(400).json({ error: 'xp must be a non-negative number' });
                }
                const result = await this.appRef.leveling.setXP?.(guildId ?? '', userId, amount);
                if (!result) {
                    return res.status(500).json({ error: 'Leveling service unavailable' });
                }
                res.json({ success: true, userId, xp: result.totalXP, level: result.level });
            }
            catch (err) {
                res.status(500).json({ error: err.message || 'Failed to set XP' });
            }
        });
        // ---- Guild Settings (module toggles) ----
        // Must be registered BEFORE the generic /api/config/:service routes below.
        this.app.get('/api/config/guild_settings', async (req, res) => {
            try {
                const guildId = this.resolveGuildId(req.query.guildId);
                const settings = await this.readGuildSettings(guildId);
                res.json(settings ?? this.defaultGuildSettings(guildId));
            }
            catch (err) {
                this.logger.error('Web Server', 'GET guild_settings failed', err);
                res.json(this.defaultGuildSettings(this.resolveGuildId()));
            }
        });
        this.app.post('/api/config/guild_settings', async (req, res) => {
            try {
                const body = req.body ?? {};
                const guildId = this.resolveGuildId(body.guildId);
                const saved = await this.writeGuildSettings(guildId, body);
                this.applyModuleToggles(saved);
                res.json({ success: true, config: saved });
            }
            catch (err) {
                this.logger.error('Web Server', 'POST guild_settings failed', err);
                res.status(500).json({ error: err.message || 'Failed to save module settings' });
            }
        });
        // ---- Config ----
        this.app.get('/api/config/:service', (_req, res) => {
            const service = _req.params.service;
            if (!WebServer.CONFIG_SERVICES.includes(service)) {
                return res.status(404).json({ error: `Unknown service: ${service}` });
            }
            try {
                const cfg = this.getServiceConfig(service);
                res.json(cfg ?? {});
            }
            catch (err) {
                this.logger.error('Web Server', `GET /api/config/${service} failed`, err);
                res.status(500).json({ error: `Failed to fetch ${service} config` });
            }
        });
        this.app.post('/api/config/:service', (req, res) => {
            const service = req.params.service;
            if (!WebServer.CONFIG_SERVICES.includes(service)) {
                return res.status(404).json({ error: `Unknown service: ${service}` });
            }
            try {
                const config = req.body ?? {};
                this.setServiceConfig(service, config);
                res.json({ success: true, config: this.getServiceConfig(service) ?? {} });
            }
            catch (err) {
                this.logger.error('Web Server', `POST /api/config/${service} failed`, err);
                res.status(500).json({ error: err.message || `Failed to update ${service} config` });
            }
        });
        // ---- Cards: welcome + rank templates (web editor) ----
        // Dedicated routes before the generic /api/config/:service fallback.
        // GET returns the live templates; preview renders server-side PNG and
        // returns it as base64 so the browser editor can show it live.
        this.app.get('/api/cards/config', (_req, res) => {
            try {
                const cfg = this.appRef.cards?.getConfig?.() ?? (0, CardTemplates_1.getDefaultCardConfig)();
                res.json(cfg);
            }
            catch (err) {
                res.status(500).json({ error: 'Failed to fetch card config' });
            }
        });
        this.app.put('/api/cards/config', (req, res) => {
            try {
                const saved = this.appRef.cards?.setConfig?.(req.body ?? {}) ?? (0, CardTemplates_1.getDefaultCardConfig)();
                this.persistServiceConfig('cards');
                res.json({ success: true, config: saved });
            }
            catch (err) {
                res.status(500).json({ error: err.message || 'Failed to save card config' });
            }
        });
        this.app.post('/api/cards/preview', async (req, res) => {
            try {
                const { type, template, sample } = req.body ?? {};
                const base = this.appRef.cards?.getConfig?.() ?? (0, CardTemplates_1.getDefaultCardConfig)();
                const merged = { ...base, ...(template ?? {}) };
                if (type === 'welcome') {
                    const s = sample ?? {};
                    const buffer = await welcomecard_1.welcomeCard.generate({
                        avatarUrl: s.avatarUrl || 'https://cdn.discordapp.com/embed/avatars/0.png',
                        displayName: s.displayName || 'TestUser',
                        guildName: s.guildName || 'Test Server',
                        memberCount: s.memberCount ?? 42,
                        welcomeMessage: s.welcomeMessage || 'Welcome {username} to {server}!',
                        template: merged.welcome,
                    });
                    res.set('Content-Type', 'image/png');
                    res.send(buffer);
                    return;
                }
                if (type === 'rank') {
                    const s = sample ?? {};
                    const buffer = await rankcard_1.rankCard.generate({
                        avatarUrl: s.avatarUrl || 'https://cdn.discordapp.com/embed/avatars/0.png',
                        username: s.username || 'TestUser',
                        level: s.level ?? 12,
                        rank: s.rank ?? 3,
                        totalRanked: s.totalRanked ?? 128,
                        xpIntoLevel: s.xpIntoLevel ?? 720,
                        xpNeeded: s.xpNeeded ?? 1100,
                        totalXp: s.totalXp ?? 4675,
                        guildName: s.guildName || 'Test Server',
                        template: merged.rank,
                    });
                    res.set('Content-Type', 'image/png');
                    res.send(buffer);
                    return;
                }
                if (type === 'leaderboard') {
                    const rows = (sample?.rows ?? [
                        { userId: '1', username: 'Alpha', avatarUrl: 'https://cdn.discordapp.com/embed/avatars/0.png', level: 24, totalXp: 12000 },
                        { userId: '2', username: 'Beta', avatarUrl: 'https://cdn.discordapp.com/embed/avatars/1.png', level: 21, totalXp: 9800 },
                        { userId: '3', username: 'Gamma', avatarUrl: 'https://cdn.discordapp.com/embed/avatars/2.png', level: 19, totalXp: 8400 },
                    ]);
                    const buffer = await rankcard_1.leaderboardCard.generate(rows, sample?.guildName || 'Test Server', '🏆 Top members', merged.leaderboard);
                    res.set('Content-Type', 'image/png');
                    res.send(buffer);
                    return;
                }
                res.status(400).json({ error: 'type must be welcome | rank | leaderboard' });
            }
            catch (err) {
                this.logger.error('Web Server', 'POST /api/cards/preview failed', err);
                res.status(500).json({ error: err.message || 'Preview failed' });
            }
        });
        this.app.post('/api/cards/test', async (req, res) => {
            try {
                const { type, channelId } = req.body ?? {};
                const client = this.appRef.getClient?.();
                if (!client?.isReady?.()) {
                    return res.status(400).json({ error: 'Discord client not ready — cannot send test yet.' });
                }
                const targetChannelId = channelId || this.appRef.community?.getConfig?.()?.welcome?.channel;
                if (!targetChannelId) {
                    return res.status(400).json({ error: 'No channel configured. Pass channelId or set a welcome channel first.' });
                }
                const channel = await client.channels.fetch(targetChannelId).catch(() => null);
                if (!channel || !('send' in channel)) {
                    return res.status(404).json({ error: 'Channel not found or not writable.' });
                }
                const { AttachmentBuilder } = require('discord.js');
                const base = this.appRef.cards?.getConfig?.() ?? (0, CardTemplates_1.getDefaultCardConfig)();
                if (type === 'welcome') {
                    const buffer = await welcomecard_1.welcomeCard.generate({
                        avatarUrl: client.user?.displayAvatarURL?.({ extension: 'png', size: 256 }) || 'https://cdn.discordapp.com/embed/avatars/0.png',
                        displayName: client.user?.username || 'TestUser',
                        guildName: channel.guild?.name || 'Test Server',
                        memberCount: channel.guild?.memberCount ?? 42,
                        welcomeMessage: req.body?.welcomeMessage || 'Welcome {username} to {server}! 🎉',
                        template: base.welcome,
                    });
                    await channel.send({ files: [new AttachmentBuilder(buffer, { name: 'welcome.png' })] });
                    res.json({ success: true, channelId: targetChannelId });
                    return;
                }
                if (type === 'rank') {
                    const buffer = await rankcard_1.rankCard.generate({
                        avatarUrl: client.user?.displayAvatarURL?.({ extension: 'png', size: 256 }) || 'https://cdn.discordapp.com/embed/avatars/0.png',
                        username: client.user?.username || 'TestUser',
                        level: 12,
                        rank: 3,
                        totalRanked: 128,
                        xpIntoLevel: 720,
                        xpNeeded: 1100,
                        totalXp: 4675,
                        guildName: channel.guild?.name || 'Test Server',
                        template: base.rank,
                    });
                    await channel.send({ files: [new AttachmentBuilder(buffer, { name: 'rank.png' })] });
                    res.json({ success: true, channelId: targetChannelId });
                    return;
                }
                res.status(400).json({ error: 'type must be welcome | rank' });
            }
            catch (err) {
                res.status(500).json({ error: err.message || 'Test send failed' });
            }
        });
        // ---- Community (welcome/goodbye) ----
        this.app.get('/api/config/community', (_req, res) => {
            try {
                const cfg = this.appRef.community?.getConfig?.() ?? null;
                res.json(cfg ?? {});
            }
            catch (err) {
                res.status(500).json({ error: 'Failed to fetch community config' });
            }
        });
        this.app.post('/api/config/community', (req, res) => {
            try {
                const current = this.appRef.community?.getConfig?.();
                if (!current)
                    return res.status(404).json({ error: 'Community service not available' });
                const incoming = req.body ?? {};
                // Merge welcome/goodbye/autoroles safely (only known keys)
                for (const section of ['welcome', 'goodbye', 'autoroles']) {
                    if (incoming[section] && typeof incoming[section] === 'object') {
                        for (const k of Object.keys(incoming[section])) {
                            if (k in current[section]) {
                                const prev = current[section][k];
                                const val = incoming[section][k];
                                if (typeof prev === 'boolean')
                                    current[section][k] = Boolean(val);
                                else if (typeof prev === 'string')
                                    current[section][k] = String(val ?? '');
                                else
                                    current[section][k] = val;
                            }
                        }
                    }
                }
                this.appRef.community.setConfig(current);
                this.persistServiceConfig('community');
                res.json({ success: true, config: current });
            }
            catch (err) {
                res.status(500).json({ error: err.message || 'Failed to update community config' });
            }
        });
        // ---- Logs ----
        this.app.get('/api/logs', (_req, res) => {
            const level = _req.query.level;
            const limit = parseInt(_req.query.limit) || 100;
            res.json(this.appRef.logger.getLogs?.(level, limit) ?? []);
        });
        this.app.delete('/api/logs', (_req, res) => {
            this.appRef.logger.clearLogs?.();
            res.json({ success: true });
        });
        // ---- System / Server ----
        this.app.get('/api/system/info', (_req, res) => {
            const cpus = os_1.default.cpus();
            const totalMem = os_1.default.totalmem();
            const freeMem = os_1.default.freemem();
            res.json({
                platform: process.platform,
                arch: process.arch,
                nodeVersion: process.version,
                uptime: process.uptime(),
                pid: process.pid,
                cwd: process.cwd(),
                env: process.env.NODE_ENV ?? 'development',
                cpuCount: cpus.length,
                cpuModel: cpus[0]?.model ?? 'unknown',
                cpuSpeed: cpus[0]?.speed ?? 0,
                totalMemory: totalMem,
                freeMemory: freeMem,
                usedMemory: totalMem - freeMem,
                loadavg: os_1.default.loadavg(),
                networkInterfaces: os_1.default.networkInterfaces(),
            });
        });
        this.app.get('/api/system/processes', (_req, res) => {
            res.json({
                pid: process.pid,
                ppid: process.ppid,
                title: process.title,
                version: process.version,
                arch: process.arch,
                platform: process.platform,
                memoryUsage: process.memoryUsage(),
                cpuUsage: process.cpuUsage(),
                uptime: process.uptime(),
                argv: process.argv,
                envKeys: Object.keys(process.env),
            });
        });
        // ---- Control ----
        this.app.post('/api/control/restart', (_req, res) => {
            res.json({ success: true, message: 'Restarting...' });
            setTimeout(() => {
                process.exit(0);
            }, 1000);
        });
        this.app.post('/api/control/shutdown', (_req, res) => {
            res.json({ success: true, message: 'Shutting down...' });
            setTimeout(() => {
                process.exit(0);
            }, 1000);
        });
        this.app.post('/api/control/reload-commands', (_req, res) => {
            try {
                this.appRef.commands.reloadCommands?.();
                res.json({ success: true, message: 'Commands reloaded' });
            }
            catch (err) {
                res.status(500).json({ error: err.message || 'Failed to reload commands' });
            }
        });
        this.app.post('/api/control/presence', (req, res) => {
            try {
                const { status, activityName, activityType } = req.body;
                const client = this.appRef.getClient?.();
                if (!client) {
                    return res.status(400).json({ error: 'Discord client not ready' });
                }
                client.user?.setPresence?.({
                    status: status || 'online',
                    activities: activityName ? [{ name: activityName, type: activityType || 0 }] : [],
                });
                res.json({ success: true, presence: { status, activityName, activityType } });
            }
            catch (err) {
                res.status(500).json({ error: err.message || 'Failed to set presence' });
            }
        });
        // ---- Fallbacks (must be last) ----
        // JSON 404 for unknown API routes instead of Express' default HTML page
        this.app.use('/api', (_req, res) => {
            this.logger.warn('Web Server', `Unknown API route: ${_req.method} ${_req.originalUrl}`);
            res.status(404).json({ error: 'Not found' });
        });
        // Error handler — log it so failures are visible in the console
        this.app.use((err, _req, res, _next) => {
            this.logger.error('Web Server', `Unhandled error: ${err?.message}`, err);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Internal server error' });
            }
        });
    }
    /** Raw sqlite handle when the database has finished initialising, else null. */
    sqliteOrNull() {
        try {
            return this.appRef.database?.getSqlite?.() ?? null;
        }
        catch {
            return null;
        }
    }
    safeAll(sqlite, sql, params = []) {
        try {
            return sqlite.prepare(sql).all(...params) ?? [];
        }
        catch (err) {
            this.logger.warn('Web Server', `Query failed: ${err.message}`);
            return [];
        }
    }
    safeGet(sqlite, sql, params = []) {
        try {
            return sqlite.prepare(sql).get(...params) ?? null;
        }
        catch {
            return null;
        }
    }
    /** Convert a stored timestamp (seconds or milliseconds) to ISO. */
    toIso(value) {
        const n = Number(value ?? 0);
        if (!Number.isFinite(n) || n <= 0)
            return null;
        const ms = n > 1_000_000_000_000 ? n : n * 1000;
        const date = new Date(ms);
        return Number.isNaN(date.getTime()) ? null : date.toISOString();
    }
    buildActivityDays(days = 7) {
        const buckets = [];
        const now = new Date();
        const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
        for (let i = days - 1; i >= 0; i--) {
            const date = new Date(todayUtc - i * 86400000);
            buckets.push({
                date: date.toISOString().slice(0, 10),
                label: date.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }),
                messages: 0,
                moderation: 0,
                users: 0,
            });
        }
        return buckets;
    }
    bucketActivity(sqlite, table, key, buckets, sinceMs) {
        const maxRow = this.safeGet(sqlite, `SELECT MAX(created_at) AS m FROM ${table}`);
        const max = Number(maxRow?.m ?? 0);
        const storedInMs = max > 1_000_000_000_000;
        const threshold = Math.floor(storedInMs ? sinceMs : sinceMs / 1000);
        const rows = this.safeAll(sqlite, `SELECT created_at FROM ${table} WHERE created_at >= ?`, [threshold]);
        const byDate = new Map(buckets.map((b) => [b.date, b]));
        for (const row of rows) {
            const iso = this.toIso(row.created_at);
            if (!iso)
                continue;
            const bucket = byDate.get(iso.slice(0, 10));
            if (bucket)
                bucket[key] += 1;
        }
    }
    buildEconomyStats(sqlite) {
        const totals = this.safeGet(sqlite, `SELECT COALESCE(SUM(balance), 0) AS total,
              SUM(CASE WHEN balance > 0 THEN 1 ELSE 0 END) AS funded,
              COUNT(*) AS tracked
       FROM economy_accounts`) ?? {};
        const txn = this.safeGet(sqlite, `SELECT COUNT(*) AS c FROM economy_transactions`) ?? {};
        const recent = this.safeAll(sqlite, `SELECT t.id, t.user_id, t.type, t.amount, t.description, t.created_at,
              u.username AS user_name
       FROM economy_transactions t
       LEFT JOIN users u ON u.id = t.user_id
       ORDER BY t.created_at DESC
       LIMIT 8`).map((t) => ({
            id: t.id,
            userId: t.user_id,
            username: t.user_name || `Member ${String(t.user_id ?? '').slice(0, 6)}`,
            type: t.type,
            amount: Number(t.amount ?? 0),
            description: t.description || null,
            createdAt: this.toIso(t.created_at),
        }));
        return {
            totalBalance: Number(totals.total ?? 0),
            fundedUsers: Number(totals.funded ?? 0),
            trackedUsers: Number(totals.tracked ?? 0),
            transactions: Number(txn.c ?? 0),
            currency: this.appRef.economy?.config?.currencyName || 'coins',
            recent,
        };
    }
    /** Raw (unmasked) config object for a service, or null if unavailable. */
    rawServiceConfig(service) {
        const app = this.appRef;
        switch (service) {
            case 'bot':
                return { prefix: app.config?.commands?.prefix ?? '!' };
            case 'leveling':
                return app.leveling?.config ?? null;
            case 'ai':
                return app.ai?.config ?? null;
            case 'music':
                return app.music?.getConfig?.() ?? null;
            case 'tempvc':
                return app.tempvc?.getConfig?.() ?? null;
            case 'moderation':
                return app.moderation?.config ?? null;
            case 'economy':
                return app.economy?.config ?? null;
            case 'automation':
                return app.automation?.config ?? null;
            case 'analytics':
                return app.analytics?.config ?? null;
            case 'web':
                return { port: this.port };
            case 'cards':
                return app.cards?.getConfig?.() ?? (0, CardTemplates_1.getDefaultCardConfig)();
            case 'community':
                return app.community?.getConfig?.() ?? null;
            case 'tickets':
                return app.tickets?.getConfig?.() ?? null;
            case 'staffapps':
                return app.staffapps?.getConfig?.() ?? null;
            default:
                return null;
        }
    }
    /** Config as exposed over HTTP: secrets are redacted, replaced with has* flags. */
    getServiceConfig(service) {
        const raw = this.rawServiceConfig(service);
        if (raw === null || raw === undefined)
            return null;
        const copy = { ...raw };
        if (service === 'ai' && 'apiKey' in copy) {
            copy.hasApiKey = !!copy.apiKey;
            delete copy.apiKey;
        }
        if (service === 'music' && 'lavalinkPassword' in copy) {
            copy.hasLavalinkPassword = !!copy.lavalinkPassword;
            delete copy.lavalinkPassword;
        }
        return copy;
    }
    /**
     * Deep-merge `source` into `target`.
     * Only keys that already exist on the target are applied (junk keys ignored),
     * nested plain objects merge recursively, and values are coerced to the
     * type of the existing value (boolean/number/string/array).
     */
    deepAssignConfig(target, source) {
        if (!target || typeof target !== 'object' || !source || typeof source !== 'object' || Array.isArray(source))
            return;
        for (const key of Object.keys(source)) {
            if (!(key in target))
                continue;
            const current = target[key];
            const incoming = source[key];
            if (current && typeof current === 'object' && !Array.isArray(current)) {
                if (incoming && typeof incoming === 'object' && !Array.isArray(incoming)) {
                    this.deepAssignConfig(current, incoming);
                }
            }
            else if (Array.isArray(current)) {
                if (Array.isArray(incoming))
                    target[key] = incoming;
            }
            else if (typeof current === 'boolean') {
                target[key] = Boolean(incoming);
            }
            else if (typeof current === 'number') {
                const n = Number(incoming);
                if (Number.isFinite(n))
                    target[key] = n;
            }
            else if (typeof current === 'string') {
                target[key] = String(incoming ?? '');
            }
            else if (current === null) {
                target[key] = incoming;
            }
        }
    }
    setServiceConfig(service, incoming) {
        const app = this.appRef;
        switch (service) {
            case 'bot': {
                const target = { prefix: app.config?.commands?.prefix ?? '!' };
                this.deepAssignConfig(target, incoming);
                if (app.config?.commands)
                    app.config.commands.prefix = target.prefix;
                break;
            }
            case 'tempvc': {
                const base = app.tempvc?.getConfig?.() ?? { enabled: true, createChannelId: '', categoryId: '', panelChannelId: '', panelMessageId: '' };
                const next = { ...base };
                this.deepAssignConfig(next, incoming);
                app.tempvc?.setConfig?.(next);
                break;
            }
            case 'music': {
                // MusicService stores config internally — merge through its setter
                const next = { ...(app.music?.getConfig?.() ?? {}) };
                this.deepAssignConfig(next, incoming);
                app.music?.setConfig?.(next);
                break;
            }
            case 'cards': {
                const current = app.cards?.getConfig?.() ?? (0, CardTemplates_1.getDefaultCardConfig)();
                const next = JSON.parse(JSON.stringify(current));
                this.deepAssignConfig(next, incoming);
                app.cards?.setConfig?.(next);
                break;
            }
            case 'community': {
                const current = app.community?.getConfig?.();
                if (!current)
                    throw new Error('community config is not available');
                for (const section of ['welcome', 'goodbye', 'autoroles']) {
                    if (incoming[section] && typeof incoming[section] === 'object') {
                        for (const k of Object.keys(incoming[section])) {
                            if (k in current[section]) {
                                const prev = current[section][k];
                                const val = incoming[section][k];
                                if (typeof prev === 'boolean')
                                    current[section][k] = Boolean(val);
                                else if (typeof prev === 'number') {
                                    const n = Number(val);
                                    if (Number.isFinite(n))
                                        current[section][k] = n;
                                }
                                else if (typeof prev === 'string')
                                    current[section][k] = String(val ?? '');
                                else
                                    current[section][k] = val;
                            }
                        }
                    }
                }
                app.community.setConfig(current);
                break;
            }
            case 'web':
                // The live port is bound by the host (SERVER_PORT) and can't change
                // without a restart — the value is only persisted for reference.
                break;
            case 'tickets': {
                const current = app.tickets?.getConfig?.() ?? { enabled: true, category: '', supportRoles: [], closeVote: false };
                const next = JSON.parse(JSON.stringify(current));
                this.deepAssignConfig(next, incoming);
                app.tickets?.setConfig?.(next);
                break;
            }
            case 'staffapps': {
                app.staffapps?.setConfig?.(incoming);
                break;
            }
            case 'leveling':
            case 'ai':
            case 'moderation':
            case 'economy':
            case 'automation':
            case 'analytics': {
                const target = app[service]?.config;
                if (!target)
                    throw new Error(`${service} config is not available`);
                this.deepAssignConfig(target, incoming);
                if (service === 'leveling' && typeof app.leveling?.refreshLegacyAliases === 'function') {
                    app.leveling.refreshLegacyAliases();
                }
                break;
            }
            default:
                throw new Error(`Unknown service: ${service}`);
        }
        this.persistServiceConfig(service);
    }
    getServiceConfigsDb() {
        try {
            return this.appRef.database?.getSqlite?.() ?? null;
        }
        catch {
            return null;
        }
    }
    /** Persist the raw (unmasked) config into `service_configs` so it survives restarts. */
    persistServiceConfig(service) {
        try {
            const sqlite = this.getServiceConfigsDb();
            if (!sqlite)
                return;
            const raw = this.rawServiceConfig(service);
            if (!raw)
                return;
            sqlite.prepare(`INSERT INTO service_configs (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).run(service, JSON.stringify(raw), Date.now());
        }
        catch (err) {
            this.logger.warn('Web Server', `Could not persist ${service} config: ${err.message}`);
        }
    }
    /**
     * Apply dashboard-persisted config overrides on top of the env defaults.
     * Called from SukunaApp.initialize() after the database is ready.
     */
    async loadPersistedConfigs() {
        try {
            const sqlite = this.getServiceConfigsDb();
            if (!sqlite) {
                this.logger.warn('Web Server', 'Skipping persisted config load: database not ready');
                return;
            }
            const rows = sqlite.prepare('SELECT key, value FROM service_configs').all();
            let applied = 0;
            for (const row of rows) {
                try {
                    const saved = JSON.parse(row.value);
                    if (!saved || typeof saved !== 'object' || Array.isArray(saved))
                        continue;
                    if (row.key === 'tempvc') {
                        const app = this.appRef;
                        const base = app.tempvc?.getConfig?.() ?? { enabled: true, createChannelId: '', categoryId: '', panelChannelId: '', panelMessageId: '' };
                        const next = { ...base };
                        this.deepAssignConfig(next, saved);
                        app.tempvc?.setConfig?.(next);
                    }
                    else if (row.key === 'bot') {
                        const app = this.appRef;
                        if (app.config?.commands && saved.prefix)
                            app.config.commands.prefix = saved.prefix;
                    }
                    else if (row.key === 'web') {
                        continue; // live port stays host-bound (SERVER_PORT)
                    }
                    else if (row.key === 'cards') {
                        const app = this.appRef;
                        const current = app.cards?.getConfig?.() ?? (0, CardTemplates_1.getDefaultCardConfig)();
                        const next = JSON.parse(JSON.stringify(current));
                        this.deepAssignConfig(next, saved);
                        app.cards?.setConfig?.(next);
                    }
                    else if (row.key === 'community') {
                        const app = this.appRef;
                        const current = app.community?.getConfig?.();
                        if (current) {
                            for (const section of ['welcome', 'goodbye', 'autoroles']) {
                                if (saved[section] && typeof saved[section] === 'object') {
                                    for (const k of Object.keys(saved[section])) {
                                        if (k in current[section]) {
                                            const prev = current[section][k];
                                            const val = saved[section][k];
                                            if (typeof prev === 'boolean')
                                                current[section][k] = Boolean(val);
                                            else if (typeof prev === 'number') {
                                                const n = Number(val);
                                                if (Number.isFinite(n))
                                                    current[section][k] = n;
                                            }
                                            else if (typeof prev === 'string')
                                                current[section][k] = String(val ?? '');
                                            else
                                                current[section][k] = val;
                                        }
                                    }
                                }
                            }
                            app.community.setConfig(current);
                        }
                    }
                    else if (row.key === 'tickets') {
                        const app = this.appRef;
                        const current = app.tickets?.getConfig?.() ?? { enabled: true, category: '', supportRoles: [], closeVote: false };
                        const next = JSON.parse(JSON.stringify(current));
                        this.deepAssignConfig(next, saved);
                        app.tickets?.setConfig?.(next);
                    }
                    else if (row.key === 'staffapps') {
                        const app = this.appRef;
                        app.staffapps?.setConfig?.(saved);
                    }
                    else {
                        const target = this.appRef?.[row.key]?.config;
                        if (!target)
                            continue;
                        this.deepAssignConfig(target, saved);
                        if (row.key === 'leveling' && typeof this.appRef.leveling?.refreshLegacyAliases === 'function') {
                            this.appRef.leveling.refreshLegacyAliases();
                        }
                    }
                    applied++;
                }
                catch (err) {
                    this.logger.warn('Web Server', `Skipping invalid persisted config '${row.key}': ${err.message}`);
                }
            }
            if (applied)
                this.logger.info('Web Server', `Applied ${applied} persisted service config(s) from database`);
        }
        catch (err) {
            this.logger.error('Web Server', 'Failed to load persisted configs', err);
        }
    }
    resolveGuildId(explicit) {
        if (explicit)
            return explicit;
        try {
            const client = this.appRef.getClient?.();
            const firstGuild = client?.guilds?.cache?.first?.();
            if (firstGuild)
                return firstGuild.id;
        }
        catch {
            // Discord client not ready yet — fall through to the default bucket
        }
        return 'global';
    }
    defaultGuildSettings(guildId) {
        // Mirrors the guild_settings table defaults
        return {
            guild_id: guildId,
            leveling_enabled: true,
            moderation_enabled: true,
            ai_enabled: false,
            music_enabled: false,
            economy_enabled: false,
            welcome_enabled: false,
            goodbye_enabled: false,
            autoroles_enabled: false,
        };
    }
    async readGuildSettings(guildId) {
        try {
            const db = this.appRef.database?.getDb?.();
            if (!db)
                return null;
            const rows = await db.select().from(schema_1.guildSettings).where((0, drizzle_orm_1.eq)(schema_1.guildSettings.guild_id, guildId));
            return rows?.[0] ?? null;
        }
        catch (err) {
            this.logger.warn('Web Server', `Could not read guild_settings for ${guildId}: ${err.message}`);
            return null;
        }
    }
    async writeGuildSettings(guildId, body) {
        const allowed = [
            'leveling_enabled', 'ai_enabled', 'music_enabled', 'economy_enabled',
            'moderation_enabled', 'welcome_enabled', 'welcome_channel_id', 'welcome_message',
            'goodbye_enabled', 'goodbye_channel_id', 'goodbye_message', 'autoroles_enabled', 'autorole_ids',
        ];
        const data = {};
        for (const key of allowed) {
            if (body[key] !== undefined)
                data[key] = body[key];
        }
        const now = new Date();
        let persisted = false;
        try {
            const db = this.appRef.database?.getDb?.();
            if (db) {
                const existing = await db.select().from(schema_1.guildSettings).where((0, drizzle_orm_1.eq)(schema_1.guildSettings.guild_id, guildId));
                if (existing?.length) {
                    await db.update(schema_1.guildSettings).set({ ...data, updated_at: now }).where((0, drizzle_orm_1.eq)(schema_1.guildSettings.guild_id, guildId));
                }
                else {
                    await db.insert(schema_1.guildSettings).values({ guild_id: guildId, ...data, created_at: now, updated_at: now });
                }
                persisted = true;
            }
        }
        catch (err) {
            // Don't 500 the dashboard save if the DB is unavailable — log and continue
            this.logger.warn('Web Server', `Could not persist guild_settings for ${guildId}: ${err.message}`);
        }
        const current = persisted ? await this.readGuildSettings(guildId) : null;
        return { ...this.defaultGuildSettings(guildId), ...data, ...(current ?? {}) };
    }
    applyModuleToggles(settings) {
        const app = this.appRef;
        try {
            if (settings.leveling_enabled !== undefined && app.leveling?.config) {
                app.leveling.config.enabled = !!settings.leveling_enabled;
            }
            if (settings.ai_enabled !== undefined && app.ai?.config) {
                app.ai.config.enabled = !!settings.ai_enabled;
            }
        }
        catch (err) {
            this.logger.warn('Web Server', `Could not apply module toggles live: ${err.message}`);
        }
    }
    async start() {
        return new Promise((resolve, reject) => {
            this.server = this.app.listen(this.port, () => {
                this.logger.info('Web Server', `Dashboard running at http://localhost:${this.port}`);
                resolve();
            });
            this.server.on('error', (err) => {
                this.logger.error('Web Server', `Failed to start: ${err.message}`);
                reject(err);
            });
        });
    }
    async stop() {
        return new Promise((resolve) => {
            if (this.server) {
                this.server.close(() => resolve());
            }
            else {
                resolve();
            }
        });
    }
}
exports.WebServer = WebServer;
WebServer.CONFIG_SERVICES = [
    'bot', 'leveling', 'ai', 'music', 'moderation', 'economy', 'automation', 'analytics', 'tempvc', 'web', 'cards', 'community', 'tickets', 'staffapps',
];
