import express from 'express';
import cors from 'cors';
import path from 'path';
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
    this.app.get('/api/status', (_req: any, res: any) => {
      const client = this.appRef.getClient();
      res.json({
        online: !!client,
        ready: client?.isReady() ?? false,
        user: client?.user?.tag ?? null,
        guilds: client?.guilds.cache.size ?? 0,
        users: client?.users.cache.size ?? 0,
        uptime: process.uptime(),
      });
    });

    this.app.get('/api/stats', async (_req: any, res: any) => {
      try {
        const stats = await this.appRef.analytics.getStats();
        res.json(stats);
      } catch (err) {
        res.status(500).json({ error: 'Failed to fetch stats' });
      }
    });

    this.app.get('/api/commands', (_req: any, res: any) => {
      const commands = this.appRef.commands.getCommands?.() ?? [];
      res.json(commands.map((cmd: any) => ({
        name: cmd.data?.name ?? cmd.name ?? 'unknown',
        description: cmd.data?.description ?? cmd.description ?? '',
        category: cmd.category ?? 'General',
      })));
    });

    this.app.get('/api/leaderboard', async (_req: any, res: any) => {
      try {
        const leaderboard = await this.appRef.leveling.getLeaderboard('', 20);
        res.json(leaderboard);
      } catch (err) {
        res.status(500).json({ error: 'Failed to fetch leaderboard' });
      }
    });

    this.app.get('/api/config/leveling', (_req: any, res: any) => {
      res.json(this.appRef.leveling.config ?? {});
    });

    this.app.post('/api/config/leveling', (req: any, res: any) => {
      try {
        const config = req.body;
        Object.assign(this.appRef.leveling.config, config);
        res.json({ success: true, config: this.appRef.leveling.config });
      } catch (err) {
        res.status(500).json({ error: 'Failed to update leveling config' });
      }
    });

    this.app.get('/api/config/tempvc', (_req: any, res: any) => {
      res.json(this.appRef.tempvc.getConfig?.() ?? {});
    });

    this.app.post('/api/config/tempvc', async (req: any, res: any) => {
      try {
        const { createChannelId, categoryId } = req.body;
        if (createChannelId && categoryId) {
          await this.appRef.tempvc.setup(createChannelId, categoryId);
          res.json({ success: true, config: this.appRef.tempvc.getConfig() });
        } else {
          res.status(400).json({ error: 'Missing required fields' });
        }
      } catch (err) {
        res.status(500).json({ error: 'Failed to update tempvc config' });
      }
    });

    this.app.get('/api/config/ai', (_req: any, res: any) => {
      const cfg = this.appRef.ai.config ?? {};
      res.json({
        enabled: cfg.enabled,
        displayName: cfg.displayName,
        model: cfg.model,
        channelIds: cfg.channelIds,
        historySize: cfg.historySize,
        replyCooldownSeconds: cfg.replyCooldownSeconds,
        maxRepliesPerHour: cfg.maxRepliesPerHour,
        maxMessageLength: cfg.maxMessageLength,
        temperature: cfg.temperature,
        hasApiKey: !!cfg.apiKey,
      });
    });

    this.app.post('/api/config/ai', (req: any, res: any) => {
      try {
        const config = req.body;
        Object.assign(this.appRef.ai.config, config);
        res.json({ success: true });
      } catch (err) {
        res.status(500).json({ error: 'Failed to update AI config' });
      }
    });

    this.app.get('/api/economy/balance/:userId', async (req: any, res: any) => {
      try {
        const balance = await this.appRef.economy.getBalance(req.params.userId);
        res.json({ userId: req.params.userId, balance });
      } catch (err) {
        res.status(500).json({ error: 'Failed to fetch balance' });
      }
    });

    this.app.get('/api/games', (_req: any, res: any) => {
      const guildId = _req.query.guildId as string;
      const games = this.appRef.economyGames.getActiveGames?.(guildId ?? '') ?? [];
      res.json(games.map((g: any) => ({
        id: g.id,
        type: g.type,
        prize: g.prize,
        entryFee: g.entryFee,
        playerCount: g.players.size,
        status: g.status,
        endsAt: g.endsAt,
      })));
    });

    this.app.get('/api/moderation/cases', async (_req: any, res: any) => {
      try {
        const guildId = _req.query.guildId as string;
        const cases = await this.appRef.moderation.getCases?.(guildId ?? '') ?? [];
        res.json(cases);
      } catch (err) {
        res.status(500).json({ error: 'Failed to fetch moderation cases' });
      }
    });

    this.app.get('/api/logs', (_req: any, res: any) => {
      res.json(this.appRef.logger.getLogs?.() ?? []);
    });

    this.app.delete('/api/logs', (_req: any, res: any) => {
      this.appRef.logger.clearLogs?.();
      res.json({ success: true });
    });

    this.app.post('/api/control/shutdown', (_req: any, res: any) => {
      res.json({ success: true, message: 'Shutting down...' });
      setTimeout(() => {
        process.exit(0);
      }, 1000);
    });
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
