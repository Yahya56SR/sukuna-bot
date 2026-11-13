"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebServer = void 0;
const express_1 = __importDefault(require("express"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const crypto_1 = __importDefault(require("crypto"));
const drizzle_orm_1 = require("drizzle-orm");
const schema_1 = require("../database/schema");
const CardTemplates_1 = require("../config/CardTemplates");
const welcomecard_1 = require("../utils/welcomecard");
const rankcard_1 = require("../utils/rankcard");
const auth_1 = require("./auth");
class WebServer {
    constructor(logger, appRef, port = 3000) {
        this.logger = logger;
        this.appRef = appRef;
        this.port = port;
        this.app = (0, express_1.default)();
        this.app.set('trust proxy', 1);
        this.app.disable('x-powered-by');
        const publicUrl = (process.env.DASHBOARD_URL || `http://localhost:${port}`).replace(/\/+$/, '');
        this.auth = new auth_1.DashboardAuth({
            clientId: process.env.DISCORD_CLIENT_ID || process.env.DASHBOARD_CLIENT_ID || '',
            clientSecret: process.env.DISCORD_CLIENT_SECRET || process.env.DASHBOARD_CLIENT_SECRET || '',
            publicUrl,
            sessionSecret: process.env.DASHBOARD_SESSION_SECRET || crypto_1.default.randomBytes(32).toString('hex'),
            ownerIds: [
                ...(process.env.DASHBOARD_OWNER_IDS || '').split(','),
                process.env.DISCORD_OWNER_ID || '',
            ].map((id) => id.trim()).filter(Boolean),
            allowedGuildId: process.env.DASHBOARD_GUILD_ID || '',
            disabled: process.env.DASHBOARD_AUTH_DISABLED === 'true',
            sessionTtlMs: Math.max(1, parseInt(process.env.DASHBOARD_SESSION_DAYS || '7')) * 24 * 60 * 60 * 1000,
            apiBase: process.env.DASHBOARD_OAUTH_API_BASE,
            getBotGuildIds: () => {
                const client = this.appRef.getClient?.();
                return client?.guilds?.cache ? [...client.guilds.cache.keys()].map(String) : [];
            },
        }, logger);
        this.auth.setClientGetter(() => this.appRef.getClient?.() ?? null);
        if (this.auth.disabled) {
            this.logger.warn('Web Server', 'DASHBOARD_AUTH_DISABLED=true — dashboard authentication is OFF');
        }
        else if (!this.auth.isConfigured) {
            this.logger.warn('Web Server', 'Discord dashboard login is not configured (DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET)');
        }
        this.app.use(express_1.default.json({ limit: '2mb' }));
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
        // Browsers request this automatically — 204 instead of a 404
        this.app.get('/favicon.ico', (_req, res) => {
            res.status(204).end();
        });
        this.setupRoutes();
    }
    setupRoutes() {
        // ---- Authentication (public routes + guard) ----
        this.auth.registerRoutes(this.app);
        this.app.use(this.auth.middleware());
        this.app.get('/', (_req, res) => {
            res.sendFile(path_1.default.join(__dirname, 'views', 'index.html'));
        });
        // Global bot configuration, secrets and process control are owner-only.
        // Per-guild settings (guild_settings) stay available to guild managers.
        this.app.use((req, res, next) => {
            const user = req.dashboardUser ?? null;
            if (this.auth.disabled || user?.isOwner)
                return next();
            const p = req.path;
            const ownerOnly = (p.startsWith('/api/config/') && p !== '/api/config/guild_settings') ||
                p.startsWith('/api/control/') ||
                p.startsWith('/api/cards/') ||
                p.startsWith('/api/system/') ||
                p === '/api/logs' ||
                p === '/api/ai/status' ||
                p === '/api/ai/test' ||
                p === '/api/music/status';
            if (ownerOnly) {
                return res.status(403).json({ error: 'owner_only', message: 'This action is restricted to the bot owner.' });
            }
            return next();
        });
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
        this.app.get('/api/guilds', (req, res) => {
            try {
                const client = this.appRef.getClient?.();
                const guilds = client?.guilds?.cache ?? new Map();
                const user = this.requestUser(req);
                const visible = new Set(this.auth.filterGuilds(user, [...guilds.keys()].map(String)));
                const list = [...guilds.values()]
                    .filter((g) => visible.has(String(g.id)))
                    .map((g) => ({
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
        this.app.get('/api/guilds/:guildId', (req, res) => {
            try {
                if (!this.auth.canAccessGuild(this.requestUser(req), req.params.guildId)) {
                    return res.status(403).json({ error: 'guild_forbidden' });
                }
                const client = this.appRef.getClient?.();
                const guild = client?.guilds?.cache?.get(req.params.guildId);
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
        this.app.get('/api/guilds/:guildId/members', (req, res) => {
            if (!this.auth.canAccessGuild(this.requestUser(req), req.params.guildId)) {
                return res.status(403).json({ error: 'guild_forbidden' });
            }
            const client = this.appRef.getClient?.();
            const guild = client?.guilds?.cache?.get(req.params.guildId);
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
        this.app.get('/api/guilds/:guildId/channels', (req, res) => {
            if (!this.auth.canAccessGuild(this.requestUser(req), req.params.guildId)) {
                return res.status(403).json({ error: 'guild_forbidden' });
            }
            const client = this.appRef.getClient?.();
            const guild = client?.guilds?.cache?.get(req.params.guildId);
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
        this.app.get('/api/moderation/cases', async (req, res) => {
            try {
                const guildId = this.requireGuild(req, res, req.query.guildId);
                if (!guildId)
                    return;
                const cases = await this.appRef.moderation.getCases?.(guildId) ?? [];
                res.json(cases);
            }
            catch (err) {
                res.status(500).json({ error: 'Failed to fetch moderation cases' });
            }
        });
        this.app.post('/api/moderation/warn', async (req, res) => {
            try {
                const guildId = this.requireGuild(req, res, req.body?.guildId);
                if (!guildId)
                    return;
                const { userId, reason } = req.body ?? {};
                const moderatorId = req.body?.moderatorId || this.requestUser(req)?.id;
                const caseId = await this.appRef.moderation.warn?.(guildId, userId, moderatorId, reason ?? '');
                res.json({ success: true, caseId });
            }
            catch (err) {
                res.status(500).json({ error: err.message || 'Failed to warn user' });
            }
        });
        this.app.post('/api/moderation/kick', async (req, res) => {
            try {
                const guildId = this.requireGuild(req, res, req.body?.guildId);
                if (!guildId)
                    return;
                const { userId, reason } = req.body ?? {};
                const moderatorId = req.body?.moderatorId || this.requestUser(req)?.id;
                const caseId = await this.appRef.moderation.kick?.(guildId, userId, moderatorId, reason ?? '');
                res.json({ success: true, caseId });
            }
            catch (err) {
                res.status(500).json({ error: err.message || 'Failed to kick user' });
            }
        });
        this.app.post('/api/moderation/ban', async (req, res) => {
            try {
                const guildId = this.requireGuild(req, res, req.body?.guildId);
                if (!guildId)
                    return;
                const { userId, reason, deleteMessageDays } = req.body ?? {};
                const moderatorId = req.body?.moderatorId || this.requestUser(req)?.id;
                const caseId = await this.appRef.moderation.ban?.(guildId, userId, moderatorId, reason ?? '', deleteMessageDays ?? 0);
                res.json({ success: true, caseId });
            }
            catch (err) {
                res.status(500).json({ error: err.message || 'Failed to ban user' });
            }
        });
        this.app.post('/api/moderation/mute', async (req, res) => {
            try {
                const guildId = this.requireGuild(req, res, req.body?.guildId);
                if (!guildId)
                    return;
                const { userId, reason, durationMinutes } = req.body ?? {};
                const moderatorId = req.body?.moderatorId || this.requestUser(req)?.id;
                const caseId = await this.appRef.moderation.mute?.(guildId, userId, moderatorId, reason ?? '', durationMinutes ?? 60);
                res.json({ success: true, caseId });
            }
            catch (err) {
                res.status(500).json({ error: err.message || 'Failed to mute user' });
            }
        });
        // ---- Economy ----
        // Balances are guild-scoped in the rebuilt economy. The dashboard may pass
        // guildId; otherwise we fall back to the currently selected/first guild so
        // the value shown here matches what /balance shows inside Discord.
        this.app.get('/api/economy/balance/:userId', async (req, res) => {
            try {
                const guildId = this.requireGuild(req, res, req.query.guildId);
                if (!guildId)
                    return;
                const balance = await this.appRef.economy.getBalance(guildId, req.params.userId);
                res.json({ userId: req.params.userId, guildId, balance });
            }
            catch (err) {
                res.status(500).json({ error: 'Failed to fetch balance' });
            }
        });
        this.app.post('/api/economy/set-balance', async (req, res) => {
            try {
                const { userId, balance } = req.body ?? {};
                if (!userId) {
                    return res.status(400).json({ error: 'userId is required' });
                }
                const target = Math.max(0, Math.floor(Number(balance)));
                if (!Number.isFinite(target)) {
                    return res.status(400).json({ error: 'balance must be a number' });
                }
                const guildId = this.requireGuild(req, res, req.body?.guildId);
                if (!guildId)
                    return;
                const result = await this.appRef.economy.setBalance(guildId, userId, target);
                res.json({ success: true, userId, guildId, balance: result.balance });
            }
            catch (err) {
                res.status(500).json({ error: err.message || 'Failed to set balance' });
            }
        });
        // ---- Leveling ----
        this.app.get('/api/leveling/level/:userId', async (req, res) => {
            try {
                const guildId = this.requireGuild(req, res, req.query.guildId);
                if (!guildId)
                    return;
                const data = await this.appRef.leveling.getLevel?.(guildId, req.params.userId);
                if (!data) {
                    return res.status(404).json({ error: 'No leveling data found' });
                }
                res.json(data);
            }
            catch (err) {
                res.status(500).json({ error: 'Failed to fetch level data' });
            }
        });
        this.app.get('/api/leveling/leaderboard', async (req, res) => {
            try {
                const guildId = this.requireGuild(req, res, req.query.guildId);
                if (!guildId)
                    return;
                const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
                const leaderboard = await this.appRef.leveling.getLeaderboard?.(guildId, limit) ?? [];
                res.json(leaderboard);
            }
            catch (err) {
                res.status(500).json({ error: 'Failed to fetch leaderboard' });
            }
        });
        this.app.post('/api/leveling/set-xp', async (req, res) => {
            try {
                const { userId, xp } = req.body ?? {};
                if (!userId) {
                    return res.status(400).json({ error: 'userId is required' });
                }
                const amount = Number(xp);
                if (!Number.isFinite(amount) || amount < 0) {
                    return res.status(400).json({ error: 'xp must be a non-negative number' });
                }
                const guildId = this.requireGuild(req, res, req.body?.guildId);
                if (!guildId)
                    return;
                const result = await this.appRef.leveling.setXP?.(guildId, userId, amount);
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
                const guildId = this.requireGuild(req, res, req.query.guildId);
                if (!guildId)
                    return;
                const settings = await this.readGuildSettings(guildId);
                res.json(settings ?? this.defaultGuildSettings(guildId));
            }
            catch (err) {
                this.logger.error('Web Server', 'GET guild_settings failed', err);
                res.status(500).json({ error: 'Failed to read guild settings' });
            }
        });
        this.app.post('/api/config/guild_settings', async (req, res) => {
            try {
                const body = req.body ?? {};
                const guildId = this.requireGuild(req, res, body.guildId);
                if (!guildId)
                    return;
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
        // ---- Panels: custom emoji server, mapping and live preview ----
        this.app.get('/api/panels/emojis', (_req, res) => {
            try {
                const overview = this.appRef.panels?.getEmojiOverview?.() ?? { count: 0, guild: '', custom: [], resolved: {} };
                res.json(overview);
            }
            catch (err) {
                this.logger.error('Web Server', 'GET /api/panels/emojis failed', err);
                res.status(500).json({ error: 'Failed to fetch panel emoji' });
            }
        });
        this.app.post('/api/panels/refresh-emojis', async (_req, res) => {
            try {
                const count = await this.appRef.panels?.refreshEmojis?.() ?? 0;
                const stats = this.appRef.panels?.getEmojiStats?.() ?? { count, guild: '' };
                res.json({ success: true, count, guild: stats.guild });
            }
            catch (err) {
                this.logger.error('Web Server', 'POST /api/panels/refresh-emojis failed', err);
                res.status(500).json({ error: err.message || 'Failed to refresh emoji' });
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
        // ---- System operations (dashboard coverage for every module) ----
        this.app.get('/api/systems/overview', async (req, res) => {
            try {
                const sqlite = this.sqliteOrNull();
                if (!sqlite)
                    return res.json({ guildId: null, counts: {}, systems: [] });
                const user = this.requestUser(req);
                const scoped = this.scopeGuildIds(req);
                const isGlobal = this.auth.disabled || Boolean(user?.isOwner);
                const guildId = req.query.guildId ? this.requireGuild(req, res, req.query.guildId) : null;
                if (req.query.guildId && !guildId)
                    return;
                const ids = guildId ? [guildId] : scoped;
                const where = `WHERE ${ids.length ? `guild_id IN (${ids.map((id) => `'${id}'`).join(',')})` : isGlobal ? '1=1' : '1=0'}`;
                const tableWhere = (table) => `WHERE ${ids.length ? `${table}.guild_id IN (${ids.map((id) => `'${id}'`).join(',')})` : isGlobal ? '1=1' : '1=0'}`;
                const count = (sql) => Number(this.safeGet(sqlite, sql)?.c ?? 0);
                const ticketsOpen = count(`SELECT COUNT(*) c FROM tickets ${where} AND status = 'open'`.replace('WHERE  AND', 'WHERE '));
                const ticketsTotal = count(`SELECT COUNT(*) c FROM tickets ${where}`);
                const giveawaysActive = count(`SELECT COUNT(*) c FROM giveaways ${where} AND status = 'active'`.replace('WHERE  AND', 'WHERE '));
                const giveawaysTotal = count(`SELECT COUNT(*) c FROM giveaways ${where}`);
                const gamesActive = count(`SELECT COUNT(*) c FROM economy_games ${where} AND status != 'finished'`.replace('WHERE  AND', 'WHERE '));
                const gamesTotal = count(`SELECT COUNT(*) c FROM economy_games ${where}`);
                const appsPending = count(`SELECT COUNT(*) c FROM staff_applications ${where} AND status = 'pending'`.replace('WHERE  AND', 'WHERE '));
                const appsTotal = count(`SELECT COUNT(*) c FROM staff_applications ${where}`);
                const tempvcInstances = count(`SELECT COUNT(*) c FROM tempvc_instances ${where}`);
                const automationEnabled = count(`SELECT COUNT(*) c FROM automation_jobs ${where} AND enabled = 1`.replace('WHERE  AND', 'WHERE '));
                const automationTotal = count(`SELECT COUNT(*) c FROM automation_jobs ${where}`);
                const moderationCases = count(`SELECT COUNT(*) c FROM moderation_cases ${where}`);
                const warningsActive = count(`SELECT COUNT(*) c FROM warnings ${where} AND active = 1`.replace('WHERE  AND', 'WHERE '));
                const economyAccounts = count(`SELECT COUNT(*) c FROM economy_accounts ${where}`);
                const economyTotal = Number(this.safeGet(sqlite, `SELECT COALESCE(SUM(balance), 0) total FROM economy_accounts ${where}`)?.total ?? 0);
                const levelingProfiles = count(`SELECT COUNT(*) c FROM leveling_profiles ${where}`);
                const aiConversations = count(`SELECT COUNT(*) c FROM ai_conversations ${where}`);
                const musicSessions = count(`SELECT COUNT(*) c FROM music_sessions ${tableWhere('music_sessions')}`);
                res.json({
                    guildId,
                    counts: {
                        tickets: { open: ticketsOpen, total: ticketsTotal },
                        giveaways: { active: giveawaysActive, total: giveawaysTotal },
                        games: { active: gamesActive, total: gamesTotal },
                        staffapps: { pending: appsPending, total: appsTotal },
                        tempvc: { instances: tempvcInstances },
                        automation: { enabled: automationEnabled, total: automationTotal },
                        moderation: { cases: moderationCases, warnings: warningsActive },
                        economy: { accounts: economyAccounts, totalBalance: economyTotal },
                        leveling: { profiles: levelingProfiles },
                        ai: { conversations: aiConversations },
                        music: { sessions: musicSessions },
                    },
                });
            }
            catch (err) {
                this.logger.error('Web Server', 'GET /api/systems/overview failed', err);
                res.status(500).json({ error: 'Failed to build systems overview' });
            }
        });
        // ---- Tickets ----
        this.app.get('/api/tickets', async (req, res) => {
            try {
                const guildId = this.requireGuild(req, res, req.query.guildId);
                if (!guildId)
                    return;
                const status = String(req.query.status || 'all');
                const sqlite = this.sqliteOrNull();
                if (!sqlite)
                    return res.json([]);
                const filter = status === 'open' || status === 'closed' ? ` AND t.status = '${status}'` : '';
                const rows = this.safeAll(sqlite, `SELECT t.*, u.username AS user_name, a.username AS assignee_name
           FROM tickets t
           LEFT JOIN users u ON u.id = t.user_id
           LEFT JOIN users a ON a.id = t.assigned_to
           WHERE t.guild_id = ?${filter}
           ORDER BY t.created_at DESC LIMIT 250`, [guildId]);
                res.json(rows.map((t) => ({
                    id: t.id,
                    guildId: t.guild_id,
                    userId: t.user_id,
                    username: t.user_name || null,
                    channelId: t.channel_id,
                    category: t.category,
                    status: t.status,
                    assignedTo: t.assigned_to,
                    assigneeName: t.assignee_name || null,
                    closeReason: t.close_reason,
                    createdAt: this.toIso(t.created_at),
                    updatedAt: this.toIso(t.updated_at),
                })));
            }
            catch (err) {
                this.logger.error('Web Server', 'GET /api/tickets failed', err);
                res.status(500).json({ error: 'Failed to load tickets' });
            }
        });
        this.app.post('/api/tickets/:id/:action', async (req, res) => {
            try {
                const ticket = await this.appRef.tickets?.getTicket?.(req.params.id);
                if (!ticket)
                    return res.status(404).json({ error: 'Ticket not found' });
                if (!this.auth.canAccessGuild(this.requestUser(req), ticket.guildId)) {
                    return res.status(403).json({ error: 'guild_forbidden' });
                }
                const actor = this.requestUser(req)?.id || 'dashboard';
                const reason = String(req.body?.reason || 'Handled from the dashboard');
                switch (req.params.action) {
                    case 'claim':
                        await this.appRef.tickets.claimTicket(ticket.id, actor);
                        break;
                    case 'close':
                        await this.appRef.tickets.closeTicket(ticket.id, actor, reason, true);
                        break;
                    case 'reopen':
                        await this.appRef.tickets.reopenTicket(ticket.id, actor);
                        break;
                    case 'delete':
                        await this.appRef.tickets.deleteTicket(ticket.id, actor);
                        break;
                    default:
                        return res.status(400).json({ error: 'Unknown ticket action' });
                }
                res.json({ success: true });
            }
            catch (err) {
                res.status(400).json({ error: err.message || 'Ticket action failed' });
            }
        });
        // ---- Giveaways ----
        this.app.get('/api/giveaways', async (req, res) => {
            try {
                const guildId = this.requireGuild(req, res, req.query.guildId);
                if (!guildId)
                    return;
                const list = await this.appRef.giveaways?.listGiveaways?.(guildId) ?? [];
                res.json(list.map((g) => ({
                    id: g.id,
                    guildId: g.guildId,
                    channelId: g.channelId,
                    hostId: g.hostId,
                    prize: g.prize,
                    description: g.description,
                    status: g.status,
                    endsAt: g.endsAt instanceof Date ? g.endsAt.toISOString() : this.toIso(g.endsAt),
                    winnerCount: g.winnerCount,
                    winnerIds: g.winnerIds ?? [],
                    requiredRoles: g.requiredRoles ?? [],
                    entryCount: g.entryCount,
                    prizeAmount: g.prizeAmount,
                    funded: g.funded,
                    createdAt: g.createdAt instanceof Date ? g.createdAt.toISOString() : this.toIso(g.createdAt),
                })));
            }
            catch (err) {
                this.logger.error('Web Server', 'GET /api/giveaways failed', err);
                res.status(500).json({ error: 'Failed to load giveaways' });
            }
        });
        this.app.post('/api/giveaways/:id/:action', async (req, res) => {
            try {
                const giveaway = await this.appRef.giveaways?.getGiveaway?.(req.params.id);
                if (!giveaway)
                    return res.status(404).json({ error: 'Giveaway not found' });
                if (!this.auth.canAccessGuild(this.requestUser(req), giveaway.guildId)) {
                    return res.status(403).json({ error: 'guild_forbidden' });
                }
                const actor = this.requestUser(req)?.id || 'dashboard';
                if (req.params.action === 'end') {
                    await this.appRef.giveaways.endGiveaway(giveaway.id, actor);
                    return res.json({ success: true });
                }
                if (req.params.action === 'cancel') {
                    await this.appRef.giveaways.cancelGiveaway(giveaway.id, actor);
                    return res.json({ success: true });
                }
                if (req.params.action === 'reroll') {
                    const winners = await this.appRef.giveaways.rerollGiveaway(giveaway.id);
                    return res.json({ success: true, winners });
                }
                return res.status(400).json({ error: 'Unknown giveaway action' });
            }
            catch (err) {
                res.status(400).json({ error: err.message || 'Giveaway action failed' });
            }
        });
        // ---- Economy games ----
        this.app.get('/api/games', async (req, res) => {
            try {
                const guildId = this.requireGuild(req, res, req.query.guildId);
                if (!guildId)
                    return;
                const sqlite = this.sqliteOrNull();
                if (!sqlite)
                    return res.json([]);
                const rows = this.safeAll(sqlite, `SELECT g.*, (SELECT COUNT(*) FROM economy_game_players p WHERE p.game_id = g.id) AS player_count
           FROM economy_games g WHERE g.guild_id = ?
           ORDER BY g.created_at DESC LIMIT 200`, [guildId]);
                res.json(rows.map((g) => ({
                    id: g.id,
                    guildId: g.guild_id,
                    channelId: g.channel_id,
                    hostId: g.host_id,
                    type: g.type,
                    prizePool: Number(g.prize_pool ?? 0),
                    entryFee: Number(g.entry_fee ?? 0),
                    status: g.status,
                    winnerId: g.winner_id,
                    playerCount: Number(g.player_count ?? 0),
                    endsAt: this.toIso(g.ends_at),
                    createdAt: this.toIso(g.created_at),
                })));
            }
            catch (err) {
                this.logger.error('Web Server', 'GET /api/games failed', err);
                res.status(500).json({ error: 'Failed to load games' });
            }
        });
        this.app.post('/api/games/:id/end', async (req, res) => {
            try {
                const game = await this.appRef.economyGames?.getGameAsync?.(req.params.id);
                if (!game)
                    return res.status(404).json({ error: 'Game not found' });
                if (!this.auth.canAccessGuild(this.requestUser(req), game.guildId)) {
                    return res.status(403).json({ error: 'guild_forbidden' });
                }
                const result = await this.appRef.economyGames.endGame(game.id);
                res.json({ success: true, ...result });
            }
            catch (err) {
                res.status(400).json({ error: err.message || 'Could not end the game' });
            }
        });
        // ---- Staff applications ----
        this.app.get('/api/staffapps', async (req, res) => {
            try {
                const guildId = this.requireGuild(req, res, req.query.guildId);
                if (!guildId)
                    return;
                const status = String(req.query.status || 'all');
                const sqlite = this.sqliteOrNull();
                if (!sqlite)
                    return res.json([]);
                const filter = ['pending', 'approved', 'denied'].includes(status) ? ` AND s.status = '${status}'` : '';
                const rows = this.safeAll(sqlite, `SELECT s.*, u.username AS user_name
           FROM staff_applications s
           LEFT JOIN users u ON u.id = s.user_id
           WHERE s.guild_id = ?${filter}
           ORDER BY s.created_at DESC LIMIT 250`, [guildId]);
                const parse = (value) => {
                    if (Array.isArray(value))
                        return value;
                    try {
                        return JSON.parse(value || '[]');
                    }
                    catch {
                        return [];
                    }
                };
                res.json(rows.map((s) => ({
                    id: s.id,
                    guildId: s.guild_id,
                    userId: s.user_id,
                    username: s.user_name || null,
                    roleId: s.role_id,
                    answers: parse(s.answers),
                    status: s.status,
                    reviewerId: s.reviewer_id,
                    reviewReason: s.review_reason,
                    createdAt: this.toIso(s.created_at),
                    reviewedAt: this.toIso(s.reviewed_at),
                })));
            }
            catch (err) {
                this.logger.error('Web Server', 'GET /api/staffapps failed', err);
                res.status(500).json({ error: 'Failed to load applications' });
            }
        });
        this.app.post('/api/staffapps/:id/:action', async (req, res) => {
            try {
                const action = req.params.action;
                if (action !== 'approve' && action !== 'deny') {
                    return res.status(400).json({ error: 'Unknown application action' });
                }
                const sqlite = this.sqliteOrNull();
                const row = sqlite ? this.safeGet(sqlite, 'SELECT guild_id FROM staff_applications WHERE id = ?', [req.params.id]) : null;
                if (!row)
                    return res.status(404).json({ error: 'Application not found' });
                if (!this.auth.canAccessGuild(this.requestUser(req), String(row.guild_id))) {
                    return res.status(403).json({ error: 'guild_forbidden' });
                }
                const reviewer = this.requestUser(req)?.id || 'dashboard';
                const result = await this.appRef.staffapps.reviewApplication(req.params.id, reviewer, action, String(req.body?.reason || ''));
                if (!result.ok)
                    return res.status(400).json({ error: result.message });
                res.json({ success: true, message: result.message });
            }
            catch (err) {
                res.status(400).json({ error: err.message || 'Application review failed' });
            }
        });
        // ---- Temporary voice ----
        this.app.get('/api/tempvc', async (req, res) => {
            try {
                const guildId = this.requireGuild(req, res, req.query.guildId);
                if (!guildId)
                    return;
                const sqlite = this.sqliteOrNull();
                const config = this.appRef.tempvc?.getGuildConfig?.(guildId) ?? null;
                const rows = sqlite
                    ? this.safeAll(sqlite, 'SELECT * FROM tempvc_instances WHERE guild_id = ? ORDER BY created_at DESC', [guildId])
                    : [];
                const client = this.appRef.getClient?.();
                const guild = client?.guilds?.cache?.get(guildId);
                res.json({
                    guildId,
                    config,
                    instances: rows.map((i) => ({
                        id: i.id,
                        guildId: i.guild_id,
                        channelId: i.channel_id,
                        ownerId: i.owner_id,
                        categoryId: i.category_id,
                        channelName: guild?.channels?.cache?.get?.(i.channel_id)?.name ?? null,
                        memberCount: guild?.channels?.cache?.get?.(i.channel_id)?.members?.size ?? null,
                        createdAt: this.toIso(i.created_at),
                    })),
                });
            }
            catch (err) {
                this.logger.error('Web Server', 'GET /api/tempvc failed', err);
                res.status(500).json({ error: 'Failed to load temp voice data' });
            }
        });
        this.app.delete('/api/tempvc/:channelId', async (req, res) => {
            try {
                const sqlite = this.sqliteOrNull();
                const row = sqlite ? this.safeGet(sqlite, 'SELECT * FROM tempvc_instances WHERE channel_id = ?', [req.params.channelId]) : null;
                if (!row)
                    return res.status(404).json({ error: 'Temp voice channel not found' });
                if (!this.auth.canAccessGuild(this.requestUser(req), String(row.guild_id))) {
                    return res.status(403).json({ error: 'guild_forbidden' });
                }
                await this.appRef.tempvc.deleteTempVC(req.params.channelId);
                res.json({ success: true });
            }
            catch (err) {
                res.status(400).json({ error: err.message || 'Could not delete the channel' });
            }
        });
        // ---- Community (per-guild welcome / goodbye / autoroles) ----
        this.app.get('/api/community', async (req, res) => {
            try {
                const guildId = this.requireGuild(req, res, req.query.guildId);
                if (!guildId)
                    return;
                const row = await this.readGuildSettings(guildId);
                const globalConfig = this.appRef.community?.getConfig?.() ?? {};
                const roles = (() => {
                    const value = row?.autorole_ids;
                    if (Array.isArray(value))
                        return value.map(String);
                    try {
                        return JSON.parse(value || '[]').map(String);
                    }
                    catch {
                        return [];
                    }
                })();
                res.json({
                    guildId,
                    welcome: {
                        enabled: row?.welcome_enabled ?? Boolean(globalConfig?.welcome?.enabled),
                        channel: row?.welcome_channel_id ?? globalConfig?.welcome?.channel ?? '',
                        message: row?.welcome_message ?? globalConfig?.welcome?.message ?? 'Welcome {user} to {server}!',
                        embed: globalConfig?.welcome?.embed !== false,
                        sendImage: globalConfig?.welcome?.sendImage !== false,
                    },
                    goodbye: {
                        enabled: row?.goodbye_enabled ?? Boolean(globalConfig?.goodbye?.enabled),
                        channel: row?.goodbye_channel_id ?? globalConfig?.goodbye?.channel ?? '',
                        message: row?.goodbye_message ?? globalConfig?.goodbye?.message ?? 'Goodbye {username}!',
                    },
                    autoroles: {
                        enabled: row?.autoroles_enabled ?? Boolean(globalConfig?.autoroles?.enabled),
                        roleIds: roles,
                    },
                    source: row ? 'guild' : 'global',
                });
            }
            catch (err) {
                this.logger.error('Web Server', 'GET /api/community failed', err);
                res.status(500).json({ error: 'Failed to load community settings' });
            }
        });
        this.app.post('/api/community', async (req, res) => {
            try {
                const guildId = this.requireGuild(req, res, req.body?.guildId);
                if (!guildId)
                    return;
                const body = req.body ?? {};
                const patch = {};
                if (body.welcome) {
                    if (body.welcome.enabled !== undefined)
                        patch.welcome_enabled = Boolean(body.welcome.enabled);
                    if (body.welcome.channel !== undefined)
                        patch.welcome_channel_id = String(body.welcome.channel);
                    if (body.welcome.message !== undefined)
                        patch.welcome_message = String(body.welcome.message);
                }
                if (body.goodbye) {
                    if (body.goodbye.enabled !== undefined)
                        patch.goodbye_enabled = Boolean(body.goodbye.enabled);
                    if (body.goodbye.channel !== undefined)
                        patch.goodbye_channel_id = String(body.goodbye.channel);
                    if (body.goodbye.message !== undefined)
                        patch.goodbye_message = String(body.goodbye.message);
                }
                if (body.autoroles) {
                    if (body.autoroles.enabled !== undefined)
                        patch.autoroles_enabled = Boolean(body.autoroles.enabled);
                    if (Array.isArray(body.autoroles.roleIds))
                        patch.autorole_ids = body.autoroles.roleIds.map(String);
                }
                await this.writeGuildSettings(guildId, patch);
                res.json({ success: true });
            }
            catch (err) {
                res.status(500).json({ error: err.message || 'Failed to save community settings' });
            }
        });
        // ---- Automation jobs ----
        this.app.get('/api/automation', async (req, res) => {
            try {
                const guildId = this.requireGuild(req, res, req.query.guildId);
                if (!guildId)
                    return;
                const jobs = await this.appRef.automation?.listJobs?.(guildId) ?? [];
                res.json(jobs.map((job) => ({
                    ...job,
                    lastRun: job.lastRun ? new Date(job.lastRun).toISOString() : null,
                    nextRun: job.nextRun ? new Date(job.nextRun).toISOString() : null,
                })));
            }
            catch (err) {
                this.logger.error('Web Server', 'GET /api/automation failed', err);
                res.status(500).json({ error: 'Failed to load automation jobs' });
            }
        });
        this.app.post('/api/automation', async (req, res) => {
            try {
                const guildId = this.requireGuild(req, res, req.body?.guildId);
                if (!guildId)
                    return;
                const { type, cron, channelId, message, title, description, color } = req.body ?? {};
                if (!type || !cron)
                    return res.status(400).json({ error: 'type and cron are required' });
                const jobConfig = { channelId: String(channelId || '') };
                if (type === 'message')
                    jobConfig.message = String(message || '');
                if (type === 'embed') {
                    jobConfig.title = String(title || '');
                    jobConfig.description = String(description || message || '');
                    jobConfig.color = String(color || '#5865f2');
                }
                if (type === 'log')
                    jobConfig.message = String(message || 'Scheduled log tick');
                const id = await this.appRef.automation.addJob({
                    guildId,
                    type: String(type),
                    cronExpression: String(cron),
                    enabled: true,
                    config: jobConfig,
                });
                res.json({ success: true, id });
            }
            catch (err) {
                res.status(400).json({ error: err.message || 'Could not create the job' });
            }
        });
        this.app.post('/api/automation/:id/:action', async (req, res) => {
            try {
                const sqlite = this.sqliteOrNull();
                const row = sqlite ? this.safeGet(sqlite, 'SELECT guild_id, enabled FROM automation_jobs WHERE id = ?', [req.params.id]) : null;
                if (!row)
                    return res.status(404).json({ error: 'Job not found' });
                if (!this.auth.canAccessGuild(this.requestUser(req), String(row.guild_id))) {
                    return res.status(403).json({ error: 'guild_forbidden' });
                }
                const action = req.params.action;
                if (action === 'run') {
                    await this.appRef.automation.runJobNow(req.params.id);
                    return res.json({ success: true });
                }
                if (action === 'toggle') {
                    const next = typeof req.body?.enabled === 'boolean' ? req.body.enabled : !Boolean(row.enabled);
                    await this.appRef.automation.setJobEnabled(req.params.id, next);
                    return res.json({ success: true, enabled: next });
                }
                if (action === 'delete') {
                    await this.appRef.automation.removeJob(req.params.id);
                    return res.json({ success: true });
                }
                return res.status(400).json({ error: 'Unknown automation action' });
            }
            catch (err) {
                res.status(400).json({ error: err.message || 'Automation action failed' });
            }
        });
        // ---- AI ----
        this.app.get('/api/ai/status', async (_req, res) => {
            try {
                const config = this.appRef.ai?.getConfig?.() ?? {};
                const sqlite = this.sqliteOrNull();
                const conversations = sqlite ? Number(this.safeGet(sqlite, 'SELECT COUNT(*) c FROM ai_conversations')?.c ?? 0) : 0;
                res.json({
                    enabled: Boolean(config.enabled),
                    displayName: config.displayName ?? 'Sukuna',
                    provider: config.provider ?? 'gemini',
                    model: config.model ?? '',
                    hasApiKey: Boolean(config.apiKey),
                    channelIds: config.channelIds ?? [],
                    historySize: config.historySize,
                    batchWindowMs: config.batchWindowMs,
                    replyCooldownSeconds: config.replyCooldownSeconds,
                    decisionCooldownSeconds: config.decisionCooldownSeconds,
                    maxRepliesPerHour: config.maxRepliesPerHour,
                    maxMessageLength: config.maxMessageLength,
                    temperature: config.temperature,
                    conversations,
                });
            }
            catch (err) {
                this.logger.error('Web Server', 'GET /api/ai/status failed', err);
                res.status(500).json({ error: 'Failed to read AI status' });
            }
        });
        this.app.get('/api/ai/conversations', async (req, res) => {
            try {
                const guildId = this.requireGuild(req, res, req.query.guildId);
                if (!guildId)
                    return;
                const sqlite = this.sqliteOrNull();
                if (!sqlite)
                    return res.json([]);
                const rows = this.safeAll(sqlite, `SELECT id, guild_id, user_id, channel_id, provider, model, messages, created_at, updated_at
           FROM ai_conversations WHERE guild_id = ? ORDER BY updated_at DESC LIMIT 50`, [guildId]);
                res.json(rows.map((row) => {
                    let count = 0;
                    try {
                        const parsed = typeof row.messages === 'string' ? JSON.parse(row.messages) : row.messages;
                        count = Array.isArray(parsed) ? parsed.length : 0;
                    }
                    catch {
                        count = 0;
                    }
                    return {
                        id: row.id,
                        userId: row.user_id,
                        channelId: row.channel_id,
                        provider: row.provider,
                        model: row.model,
                        messageCount: count,
                        createdAt: this.toIso(row.created_at),
                        updatedAt: this.toIso(row.updated_at),
                    };
                }));
            }
            catch (err) {
                this.logger.error('Web Server', 'GET /api/ai/conversations failed', err);
                res.status(500).json({ error: 'Failed to load conversations' });
            }
        });
        this.app.post('/api/ai/test', async (req, res) => {
            try {
                const prompt = String(req.body?.prompt || '').trim();
                if (!prompt)
                    return res.status(400).json({ error: 'prompt is required' });
                if (!this.appRef.ai?.testAsk)
                    return res.status(503).json({ error: 'AI service unavailable' });
                const client = this.appRef.getClient?.();
                const guild = req.body?.guildId ? client?.guilds?.cache?.get(String(req.body.guildId)) : undefined;
                const channel = req.body?.channelId ? guild?.channels?.cache?.get(String(req.body.channelId)) : undefined;
                const started = Date.now();
                const result = await this.appRef.ai.testAsk(prompt, guild, channel);
                res.json({ success: true, latencyMs: Date.now() - started, ...result });
            }
            catch (err) {
                res.status(400).json({ error: err.message || 'AI request failed' });
            }
        });
        // ---- Music ----
        this.app.get('/api/music/status', async (_req, res) => {
            try {
                const status = this.appRef.music?.getStatus?.() ?? { enabled: false, ready: false, players: [] };
                res.json(status);
            }
            catch (err) {
                this.logger.error('Web Server', 'GET /api/music/status failed', err);
                res.status(500).json({ error: 'Failed to read music status' });
            }
        });
        this.app.get('/api/music/queue', async (req, res) => {
            try {
                const guildId = this.requireGuild(req, res, req.query.guildId);
                if (!guildId)
                    return;
                const music = this.appRef.music;
                if (!music)
                    return res.json({ ready: false, nowPlaying: null, queue: [], session: null });
                const [nowPlaying, queue, session] = await Promise.all([
                    music.getNowPlaying?.(guildId).catch(() => null) ?? null,
                    music.getQueue?.(guildId).catch(() => []) ?? [],
                    music.getSession?.(guildId).catch(() => null) ?? null,
                ]);
                res.json({ ready: Boolean(music.isReady), nowPlaying, queue, session });
            }
            catch (err) {
                res.json({ ready: false, nowPlaying: null, queue: [], session: null, error: err.message });
            }
        });
        this.app.post('/api/music/controls', async (req, res) => {
            try {
                const guildId = this.requireGuild(req, res, req.body?.guildId);
                if (!guildId)
                    return;
                const action = String(req.body?.action || '');
                const music = this.appRef.music;
                if (!music)
                    return res.status(503).json({ error: 'Music service unavailable' });
                switch (action) {
                    case 'skip':
                        await music.skip(guildId);
                        break;
                    case 'stop':
                        await music.stop(guildId);
                        break;
                    case 'pause':
                        await music.pause(guildId);
                        break;
                    case 'resume':
                        await music.resume(guildId);
                        break;
                    case 'volume': {
                        const volume = Math.max(0, Math.min(200, Number(req.body?.volume ?? 50)));
                        await music.setVolume(guildId, volume);
                        break;
                    }
                    default:
                        return res.status(400).json({ error: 'Unknown music action' });
                }
                res.json({ success: true });
            }
            catch (err) {
                res.status(400).json({ error: err.message || 'Music action failed' });
            }
        });
        // ---- Analytics ----
        this.app.get('/api/analytics', async (req, res) => {
            try {
                const user = this.requestUser(req);
                const canSeeGlobal = this.auth.disabled || Boolean(user?.isOwner);
                let guildId = req.query.guildId ? String(req.query.guildId) : '';
                if (guildId) {
                    const checked = this.requireGuild(req, res, guildId);
                    if (!checked)
                        return;
                    guildId = checked;
                }
                else if (!canSeeGlobal) {
                    const checked = this.requireGuild(req, res);
                    if (!checked)
                        return;
                    guildId = checked;
                }
                const days = Math.min(60, Math.max(1, parseInt(req.query.days) || 14));
                const [stats, series] = await Promise.all([
                    guildId ? this.appRef.analytics?.getGuildStats?.(guildId) : this.appRef.analytics?.getStats?.(),
                    this.appRef.analytics?.getActivitySeries?.(guildId || undefined, days) ?? [],
                ]);
                res.json({ guildId: guildId || null, global: !guildId, stats: stats ?? {}, series });
            }
            catch (err) {
                this.logger.error('Web Server', 'GET /api/analytics failed', err);
                res.status(500).json({ error: 'Failed to load analytics' });
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
            case 'panels':
                return app.panels?.getConfig?.() ?? null;
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
            case 'panels': {
                const current = app.panels?.getConfig?.() ?? {};
                const next = { ...current };
                this.deepAssignConfig(next, incoming);
                app.panels?.setConfig?.(next);
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
                    else if (row.key === 'panels') {
                        const app = this.appRef;
                        const current = app.panels?.getConfig?.() ?? {};
                        const next = { ...current };
                        this.deepAssignConfig(next, saved);
                        app.panels?.setConfig?.(next);
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
    resolveGuildId(explicit, user) {
        if (explicit)
            return explicit;
        try {
            const client = this.appRef.getClient?.();
            const guilds = client?.guilds?.cache ? [...client.guilds.cache.values()] : [];
            const allowed = user ? this.auth.filterGuilds(user, guilds.map((g) => String(g.id))) : guilds.map((g) => String(g.id));
            const firstAllowed = guilds.find((g) => allowed.includes(String(g.id)));
            if (firstAllowed)
                return String(firstAllowed.id);
            if (guilds[0])
                return String(guilds[0].id);
        }
        catch {
            // Discord client not ready yet — fall through to the default bucket
        }
        return 'global';
    }
    requestUser(req) {
        return req?.dashboardUser ?? null;
    }
    /** Guild ids the current user is allowed to query, scoped to the bot's guilds. */
    scopeGuildIds(req) {
        const client = this.appRef.getClient?.();
        const all = client?.guilds?.cache ? [...client.guilds.cache.keys()].map(String) : [];
        const user = this.requestUser(req);
        if (!user)
            return [];
        if (this.auth.disabled || user.isOwner)
            return all;
        return all.filter((id) => user.guildIds.includes(id));
    }
    /**
     * Resolve the guild for a request and enforce per-guild authorization.
     * Returns null after writing a 400/403 response.
     */
    requireGuild(req, res, explicit) {
        const user = this.requestUser(req);
        const guildId = explicit || String(req.query?.guildId || req.body?.guildId || '') || this.resolveGuildId(undefined, user);
        if (!guildId || guildId === 'global') {
            res.status(400).json({ error: 'guild_required', message: 'Select a server first.' });
            return null;
        }
        if (!this.auth.canAccessGuild(user, guildId)) {
            res.status(403).json({ error: 'guild_forbidden', message: 'You do not have access to this server.' });
            return null;
        }
        return guildId;
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
    'bot', 'leveling', 'ai', 'music', 'moderation', 'economy', 'automation', 'analytics', 'tempvc', 'web', 'cards', 'community', 'tickets', 'staffapps', 'panels',
];
