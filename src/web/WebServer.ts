import express from 'express';
import cors from 'cors';
import path from 'path';
import os from 'os';
import { Logger } from '../infrastructure/Logger';

export class WebServer {
  private app: express.Application;
  private port: number;
  private logger: Logger;
  private appRef: any;
  private server: any;

  constructor(logger: Logger, appRef: any, port: number = 3000) {
    this.logger = logger;
    this.appRef = appRef;
    this.port = port;
    this.app = express();

    this.app.use(cors());
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));

    this.app.use('/static', express.static(path.join(__dirname, 'public')));

    this.app.get('/', (_req: any, res: any) => {
      res.sendFile(path.join(__dirname, 'views', 'index.html'));
    });

    this.setupRoutes();
  }

  private setupRoutes(): void {
    // ---- Bot Status ----
    this.app.get('/api/status', (_req: any, res: any) => {
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
        res.status(500).json({ error: 'Failed to fetch stats' });
      }
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
    this.app.get('/api/guilds', (_req: any, res: any) => {
      const client = this.appRef.getClient?.();
      const guilds = client?.guilds?.cache ?? new Map();
      const list = [...guilds.values()].map((g: any) => ({
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
    });

    this.app.get('/api/guilds/:guildId', (_req: any, res: any) => {
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
        channels: [...guild.channels.cache.values()].map((c: any) => ({
          id: c.id,
          name: c.name,
          type: c.type,
          position: c.position,
          nsfw: c.nsfw ?? false,
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
    });

    this.app.get('/api/guilds/:guildId/members', (_req: any, res: any) => {
      const client = this.appRef.getClient?.();
      const guild = client?.guilds?.cache?.get(_req.params.guildId);
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
    this.app.get('/api/guilds/:guildId/channels', (_req: any, res: any) => {
      const client = this.appRef.getClient?.();
      const guild = client?.guilds?.cache?.get(_req.params.guildId);
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
    this.app.get('/api/moderation/cases', async (_req: any, res: any) => {
      try {
        const guildId = _req.query.guildId as string;
        const cases = await this.appRef.moderation.getCases?.(guildId ?? '') ?? [];
        res.json(cases);
      } catch (err) {
        res.status(500).json({ error: 'Failed to fetch moderation cases' });
      }
    });

    this.app.post('/api/moderation/warn', async (req: any, res: any) => {
      try {
        const { guildId, userId, moderatorId, reason } = req.body;
        const caseId = await this.appRef.moderation.warn?.(guildId, userId, moderatorId, reason ?? '');
        res.json({ success: true, caseId });
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Failed to warn user' });
      }
    });

    this.app.post('/api/moderation/kick', async (req: any, res: any) => {
      try {
        const { guildId, userId, moderatorId, reason } = req.body;
        const caseId = await this.appRef.moderation.kick?.(guildId, userId, moderatorId, reason ?? '');
        res.json({ success: true, caseId });
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Failed to kick user' });
      }
    });

    this.app.post('/api/moderation/ban', async (req: any, res: any) => {
      try {
        const { guildId, userId, moderatorId, reason, deleteMessageDays } = req.body;
        const caseId = await this.appRef.moderation.ban?.(guildId, userId, moderatorId, reason ?? '', deleteMessageDays ?? 0);
        res.json({ success: true, caseId });
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Failed to ban user' });
      }
    });

    this.app.post('/api/moderation/mute', async (req: any, res: any) => {
      try {
        const { guildId, userId, moderatorId, reason, durationMinutes } = req.body;
        const caseId = await this.appRef.moderation.mute?.(guildId, userId, moderatorId, reason ?? '', durationMinutes ?? 60);
        res.json({ success: true, caseId });
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Failed to mute user' });
      }
    });

    // ---- Economy ----
    this.app.get('/api/economy/balance/:userId', async (req: any, res: any) => {
      try {
        const balance = await this.appRef.economy.getBalance(req.params.userId);
        res.json({ userId: req.params.userId, balance });
      } catch (err) {
        res.status(500).json({ error: 'Failed to fetch balance' });
      }
    });

    this.app.post('/api/economy/set-balance', async (req: any, res: any) => {
      try {
        const { userId, balance } = req.body;
        const current = await this.appRef.economy.getBalance(userId);
        if (balance > current) {
          await this.appRef.economy.addBalance(userId, balance - current);
        } else if (balance < current) {
          await this.appRef.economy.removeBalance(userId, current - balance);
        }
        const newBalance = await this.appRef.economy.getBalance(userId);
        res.json({ success: true, userId, balance: newBalance });
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Failed to set balance' });
      }
    });

    // ---- Leveling ----
    this.app.get('/api/leveling/level/:userId', async (req: any, res: any) => {
      try {
        const guildId = req.query.guildId as string;
        const data = await this.appRef.leveling.getLevel?.(guildId ?? '', req.params.userId);
        if (!data) {
          return res.status(404).json({ error: 'No leveling data found' });
        }
        res.json(data);
      } catch (err) {
        res.status(500).json({ error: 'Failed to fetch level data' });
      }
    });

    this.app.get('/api/leveling/leaderboard', async (_req: any, res: any) => {
      try {
        const guildId = _req.query.guildId as string;
        const limit = parseInt(_req.query.limit as string) || 20;
        const leaderboard = await this.appRef.leveling.getLeaderboard?.(guildId ?? '', limit) ?? [];
        res.json(leaderboard);
      } catch (err) {
        res.status(500).json({ error: 'Failed to fetch leaderboard' });
      }
    });

    this.app.post('/api/leveling/set-xp', async (req: any, res: any) => {
      try {
        const { guildId, userId, xp } = req.body;
        const level = this.appRef.leveling.calculateLevel?.(xp) ?? 1;
        await this.appRef.leveling.addXP?.(guildId, userId, xp);
        res.json({ success: true, userId, xp, level });
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Failed to set XP' });
      }
    });

    // ---- Config ----
    this.app.get('/api/config/:service', (_req: any, res: any) => {
      const service = _req.params.service;
      try {
        const cfg = this.getServiceConfig(service);
        res.json(cfg ?? {});
      } catch (err) {
        res.status(500).json({ error: `Failed to fetch ${service} config` });
      }
    });

    this.app.post('/api/config/:service', (req: any, res: any) => {
      const service = req.params.service;
      try {
        const config = req.body;
        this.setServiceConfig(service, config);
        res.json({ success: true, config: this.getServiceConfig(service) });
      } catch (err: any) {
        res.status(500).json({ error: err.message || `Failed to update ${service} config` });
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
  }

  private getServiceConfig(service: string): any {
    const app: any = this.appRef;
    switch (service) {
      case 'leveling':
        return app.leveling?.config ?? {};
      case 'ai':
        return app.ai?.config ?? {};
      case 'music':
        return app.music?.config ?? {};
      case 'tempvc':
        return app.tempvc?.getConfig?.() ?? {};
      case 'moderation':
        return app.moderation?.config ?? {};
      case 'economy':
        return app.economy?.config ?? {};
      case 'automation':
        return app.automation?.config ?? {};
      case 'analytics':
        return app.analytics?.config ?? {};
      case 'web':
        return { port: this.port };
      default:
        return null;
    }
  }

  private setServiceConfig(service: string, config: any): void {
    const app: any = this.appRef;
    switch (service) {
      case 'leveling':
        Object.assign(app.leveling.config, config);
        break;
      case 'ai':
        Object.assign(app.ai.config, config);
        break;
      case 'music':
        Object.assign(app.music.config, config);
        break;
      case 'moderation':
        Object.assign(app.moderation.config, config);
        break;
      case 'economy':
        Object.assign(app.economy.config, config);
        break;
      case 'automation':
        Object.assign(app.automation.config, config);
        break;
      case 'analytics':
        Object.assign(app.analytics.config, config);
        break;
      case 'tempvc':
        if (app.tempvc?.setConfig) {
          app.tempvc.setConfig(config);
        }
        break;
      case 'web':
        break;
      default:
        throw new Error(`Unknown service: ${service}`);
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
