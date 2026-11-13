import express from 'express';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { eq } from 'drizzle-orm';
import { Logger } from '../infrastructure/Logger';
import { guildSettings } from '../database/schema';
import { getDefaultCardConfig } from '../config/CardTemplates';
import { welcomeCard } from '../utils/welcomecard';
import { rankCard, leaderboardCard } from '../utils/rankcard';
import { DashboardAuth, DashboardUser } from './auth';

export class WebServer {
  private app: express.Application;
  private port: number;
  private logger: Logger;
  private appRef: any;
  private server: any;
  private auth: DashboardAuth;

  constructor(logger: Logger, appRef: any, port: number = 3000) {
    this.logger = logger;
    this.appRef = appRef;
    this.port = port;
    this.app = express();
    this.app.set('trust proxy', 1);
    this.app.disable('x-powered-by');

    const publicUrl = (process.env.DASHBOARD_URL || `http://localhost:${port}`).replace(/\/+$/, '');
    this.auth = new DashboardAuth({
      clientId: process.env.DISCORD_CLIENT_ID || process.env.DASHBOARD_CLIENT_ID || '',
      clientSecret: process.env.DISCORD_CLIENT_SECRET || process.env.DASHBOARD_CLIENT_SECRET || '',
      publicUrl,
      sessionSecret: process.env.DASHBOARD_SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
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
    } else if (!this.auth.isConfigured) {
      this.logger.warn('Web Server', 'Discord dashboard login is not configured (DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET)');
    }

    this.app.use(express.json({ limit: '2mb' }));
    this.app.use(express.urlencoded({ extended: true }));

    // Request logging — without this, API calls never appear in the console
    this.app.use((req: any, res: any, next: any) => {
      const start = Date.now();
      res.on('finish', () => {
        const status = res.statusCode;
        const msg = `${req.method} ${req.originalUrl} -> ${status} (${Date.now() - start}ms)`;
        if (status >= 400) {
          this.logger.warn('Web Server', msg);
        } else {
          this.logger.info('Web Server', msg);
        }
      });
      next();
    });

    this.app.use('/static', express.static(path.join(__dirname, 'public')));

    // Browsers request this automatically — 204 instead of a 404
    this.app.get('/favicon.ico', (_req: any, res: any) => {
      res.status(204).end();
    });

    this.setupRoutes();
  }

  private setupRoutes(): void {
    // ---- Authentication (public routes + guard) ----
    this.auth.registerRoutes(this.app);
    this.app.use(this.auth.middleware());

    this.app.get('/', (_req: any, res: any) => {
      res.sendFile(path.join(__dirname, 'views', 'index.html'));
    });

    // Global bot configuration, secrets and process control are owner-only.
    // Per-guild settings (guild_settings) stay available to guild managers.
    this.app.use((req: any, res: any, next: any) => {
      const user: DashboardUser | null = req.dashboardUser ?? null;
      if (this.auth.disabled || user?.isOwner) return next();
      const p = req.path;
      const ownerOnly =
        (p.startsWith('/api/config/') && p !== '/api/config/guild_settings') ||
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
    this.app.get('/api/status', (_req: any, res: any) => {
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
      } catch (err) {
        this.logger.error('Web Server', 'GET /api/status failed', err as Error);
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
    this.app.get('/api/stats', async (_req: any, res: any) => {
      try {
        const stats = await this.appRef.analytics.getStats?.();
        res.json(stats ?? {
          totalGuilds: 0,
          totalUsers: 0,
          totalMessages: 0,
          totalModerationCases: 0,
          uptime: process.uptime(),
        });
      } catch (err) {
        this.logger.error('Web Server', 'GET /api/stats failed', err as Error);
        res.status(500).json({ error: 'Failed to fetch stats' });
      }
    });

    // ---- Dashboard overview (single request for the landing page) ----
    this.app.get('/api/overview', async (_req: any, res: any) => {
      const client = this.appRef.getClient?.();
      const guildMap = client?.guilds?.cache ?? new Map();
      const guildList = [...guildMap.values()];
      const memory = process.memoryUsage();

      let stats: any = {};
      try {
        stats = (await this.appRef.analytics?.getStats?.()) ?? {};
      } catch (err) {
        this.logger.warn('Web Server', 'Overview stats unavailable', err as Error);
      }

      const status = {
        online: !!client,
        ready: client?.isReady?.() ?? false,
        user: client?.user?.tag ?? null,
        displayName: client?.user?.globalName ?? client?.user?.username ?? null,
        userId: client?.user?.id ?? null,
        avatar: client?.user?.avatar ?? null,
        guilds: guildList.length,
        members: guildList.reduce((sum: number, g: any) => sum + (g.memberCount ?? 0), 0),
        users: client?.users?.cache?.size ?? 0,
        channels: client?.channels?.cache?.size ?? 0,
        uptime: process.uptime(),
        ping: client?.ws?.ping ?? 0,
        memory,
        platform: process.platform,
        nodeVersion: process.version,
        env: process.env.NODE_ENV ?? 'development',
      };

      const overview: any = {
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
          .sort((a: any, b: any) => (b.memberCount ?? 0) - (a.memberCount ?? 0))
          .slice(0, 6)
          .map((g: any) => ({
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

        overview.topMembers = this.safeAll(
          sqlite,
          `SELECT u.id, u.username, u.avatar,
                  MAX(lp.level) AS level,
                  COALESCE(SUM(lp.total_xp), 0) AS total_xp,
                  COALESCE((SELECT SUM(balance) FROM economy_accounts WHERE user_id = u.id), 0) AS balance
           FROM users u
           LEFT JOIN leveling_profiles lp ON lp.user_id = u.id
           GROUP BY u.id
           HAVING total_xp > 0 OR balance > 0
           ORDER BY total_xp DESC, balance DESC
           LIMIT 6`,
        ).map((u: any) => ({
          id: u.id,
          username: u.username || `Member ${String(u.id).slice(0, 6)}`,
          avatar: u.avatar ?? null,
          level: Number(u.level ?? 1),
          totalXp: Number(u.total_xp ?? 0),
          balance: Number(u.balance ?? 0),
        }));

        overview.recentCases = this.safeAll(
          sqlite,
          `SELECT c.id, c.type, c.user_id, c.moderator_id, c.reason, c.created_at,
                  c.guild_id, u.username AS user_name, g.name AS guild_name
           FROM moderation_cases c
           LEFT JOIN users u ON u.id = c.user_id
           LEFT JOIN guilds g ON g.id = c.guild_id
           ORDER BY c.created_at DESC
           LIMIT 6`,
        ).map((c: any) => ({
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
          overview.topServers = this.safeAll(
            sqlite,
            `SELECT id, name, icon, owner_id FROM guilds ORDER BY name LIMIT 6`,
          ).map((g: any) => ({
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
        const logs: any[] = this.appRef.logger?.getLogs?.() ?? [];
        overview.logs = {
          warnings: logs.filter((l) => l.level === 'warn').length,
          errors: logs.filter((l) => l.level === 'error').length,
          recent: logs.slice(-12).reverse(),
        };
      } catch { /* logger is optional for the overview */ }

      res.json(overview);
    });

    // ---- Economy aggregate (used by the Economy page) ----
    this.app.get('/api/economy/stats', (_req: any, res: any) => {
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
    this.app.get('/api/commands', (_req: any, res: any) => {
      const commands = this.appRef.commands.getCommands?.() ?? [];
      const cmdArray = commands instanceof Map ? [...commands.values()] : Array.isArray(commands) ? commands : [];
      res.json(cmdArray.map((cmd: any) => ({
        name: cmd.data?.name ?? cmd.name ?? 'unknown',
        description: cmd.data?.description ?? cmd.description ?? '',
        category: cmd.category ?? 'General',
      })));
    });

    // ---- Guilds ----
    this.app.get('/api/guilds', (req: any, res: any) => {
      try {
        const client = this.appRef.getClient?.();
        const guilds = client?.guilds?.cache ?? new Map();
        const user = this.requestUser(req);
        const visible = new Set(this.auth.filterGuilds(user, [...guilds.keys()].map(String)));
        const list = [...guilds.values()]
          .filter((g: any) => visible.has(String(g.id)))
          .map((g: any) => ({
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
      } catch (err) {
        this.logger.error('Web Server', 'GET /api/guilds failed', err as Error);
        res.json([]);
      }
    });

    this.app.get('/api/guilds/:guildId', (req: any, res: any) => {
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
          channels: [...guild.channels.cache.values()].map((c: any) => ({
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
          roles: [...guild.roles.cache.values()].map((r: any) => ({
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
      } catch (err) {
        res.status(404).json({ error: 'Guild not found' });
      }
    });

    this.app.get('/api/guilds/:guildId/members', (req: any, res: any) => {
      if (!this.auth.canAccessGuild(this.requestUser(req), req.params.guildId)) {
        return res.status(403).json({ error: 'guild_forbidden' });
      }
      const client = this.appRef.getClient?.();
      const guild = client?.guilds?.cache?.get(req.params.guildId);
      if (!guild) {
        return res.status(404).json({ error: 'Guild not found' });
      }
      const members = [...guild.members.cache.values()].map((m: any) => ({
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
        roles: [...m.roles.cache.values()].map((r: any) => r.id),
        joinedAt: m.joinedAt?.toISOString?.() ?? null,
        premiumSince: m.premiumSince?.toISOString?.() ?? null,
        pending: m.pending ?? false,
      }));
      res.json(members);
    });

    // ---- Channels ----
    this.app.get('/api/guilds/:guildId/channels', (req: any, res: any) => {
      if (!this.auth.canAccessGuild(this.requestUser(req), req.params.guildId)) {
        return res.status(403).json({ error: 'guild_forbidden' });
      }
      const client = this.appRef.getClient?.();
      const guild = client?.guilds?.cache?.get(req.params.guildId);
      if (!guild) {
        return res.status(404).json({ error: 'Guild not found' });
      }
      res.json([...guild.channels.cache.values()].map((c: any) => ({
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
    this.app.get('/api/moderation/cases', async (req: any, res: any) => {
      try {
        const guildId = this.requireGuild(req, res, req.query.guildId as string);
        if (!guildId) return;
        const cases = await this.appRef.moderation.getCases?.(guildId) ?? [];
        res.json(cases);
      } catch (err) {
        res.status(500).json({ error: 'Failed to fetch moderation cases' });
      }
    });

    this.app.post('/api/moderation/warn', async (req: any, res: any) => {
      try {
        const guildId = this.requireGuild(req, res, req.body?.guildId);
        if (!guildId) return;
        const { userId, reason } = req.body ?? {};
        const moderatorId = req.body?.moderatorId || this.requestUser(req)?.id;
        const caseId = await this.appRef.moderation.warn?.(guildId, userId, moderatorId, reason ?? '');
        res.json({ success: true, caseId });
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Failed to warn user' });
      }
    });

    this.app.post('/api/moderation/kick', async (req: any, res: any) => {
      try {
        const guildId = this.requireGuild(req, res, req.body?.guildId);
        if (!guildId) return;
        const { userId, reason } = req.body ?? {};
        const moderatorId = req.body?.moderatorId || this.requestUser(req)?.id;
        const caseId = await this.appRef.moderation.kick?.(guildId, userId, moderatorId, reason ?? '');
        res.json({ success: true, caseId });
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Failed to kick user' });
      }
    });

    this.app.post('/api/moderation/ban', async (req: any, res: any) => {
      try {
        const guildId = this.requireGuild(req, res, req.body?.guildId);
        if (!guildId) return;
        const { userId, reason, deleteMessageDays } = req.body ?? {};
        const moderatorId = req.body?.moderatorId || this.requestUser(req)?.id;
        const caseId = await this.appRef.moderation.ban?.(guildId, userId, moderatorId, reason ?? '', deleteMessageDays ?? 0);
        res.json({ success: true, caseId });
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Failed to ban user' });
      }
    });

    this.app.post('/api/moderation/mute', async (req: any, res: any) => {
      try {
        const guildId = this.requireGuild(req, res, req.body?.guildId);
        if (!guildId) return;
        const { userId, reason, durationMinutes } = req.body ?? {};
        const moderatorId = req.body?.moderatorId || this.requestUser(req)?.id;
        const caseId = await this.appRef.moderation.mute?.(guildId, userId, moderatorId, reason ?? '', durationMinutes ?? 60);
        res.json({ success: true, caseId });
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Failed to mute user' });
      }
    });

    // ---- Economy ----
    // Balances are guild-scoped in the rebuilt economy. The dashboard may pass
    // guildId; otherwise we fall back to the currently selected/first guild so
    // the value shown here matches what /balance shows inside Discord.
    this.app.get('/api/economy/balance/:userId', async (req: any, res: any) => {
      try {
        const guildId = this.requireGuild(req, res, req.query.guildId as string);
        if (!guildId) return;
        const balance = await this.appRef.economy.getBalance(guildId, req.params.userId);
        res.json({ userId: req.params.userId, guildId, balance });
      } catch (err) {
        res.status(500).json({ error: 'Failed to fetch balance' });
      }
    });

    this.app.post('/api/economy/set-balance', async (req: any, res: any) => {
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
        if (!guildId) return;
        const result = await this.appRef.economy.setBalance(guildId, userId, target);
        res.json({ success: true, userId, guildId, balance: result.balance });
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Failed to set balance' });
      }
    });

    // ---- Leveling ----
    this.app.get('/api/leveling/level/:userId', async (req: any, res: any) => {
      try {
        const guildId = this.requireGuild(req, res, req.query.guildId as string);
        if (!guildId) return;
        const data = await this.appRef.leveling.getLevel?.(guildId, req.params.userId);
        if (!data) {
          return res.status(404).json({ error: 'No leveling data found' });
        }
        res.json(data);
      } catch (err) {
        res.status(500).json({ error: 'Failed to fetch level data' });
      }
    });

    this.app.get('/api/leveling/leaderboard', async (req: any, res: any) => {
      try {
        const guildId = this.requireGuild(req, res, req.query.guildId as string);
        if (!guildId) return;
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
        const leaderboard = await this.appRef.leveling.getLeaderboard?.(guildId, limit) ?? [];
        res.json(leaderboard);
      } catch (err) {
        res.status(500).json({ error: 'Failed to fetch leaderboard' });
      }
    });

    this.app.post('/api/leveling/set-xp', async (req: any, res: any) => {
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
        if (!guildId) return;
        const result = await this.appRef.leveling.setXP?.(guildId, userId, amount);
        if (!result) {
          return res.status(500).json({ error: 'Leveling service unavailable' });
        }
        res.json({ success: true, userId, xp: result.totalXP, level: result.level });
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Failed to set XP' });
      }
    });

    // ---- Guild Settings (module toggles) ----
    // Must be registered BEFORE the generic /api/config/:service routes below.
    this.app.get('/api/config/guild_settings', async (req: any, res: any) => {
      try {
        const guildId = this.requireGuild(req, res, req.query.guildId as string | undefined);
        if (!guildId) return;
        const settings = await this.readGuildSettings(guildId);
        res.json(settings ?? this.defaultGuildSettings(guildId));
      } catch (err) {
        this.logger.error('Web Server', 'GET guild_settings failed', err as Error);
        res.status(500).json({ error: 'Failed to read guild settings' });
      }
    });

    this.app.post('/api/config/guild_settings', async (req: any, res: any) => {
      try {
        const body = req.body ?? {};
        const guildId = this.requireGuild(req, res, body.guildId);
        if (!guildId) return;
        const saved = await this.writeGuildSettings(guildId, body);
        this.applyModuleToggles(saved);
        res.json({ success: true, config: saved });
      } catch (err: any) {
        this.logger.error('Web Server', 'POST guild_settings failed', err);
        res.status(500).json({ error: err.message || 'Failed to save module settings' });
      }
    });

    // ---- Config ----
    this.app.get('/api/config/:service', (_req: any, res: any) => {
      const service = _req.params.service;
      if (!WebServer.CONFIG_SERVICES.includes(service)) {
        return res.status(404).json({ error: `Unknown service: ${service}` });
      }
      try {
        const cfg = this.getServiceConfig(service);
        res.json(cfg ?? {});
      } catch (err) {
        this.logger.error('Web Server', `GET /api/config/${service} failed`, err as Error);
        res.status(500).json({ error: `Failed to fetch ${service} config` });
      }
    });

    this.app.post('/api/config/:service', (req: any, res: any) => {
      const service = req.params.service;
      if (!WebServer.CONFIG_SERVICES.includes(service)) {
        return res.status(404).json({ error: `Unknown service: ${service}` });
      }
      try {
        const config = req.body ?? {};
        this.setServiceConfig(service, config);
        res.json({ success: true, config: this.getServiceConfig(service) ?? {} });
      } catch (err: any) {
        this.logger.error('Web Server', `POST /api/config/${service} failed`, err);
        res.status(500).json({ error: err.message || `Failed to update ${service} config` });
      }
    });

    // ---- Panels: custom emoji server, mapping and live preview ----
    this.app.get('/api/panels/emojis', (_req: any, res: any) => {
      try {
        const overview = this.appRef.panels?.getEmojiOverview?.() ?? { count: 0, guild: '', custom: [], resolved: {} };
        res.json(overview);
      } catch (err) {
        this.logger.error('Web Server', 'GET /api/panels/emojis failed', err as Error);
        res.status(500).json({ error: 'Failed to fetch panel emoji' });
      }
    });

    this.app.post('/api/panels/refresh-emojis', async (_req: any, res: any) => {
      try {
        const count = await this.appRef.panels?.refreshEmojis?.() ?? 0;
        const stats = this.appRef.panels?.getEmojiStats?.() ?? { count, guild: '' };
        res.json({ success: true, count, guild: stats.guild });
      } catch (err) {
        this.logger.error('Web Server', 'POST /api/panels/refresh-emojis failed', err as Error);
        res.status(500).json({ error: (err as Error).message || 'Failed to refresh emoji' });
      }
    });

    // ---- Cards: welcome + rank templates (web editor) ----
    // Dedicated routes before the generic /api/config/:service fallback.
    // GET returns the live templates; preview renders server-side PNG and
    // returns it as base64 so the browser editor can show it live.
    this.app.get('/api/cards/config', (_req: any, res: any) => {
      try {
        const cfg = this.appRef.cards?.getConfig?.() ?? getDefaultCardConfig();
        res.json(cfg);
      } catch (err) {
        res.status(500).json({ error: 'Failed to fetch card config' });
      }
    });

    this.app.put('/api/cards/config', (req: any, res: any) => {
      try {
        const saved = this.appRef.cards?.setConfig?.(req.body ?? {}) ?? getDefaultCardConfig();
        this.persistServiceConfig('cards');
        res.json({ success: true, config: saved });
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Failed to save card config' });
      }
    });

    this.app.post('/api/cards/preview', async (req: any, res: any) => {
      try {
        const { type, template, sample } = req.body ?? {};
        const base = this.appRef.cards?.getConfig?.() ?? getDefaultCardConfig();
        const merged = { ...base, ...(template ?? {}) };

        if (type === 'welcome') {
          const s = sample ?? {};
          const buffer = await welcomeCard.generate({
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
          const buffer = await rankCard.generate({
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
          const buffer = await leaderboardCard.generate(rows, sample?.guildName || 'Test Server', '🏆 Top members', merged.leaderboard);
          res.set('Content-Type', 'image/png');
          res.send(buffer);
          return;
        }

        res.status(400).json({ error: 'type must be welcome | rank | leaderboard' });
      } catch (err: any) {
        this.logger.error('Web Server', 'POST /api/cards/preview failed', err);
        res.status(500).json({ error: err.message || 'Preview failed' });
      }
    });

    this.app.post('/api/cards/test', async (req: any, res: any) => {
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
        const base = this.appRef.cards?.getConfig?.() ?? getDefaultCardConfig();

        if (type === 'welcome') {
          const buffer = await welcomeCard.generate({
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
          const buffer = await rankCard.generate({
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
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Test send failed' });
      }
    });

    // ---- Community (welcome/goodbye) ----
    this.app.get('/api/config/community', (_req: any, res: any) => {
      try {
        const cfg = this.appRef.community?.getConfig?.() ?? null;
        res.json(cfg ?? {});
      } catch (err) {
        res.status(500).json({ error: 'Failed to fetch community config' });
      }
    });

    this.app.post('/api/config/community', (req: any, res: any) => {
      try {
        const current = this.appRef.community?.getConfig?.();
        if (!current) return res.status(404).json({ error: 'Community service not available' });
        const incoming = req.body ?? {};
        // Merge welcome/goodbye/autoroles safely (only known keys)
        for (const section of ['welcome', 'goodbye', 'autoroles'] as const) {
          if (incoming[section] && typeof incoming[section] === 'object') {
            for (const k of Object.keys(incoming[section])) {
              if (k in current[section]) {
                const prev = current[section][k];
                const val = (incoming[section] as any)[k];
                if (typeof prev === 'boolean') (current[section] as any)[k] = Boolean(val);
                else if (typeof prev === 'string') (current[section] as any)[k] = String(val ?? '');
                else (current[section] as any)[k] = val;
              }
            }
          }
        }
        this.appRef.community.setConfig(current);
        this.persistServiceConfig('community');
        res.json({ success: true, config: current });
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Failed to update community config' });
      }
    });

    // ---- Logs ----
    this.app.get('/api/logs', (_req: any, res: any) => {
      const level = _req.query.level as any;
      const limit = parseInt(_req.query.limit as string) || 100;
      res.json(this.appRef.logger.getLogs?.(level, limit) ?? []);
    });

    this.app.delete('/api/logs', (_req: any, res: any) => {
      this.appRef.logger.clearLogs?.();
      res.json({ success: true });
    });

    // ---- System / Server ----
    this.app.get('/api/system/info', (_req: any, res: any) => {
      const cpus = os.cpus();
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
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
        loadavg: os.loadavg(),
        networkInterfaces: os.networkInterfaces(),
      });
    });

    this.app.get('/api/system/processes', (_req: any, res: any) => {
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
    this.app.post('/api/control/restart', (_req: any, res: any) => {
      res.json({ success: true, message: 'Restarting...' });
      setTimeout(() => {
        process.exit(0);
      }, 1000);
    });

    this.app.post('/api/control/shutdown', (_req: any, res: any) => {
      res.json({ success: true, message: 'Shutting down...' });
      setTimeout(() => {
        process.exit(0);
      }, 1000);
    });

    this.app.post('/api/control/reload-commands', (_req: any, res: any) => {
      try {
        this.appRef.commands.reloadCommands?.();
        res.json({ success: true, message: 'Commands reloaded' });
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Failed to reload commands' });
      }
    });

    this.app.post('/api/control/presence', (req: any, res: any) => {
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
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Failed to set presence' });
      }
    });

    // ---- System operations (dashboard coverage for every module) ----

    this.app.get('/api/systems/overview', async (req: any, res: any) => {
      try {
        const sqlite = this.sqliteOrNull();
        if (!sqlite) return res.json({ guildId: null, counts: {}, systems: [] });
        const user = this.requestUser(req);
        const scoped = this.scopeGuildIds(req);
        const isGlobal = this.auth.disabled || Boolean(user?.isOwner);
        const guildId = req.query.guildId ? this.requireGuild(req, res, req.query.guildId as string) : null;
        if (req.query.guildId && !guildId) return;
        const ids = guildId ? [guildId] : scoped;
        const where = `WHERE ${ids.length ? `guild_id IN (${ids.map((id) => `'${id}'`).join(',')})` : isGlobal ? '1=1' : '1=0'}`;
        const tableWhere = (table: string) => `WHERE ${ids.length ? `${table}.guild_id IN (${ids.map((id) => `'${id}'`).join(',')})` : isGlobal ? '1=1' : '1=0'}`;
        const count = (sql: string) => Number(this.safeGet(sqlite, sql)?.c ?? 0);

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
      } catch (err) {
        this.logger.error('Web Server', 'GET /api/systems/overview failed', err as Error);
        res.status(500).json({ error: 'Failed to build systems overview' });
      }
    });

    // ---- Tickets ----
    this.app.get('/api/tickets', async (req: any, res: any) => {
      try {
        const guildId = this.requireGuild(req, res, req.query.guildId as string);
        if (!guildId) return;
        const status = String(req.query.status || 'all');
        const sqlite = this.sqliteOrNull();
        if (!sqlite) return res.json([]);
        const filter = status === 'open' || status === 'closed' ? ` AND t.status = '${status}'` : '';
        const rows = this.safeAll(
          sqlite,
          `SELECT t.*, u.username AS user_name, a.username AS assignee_name
           FROM tickets t
           LEFT JOIN users u ON u.id = t.user_id
           LEFT JOIN users a ON a.id = t.assigned_to
           WHERE t.guild_id = ?${filter}
           ORDER BY t.created_at DESC LIMIT 250`,
          [guildId],
        );
        res.json(rows.map((t: any) => ({
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
      } catch (err) {
        this.logger.error('Web Server', 'GET /api/tickets failed', err as Error);
        res.status(500).json({ error: 'Failed to load tickets' });
      }
    });

    this.app.post('/api/tickets/:id/:action', async (req: any, res: any) => {
      try {
        const ticket = await this.appRef.tickets?.getTicket?.(req.params.id);
        if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
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
      } catch (err: any) {
        res.status(400).json({ error: err.message || 'Ticket action failed' });
      }
    });

    // ---- Giveaways ----
    this.app.get('/api/giveaways', async (req: any, res: any) => {
      try {
        const guildId = this.requireGuild(req, res, req.query.guildId as string);
        if (!guildId) return;
        const list = await this.appRef.giveaways?.listGiveaways?.(guildId) ?? [];
        res.json(list.map((g: any) => ({
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
      } catch (err) {
        this.logger.error('Web Server', 'GET /api/giveaways failed', err as Error);
        res.status(500).json({ error: 'Failed to load giveaways' });
      }
    });

    this.app.post('/api/giveaways/:id/:action', async (req: any, res: any) => {
      try {
        const giveaway = await this.appRef.giveaways?.getGiveaway?.(req.params.id);
        if (!giveaway) return res.status(404).json({ error: 'Giveaway not found' });
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
      } catch (err: any) {
        res.status(400).json({ error: err.message || 'Giveaway action failed' });
      }
    });

    // ---- Economy games ----
    this.app.get('/api/games', async (req: any, res: any) => {
      try {
        const guildId = this.requireGuild(req, res, req.query.guildId as string);
        if (!guildId) return;
        const sqlite = this.sqliteOrNull();
        if (!sqlite) return res.json([]);
        const rows = this.safeAll(
          sqlite,
          `SELECT g.*, (SELECT COUNT(*) FROM economy_game_players p WHERE p.game_id = g.id) AS player_count
           FROM economy_games g WHERE g.guild_id = ?
           ORDER BY g.created_at DESC LIMIT 200`,
          [guildId],
        );
        res.json(rows.map((g: any) => ({
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
      } catch (err) {
        this.logger.error('Web Server', 'GET /api/games failed', err as Error);
        res.status(500).json({ error: 'Failed to load games' });
      }
    });

    this.app.post('/api/games/:id/end', async (req: any, res: any) => {
      try {
        const game = await this.appRef.economyGames?.getGameAsync?.(req.params.id);
        if (!game) return res.status(404).json({ error: 'Game not found' });
        if (!this.auth.canAccessGuild(this.requestUser(req), game.guildId)) {
          return res.status(403).json({ error: 'guild_forbidden' });
        }
        const result = await this.appRef.economyGames.endGame(game.id);
        res.json({ success: true, ...result });
      } catch (err: any) {
        res.status(400).json({ error: err.message || 'Could not end the game' });
      }
    });

    // ---- Staff applications ----
    this.app.get('/api/staffapps', async (req: any, res: any) => {
      try {
        const guildId = this.requireGuild(req, res, req.query.guildId as string);
        if (!guildId) return;
        const status = String(req.query.status || 'all');
        const sqlite = this.sqliteOrNull();
        if (!sqlite) return res.json([]);
        const filter = ['pending', 'approved', 'denied'].includes(status) ? ` AND s.status = '${status}'` : '';
        const rows = this.safeAll(
          sqlite,
          `SELECT s.*, u.username AS user_name
           FROM staff_applications s
           LEFT JOIN users u ON u.id = s.user_id
           WHERE s.guild_id = ?${filter}
           ORDER BY s.created_at DESC LIMIT 250`,
          [guildId],
        );
        const parse = (value: any) => {
          if (Array.isArray(value)) return value;
          try { return JSON.parse(value || '[]'); } catch { return []; }
        };
        res.json(rows.map((s: any) => ({
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
      } catch (err) {
        this.logger.error('Web Server', 'GET /api/staffapps failed', err as Error);
        res.status(500).json({ error: 'Failed to load applications' });
      }
    });

    this.app.post('/api/staffapps/:id/:action', async (req: any, res: any) => {
      try {
        const action = req.params.action;
        if (action !== 'approve' && action !== 'deny') {
          return res.status(400).json({ error: 'Unknown application action' });
        }
        const sqlite = this.sqliteOrNull();
        const row = sqlite ? this.safeGet(sqlite, 'SELECT guild_id FROM staff_applications WHERE id = ?', [req.params.id]) : null;
        if (!row) return res.status(404).json({ error: 'Application not found' });
        if (!this.auth.canAccessGuild(this.requestUser(req), String(row.guild_id))) {
          return res.status(403).json({ error: 'guild_forbidden' });
        }
        const reviewer = this.requestUser(req)?.id || 'dashboard';
        const result = await this.appRef.staffapps.reviewApplication(req.params.id, reviewer, action, String(req.body?.reason || ''));
        if (!result.ok) return res.status(400).json({ error: result.message });
        res.json({ success: true, message: result.message });
      } catch (err: any) {
        res.status(400).json({ error: err.message || 'Application review failed' });
      }
    });

    // ---- Temporary voice ----
    this.app.get('/api/tempvc', async (req: any, res: any) => {
      try {
        const guildId = this.requireGuild(req, res, req.query.guildId as string);
        if (!guildId) return;
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
          instances: rows.map((i: any) => ({
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
      } catch (err) {
        this.logger.error('Web Server', 'GET /api/tempvc failed', err as Error);
        res.status(500).json({ error: 'Failed to load temp voice data' });
      }
    });

    this.app.delete('/api/tempvc/:channelId', async (req: any, res: any) => {
      try {
        const sqlite = this.sqliteOrNull();
        const row = sqlite ? this.safeGet(sqlite, 'SELECT * FROM tempvc_instances WHERE channel_id = ?', [req.params.channelId]) : null;
        if (!row) return res.status(404).json({ error: 'Temp voice channel not found' });
        if (!this.auth.canAccessGuild(this.requestUser(req), String(row.guild_id))) {
          return res.status(403).json({ error: 'guild_forbidden' });
        }
        await this.appRef.tempvc.deleteTempVC(req.params.channelId);
        res.json({ success: true });
      } catch (err: any) {
        res.status(400).json({ error: err.message || 'Could not delete the channel' });
      }
    });

    // ---- Community (per-guild welcome / goodbye / autoroles) ----
    this.app.get('/api/community', async (req: any, res: any) => {
      try {
        const guildId = this.requireGuild(req, res, req.query.guildId as string);
        if (!guildId) return;
        const row = await this.readGuildSettings(guildId);
        const globalConfig = this.appRef.community?.getConfig?.() ?? {};
        const roles = (() => {
          const value = row?.autorole_ids;
          if (Array.isArray(value)) return value.map(String);
          try { return JSON.parse(value || '[]').map(String); } catch { return []; }
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
      } catch (err) {
        this.logger.error('Web Server', 'GET /api/community failed', err as Error);
        res.status(500).json({ error: 'Failed to load community settings' });
      }
    });

    this.app.post('/api/community', async (req: any, res: any) => {
      try {
        const guildId = this.requireGuild(req, res, req.body?.guildId);
        if (!guildId) return;
        const body = req.body ?? {};
        const patch: any = {};
        if (body.welcome) {
          if (body.welcome.enabled !== undefined) patch.welcome_enabled = Boolean(body.welcome.enabled);
          if (body.welcome.channel !== undefined) patch.welcome_channel_id = String(body.welcome.channel);
          if (body.welcome.message !== undefined) patch.welcome_message = String(body.welcome.message);
        }
        if (body.goodbye) {
          if (body.goodbye.enabled !== undefined) patch.goodbye_enabled = Boolean(body.goodbye.enabled);
          if (body.goodbye.channel !== undefined) patch.goodbye_channel_id = String(body.goodbye.channel);
          if (body.goodbye.message !== undefined) patch.goodbye_message = String(body.goodbye.message);
        }
        if (body.autoroles) {
          if (body.autoroles.enabled !== undefined) patch.autoroles_enabled = Boolean(body.autoroles.enabled);
          if (Array.isArray(body.autoroles.roleIds)) patch.autorole_ids = body.autoroles.roleIds.map(String);
        }
        await this.writeGuildSettings(guildId, patch);
        res.json({ success: true });
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Failed to save community settings' });
      }
    });

    // ---- Automation jobs ----
    this.app.get('/api/automation', async (req: any, res: any) => {
      try {
        const guildId = this.requireGuild(req, res, req.query.guildId as string);
        if (!guildId) return;
        const jobs = await this.appRef.automation?.listJobs?.(guildId) ?? [];
        res.json(jobs.map((job: any) => ({
          ...job,
          lastRun: job.lastRun ? new Date(job.lastRun).toISOString() : null,
          nextRun: job.nextRun ? new Date(job.nextRun).toISOString() : null,
        })));
      } catch (err) {
        this.logger.error('Web Server', 'GET /api/automation failed', err as Error);
        res.status(500).json({ error: 'Failed to load automation jobs' });
      }
    });

    this.app.post('/api/automation', async (req: any, res: any) => {
      try {
        const guildId = this.requireGuild(req, res, req.body?.guildId);
        if (!guildId) return;
        const { type, cron, channelId, message, title, description, color } = req.body ?? {};
        if (!type || !cron) return res.status(400).json({ error: 'type and cron are required' });
        const jobConfig: any = { channelId: String(channelId || '') };
        if (type === 'message') jobConfig.message = String(message || '');
        if (type === 'embed') {
          jobConfig.title = String(title || '');
          jobConfig.description = String(description || message || '');
          jobConfig.color = String(color || '#5865f2');
        }
        if (type === 'log') jobConfig.message = String(message || 'Scheduled log tick');
        const id = await this.appRef.automation.addJob({
          guildId,
          type: String(type),
          cronExpression: String(cron),
          enabled: true,
          config: jobConfig,
        });
        res.json({ success: true, id });
      } catch (err: any) {
        res.status(400).json({ error: err.message || 'Could not create the job' });
      }
    });

    this.app.post('/api/automation/:id/:action', async (req: any, res: any) => {
      try {
        const sqlite = this.sqliteOrNull();
        const row = sqlite ? this.safeGet(sqlite, 'SELECT guild_id, enabled FROM automation_jobs WHERE id = ?', [req.params.id]) : null;
        if (!row) return res.status(404).json({ error: 'Job not found' });
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
      } catch (err: any) {
        res.status(400).json({ error: err.message || 'Automation action failed' });
      }
    });

    // ---- AI ----
    this.app.get('/api/ai/status', async (_req: any, res: any) => {
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
      } catch (err) {
        this.logger.error('Web Server', 'GET /api/ai/status failed', err as Error);
        res.status(500).json({ error: 'Failed to read AI status' });
      }
    });

    this.app.get('/api/ai/conversations', async (req: any, res: any) => {
      try {
        const guildId = this.requireGuild(req, res, req.query.guildId as string);
        if (!guildId) return;
        const sqlite = this.sqliteOrNull();
        if (!sqlite) return res.json([]);
        const rows = this.safeAll(
          sqlite,
          `SELECT id, guild_id, user_id, channel_id, provider, model, messages, created_at, updated_at
           FROM ai_conversations WHERE guild_id = ? ORDER BY updated_at DESC LIMIT 50`,
          [guildId],
        );
        res.json(rows.map((row: any) => {
          let count = 0;
          try {
            const parsed = typeof row.messages === 'string' ? JSON.parse(row.messages) : row.messages;
            count = Array.isArray(parsed) ? parsed.length : 0;
          } catch { count = 0; }
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
      } catch (err) {
        this.logger.error('Web Server', 'GET /api/ai/conversations failed', err as Error);
        res.status(500).json({ error: 'Failed to load conversations' });
      }
    });

    this.app.post('/api/ai/test', async (req: any, res: any) => {
      try {
        const prompt = String(req.body?.prompt || '').trim();
        if (!prompt) return res.status(400).json({ error: 'prompt is required' });
        if (!this.appRef.ai?.testAsk) return res.status(503).json({ error: 'AI service unavailable' });
        const client = this.appRef.getClient?.();
        const guild = req.body?.guildId ? client?.guilds?.cache?.get(String(req.body.guildId)) : undefined;
        const channel = req.body?.channelId ? guild?.channels?.cache?.get(String(req.body.channelId)) : undefined;
        const started = Date.now();
        const result = await this.appRef.ai.testAsk(prompt, guild, channel);
        res.json({ success: true, latencyMs: Date.now() - started, ...result });
      } catch (err: any) {
        res.status(400).json({ error: err.message || 'AI request failed' });
      }
    });

    // ---- Music ----
    this.app.get('/api/music/status', async (_req: any, res: any) => {
      try {
        const status = this.appRef.music?.getStatus?.() ?? { enabled: false, ready: false, players: [] };
        res.json(status);
      } catch (err) {
        this.logger.error('Web Server', 'GET /api/music/status failed', err as Error);
        res.status(500).json({ error: 'Failed to read music status' });
      }
    });

    this.app.get('/api/music/queue', async (req: any, res: any) => {
      try {
        const guildId = this.requireGuild(req, res, req.query.guildId as string);
        if (!guildId) return;
        const music = this.appRef.music;
        if (!music) return res.json({ ready: false, nowPlaying: null, queue: [], session: null });
        const [nowPlaying, queue, session] = await Promise.all([
          music.getNowPlaying?.(guildId).catch(() => null) ?? null,
          music.getQueue?.(guildId).catch(() => []) ?? [],
          music.getSession?.(guildId).catch(() => null) ?? null,
        ]);
        res.json({ ready: Boolean(music.isReady), nowPlaying, queue, session });
      } catch (err: any) {
        res.json({ ready: false, nowPlaying: null, queue: [], session: null, error: err.message });
      }
    });

    this.app.post('/api/music/controls', async (req: any, res: any) => {
      try {
        const guildId = this.requireGuild(req, res, req.body?.guildId);
        if (!guildId) return;
        const action = String(req.body?.action || '');
        const music = this.appRef.music;
        if (!music) return res.status(503).json({ error: 'Music service unavailable' });
        switch (action) {
          case 'skip': await music.skip(guildId); break;
          case 'stop': await music.stop(guildId); break;
          case 'pause': await music.pause(guildId); break;
          case 'resume': await music.resume(guildId); break;
          case 'volume': {
            const volume = Math.max(0, Math.min(200, Number(req.body?.volume ?? 50)));
            await music.setVolume(guildId, volume);
            break;
          }
          default:
            return res.status(400).json({ error: 'Unknown music action' });
        }
        res.json({ success: true });
      } catch (err: any) {
        res.status(400).json({ error: err.message || 'Music action failed' });
      }
    });

    // ---- Analytics ----
    this.app.get('/api/analytics', async (req: any, res: any) => {
      try {
        const user = this.requestUser(req);
        const canSeeGlobal = this.auth.disabled || Boolean(user?.isOwner);
        let guildId = req.query.guildId ? String(req.query.guildId) : '';
        if (guildId) {
          const checked = this.requireGuild(req, res, guildId);
          if (!checked) return;
          guildId = checked;
        } else if (!canSeeGlobal) {
          const checked = this.requireGuild(req, res);
          if (!checked) return;
          guildId = checked;
        }
        const days = Math.min(60, Math.max(1, parseInt(req.query.days as string) || 14));
        const [stats, series] = await Promise.all([
          guildId ? this.appRef.analytics?.getGuildStats?.(guildId) : this.appRef.analytics?.getStats?.(),
          this.appRef.analytics?.getActivitySeries?.(guildId || undefined, days) ?? [],
        ]);
        res.json({ guildId: guildId || null, global: !guildId, stats: stats ?? {}, series });
      } catch (err) {
        this.logger.error('Web Server', 'GET /api/analytics failed', err as Error);
        res.status(500).json({ error: 'Failed to load analytics' });
      }
    });

    // ---- Fallbacks (must be last) ----
    // JSON 404 for unknown API routes instead of Express' default HTML page
    this.app.use('/api', (_req: any, res: any) => {
      this.logger.warn('Web Server', `Unknown API route: ${_req.method} ${_req.originalUrl}`);
      res.status(404).json({ error: 'Not found' });
    });

    // Error handler — log it so failures are visible in the console
    this.app.use((err: any, _req: any, res: any, _next: any) => {
      this.logger.error('Web Server', `Unhandled error: ${err?.message}`, err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
      }
    });
  }

  /** Raw sqlite handle when the database has finished initialising, else null. */
  private sqliteOrNull(): any {
    try {
      return this.appRef.database?.getSqlite?.() ?? null;
    } catch {
      return null;
    }
  }

  private safeAll(sqlite: any, sql: string, params: any[] = []): any[] {
    try {
      return sqlite.prepare(sql).all(...params) ?? [];
    } catch (err) {
      this.logger.warn('Web Server', `Query failed: ${(err as Error).message}`);
      return [];
    }
  }

  private safeGet(sqlite: any, sql: string, params: any[] = []): any {
    try {
      return sqlite.prepare(sql).get(...params) ?? null;
    } catch {
      return null;
    }
  }

  /** Convert a stored timestamp (seconds or milliseconds) to ISO. */
  private toIso(value: any): string | null {
    const n = Number(value ?? 0);
    if (!Number.isFinite(n) || n <= 0) return null;
    const ms = n > 1_000_000_000_000 ? n : n * 1000;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  private buildActivityDays(days = 7): any[] {
    const buckets: any[] = [];
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

  private bucketActivity(
    sqlite: any,
    table: string,
    key: 'messages' | 'moderation' | 'users',
    buckets: any[],
    sinceMs: number,
  ): void {
    const maxRow = this.safeGet(sqlite, `SELECT MAX(created_at) AS m FROM ${table}`);
    const max = Number(maxRow?.m ?? 0);
    const storedInMs = max > 1_000_000_000_000;
    const threshold = Math.floor(storedInMs ? sinceMs : sinceMs / 1000);
    const rows = this.safeAll(sqlite, `SELECT created_at FROM ${table} WHERE created_at >= ?`, [threshold]);
    const byDate = new Map(buckets.map((b) => [b.date, b]));
    for (const row of rows) {
      const iso = this.toIso(row.created_at);
      if (!iso) continue;
      const bucket = byDate.get(iso.slice(0, 10));
      if (bucket) bucket[key] += 1;
    }
  }

  private buildEconomyStats(sqlite: any): any {
    const totals = this.safeGet(
      sqlite,
      `SELECT COALESCE(SUM(balance), 0) AS total,
              SUM(CASE WHEN balance > 0 THEN 1 ELSE 0 END) AS funded,
              COUNT(*) AS tracked
       FROM economy_accounts`,
    ) ?? {};
    const txn = this.safeGet(sqlite, `SELECT COUNT(*) AS c FROM economy_transactions`) ?? {};
    const recent = this.safeAll(
      sqlite,
      `SELECT t.id, t.user_id, t.type, t.amount, t.description, t.created_at,
              u.username AS user_name
       FROM economy_transactions t
       LEFT JOIN users u ON u.id = t.user_id
       ORDER BY t.created_at DESC
       LIMIT 8`,
    ).map((t: any) => ({
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

  private static readonly CONFIG_SERVICES = [
    'bot', 'leveling', 'ai', 'music', 'moderation', 'economy', 'automation', 'analytics', 'tempvc', 'web', 'cards', 'community', 'tickets', 'staffapps', 'panels',
  ];

  /** Raw (unmasked) config object for a service, or null if unavailable. */
  private rawServiceConfig(service: string): any {
    const app: any = this.appRef;
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
        return app.cards?.getConfig?.() ?? getDefaultCardConfig();
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
  private getServiceConfig(service: string): any {
    const raw = this.rawServiceConfig(service);
    if (raw === null || raw === undefined) return null;
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
  private deepAssignConfig(target: any, source: any): void {
    if (!target || typeof target !== 'object' || !source || typeof source !== 'object' || Array.isArray(source)) return;
    for (const key of Object.keys(source)) {
      if (!(key in target)) continue;
      const current = target[key];
      const incoming = source[key];
      if (current && typeof current === 'object' && !Array.isArray(current)) {
        if (incoming && typeof incoming === 'object' && !Array.isArray(incoming)) {
          this.deepAssignConfig(current, incoming);
        }
      } else if (Array.isArray(current)) {
        if (Array.isArray(incoming)) target[key] = incoming;
      } else if (typeof current === 'boolean') {
        target[key] = Boolean(incoming);
      } else if (typeof current === 'number') {
        const n = Number(incoming);
        if (Number.isFinite(n)) target[key] = n;
      } else if (typeof current === 'string') {
        target[key] = String(incoming ?? '');
      } else if (current === null) {
        target[key] = incoming;
      }
    }
  }

  private setServiceConfig(service: string, incoming: any): void {
    const app: any = this.appRef;
    switch (service) {
      case 'bot': {
        const target = { prefix: app.config?.commands?.prefix ?? '!' };
        this.deepAssignConfig(target, incoming);
        if (app.config?.commands) app.config.commands.prefix = target.prefix;
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
        const current = app.cards?.getConfig?.() ?? getDefaultCardConfig();
        const next = JSON.parse(JSON.stringify(current));
        this.deepAssignConfig(next, incoming);
        app.cards?.setConfig?.(next);
        break;
      }
      case 'community': {
        const current = app.community?.getConfig?.();
        if (!current) throw new Error('community config is not available');
        for (const section of ['welcome', 'goodbye', 'autoroles'] as const) {
          if (incoming[section] && typeof incoming[section] === 'object') {
            for (const k of Object.keys(incoming[section])) {
              if (k in (current as any)[section]) {
                const prev = (current as any)[section][k];
                const val = (incoming[section] as any)[k];
                if (typeof prev === 'boolean') (current as any)[section][k] = Boolean(val);
                else if (typeof prev === 'number') {
                  const n = Number(val);
                  if (Number.isFinite(n)) (current as any)[section][k] = n;
                } else if (typeof prev === 'string') (current as any)[section][k] = String(val ?? '');
                else (current as any)[section][k] = val;
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
      case 'leveling': case 'ai': case 'moderation':
      case 'economy': case 'automation': case 'analytics': {
        const target = app[service]?.config;
        if (!target) throw new Error(`${service} config is not available`);
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

  private getServiceConfigsDb(): any | null {
    try {
      return this.appRef.database?.getSqlite?.() ?? null;
    } catch {
      return null;
    }
  }

  /** Persist the raw (unmasked) config into `service_configs` so it survives restarts. */
  private persistServiceConfig(service: string): void {
    try {
      const sqlite = this.getServiceConfigsDb();
      if (!sqlite) return;
      const raw = this.rawServiceConfig(service);
      if (!raw) return;
      sqlite.prepare(
        `INSERT INTO service_configs (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      ).run(service, JSON.stringify(raw), Date.now());
    } catch (err) {
      this.logger.warn('Web Server', `Could not persist ${service} config: ${(err as Error).message}`);
    }
  }

  /**
   * Apply dashboard-persisted config overrides on top of the env defaults.
   * Called from SukunaApp.initialize() after the database is ready.
   */
  public async loadPersistedConfigs(): Promise<void> {
    try {
      const sqlite = this.getServiceConfigsDb();
      if (!sqlite) {
        this.logger.warn('Web Server', 'Skipping persisted config load: database not ready');
        return;
      }
      const rows = sqlite.prepare('SELECT key, value FROM service_configs').all() as any[];
      let applied = 0;
      for (const row of rows) {
        try {
          const saved = JSON.parse(row.value);
          if (!saved || typeof saved !== 'object' || Array.isArray(saved)) continue;
          if (row.key === 'tempvc') {
            const app: any = this.appRef;
            const base = app.tempvc?.getConfig?.() ?? { enabled: true, createChannelId: '', categoryId: '', panelChannelId: '', panelMessageId: '' };
            const next = { ...base };
            this.deepAssignConfig(next, saved);
            app.tempvc?.setConfig?.(next);
          } else if (row.key === 'bot') {
            const app: any = this.appRef;
            if (app.config?.commands && saved.prefix) app.config.commands.prefix = saved.prefix;
          } else if (row.key === 'web') {
            continue; // live port stays host-bound (SERVER_PORT)
          } else if (row.key === 'cards') {
            const app: any = this.appRef;
            const current = app.cards?.getConfig?.() ?? getDefaultCardConfig();
            const next = JSON.parse(JSON.stringify(current));
            this.deepAssignConfig(next, saved);
            app.cards?.setConfig?.(next);
          } else if (row.key === 'community') {
            const app: any = this.appRef;
            const current = app.community?.getConfig?.();
            if (current) {
              for (const section of ['welcome', 'goodbye', 'autoroles'] as const) {
                if (saved[section] && typeof saved[section] === 'object') {
                  for (const k of Object.keys(saved[section])) {
                    if (k in (current as any)[section]) {
                      const prev = (current as any)[section][k];
                      const val = saved[section][k];
                      if (typeof prev === 'boolean') (current as any)[section][k] = Boolean(val);
                      else if (typeof prev === 'number') {
                        const n = Number(val);
                        if (Number.isFinite(n)) (current as any)[section][k] = n;
                      } else if (typeof prev === 'string') (current as any)[section][k] = String(val ?? '');
                      else (current as any)[section][k] = val;
                    }
                  }
                }
              }
              app.community.setConfig(current);
            }
          } else if (row.key === 'tickets') {
            const app: any = this.appRef;
            const current = app.tickets?.getConfig?.() ?? { enabled: true, category: '', supportRoles: [], closeVote: false };
            const next = JSON.parse(JSON.stringify(current));
            this.deepAssignConfig(next, saved);
            app.tickets?.setConfig?.(next);
          } else if (row.key === 'staffapps') {
            const app: any = this.appRef;
            app.staffapps?.setConfig?.(saved);
          } else if (row.key === 'panels') {
            const app: any = this.appRef;
            const current = app.panels?.getConfig?.() ?? {};
            const next = { ...current };
            this.deepAssignConfig(next, saved);
            app.panels?.setConfig?.(next);
          } else {
            const target = (this.appRef as any)?.[row.key]?.config;
            if (!target) continue;
            this.deepAssignConfig(target, saved);
            if (row.key === 'leveling' && typeof (this.appRef as any).leveling?.refreshLegacyAliases === 'function') {
              (this.appRef as any).leveling.refreshLegacyAliases();
            }
          }
          applied++;
        } catch (err) {
          this.logger.warn('Web Server', `Skipping invalid persisted config '${row.key}': ${(err as Error).message}`);
        }
      }
      if (applied) this.logger.info('Web Server', `Applied ${applied} persisted service config(s) from database`);
    } catch (err) {
      this.logger.error('Web Server', 'Failed to load persisted configs', err as Error);
    }
  }

  private resolveGuildId(explicit?: string, user?: DashboardUser | null): string {
    if (explicit) return explicit;
    try {
      const client = this.appRef.getClient?.();
      const guilds: any[] = client?.guilds?.cache ? [...client.guilds.cache.values()] : [];
      const allowed = user ? this.auth.filterGuilds(user, guilds.map((g) => String(g.id))) : guilds.map((g) => String(g.id));
      const firstAllowed = guilds.find((g) => allowed.includes(String(g.id)));
      if (firstAllowed) return String(firstAllowed.id);
      if (guilds[0]) return String(guilds[0].id);
    } catch {
      // Discord client not ready yet — fall through to the default bucket
    }
    return 'global';
  }

  private requestUser(req: any): DashboardUser | null {
    return (req?.dashboardUser as DashboardUser | undefined) ?? null;
  }

  /** Guild ids the current user is allowed to query, scoped to the bot's guilds. */
  private scopeGuildIds(req: any): string[] {
    const client = this.appRef.getClient?.();
    const all: string[] = client?.guilds?.cache ? [...client.guilds.cache.keys()].map(String) : [];
    const user = this.requestUser(req);
    if (!user) return [];
    if (this.auth.disabled || user.isOwner) return all;
    return all.filter((id) => user.guildIds.includes(id));
  }

  /**
   * Resolve the guild for a request and enforce per-guild authorization.
   * Returns null after writing a 400/403 response.
   */
  private requireGuild(req: any, res: any, explicit?: string): string | null {
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

  private defaultGuildSettings(guildId: string): any {
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

  private async readGuildSettings(guildId: string): Promise<any | null> {
    try {
      const db = this.appRef.database?.getDb?.();
      if (!db) return null;
      const rows = await db.select().from(guildSettings).where(eq(guildSettings.guild_id, guildId));
      return rows?.[0] ?? null;
    } catch (err) {
      this.logger.warn('Web Server', `Could not read guild_settings for ${guildId}: ${(err as Error).message}`);
      return null;
    }
  }

  private async writeGuildSettings(guildId: string, body: any): Promise<any> {
    const allowed = [
      'leveling_enabled', 'ai_enabled', 'music_enabled', 'economy_enabled',
      'moderation_enabled', 'welcome_enabled', 'welcome_channel_id', 'welcome_message',
      'goodbye_enabled', 'goodbye_channel_id', 'goodbye_message', 'autoroles_enabled', 'autorole_ids',
    ];
    const data: any = {};
    for (const key of allowed) {
      if (body[key] !== undefined) data[key] = body[key];
    }

    const now = new Date();
    let persisted = false;
    try {
      const db = this.appRef.database?.getDb?.();
      if (db) {
        const existing = await db.select().from(guildSettings).where(eq(guildSettings.guild_id, guildId));
        if (existing?.length) {
          await db.update(guildSettings).set({ ...data, updated_at: now }).where(eq(guildSettings.guild_id, guildId));
        } else {
          await db.insert(guildSettings).values({ guild_id: guildId, ...data, created_at: now, updated_at: now });
        }
        persisted = true;
      }
    } catch (err) {
      // Don't 500 the dashboard save if the DB is unavailable — log and continue
      this.logger.warn('Web Server', `Could not persist guild_settings for ${guildId}: ${(err as Error).message}`);
    }

    const current = persisted ? await this.readGuildSettings(guildId) : null;
    return { ...this.defaultGuildSettings(guildId), ...data, ...(current ?? {}) };
  }

  private applyModuleToggles(settings: any): void {
    const app: any = this.appRef;
    try {
      if (settings.leveling_enabled !== undefined && app.leveling?.config) {
        app.leveling.config.enabled = !!settings.leveling_enabled;
      }
      if (settings.ai_enabled !== undefined && app.ai?.config) {
        app.ai.config.enabled = !!settings.ai_enabled;
      }
    } catch (err) {
      this.logger.warn('Web Server', `Could not apply module toggles live: ${(err as Error).message}`);
    }
  }

  public async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = this.app.listen(this.port, () => {
        this.logger.info('Web Server', `Dashboard running at http://localhost:${this.port}`);
        resolve();
      });
      this.server.on('error', (err: any) => {
        this.logger.error('Web Server', `Failed to start: ${err.message}`);
        reject(err);
      });
    });
  }

  public async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }
}
