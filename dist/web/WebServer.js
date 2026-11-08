"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebServer = void 0;
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const path_1 = __importDefault(require("path"));
class WebServer {
    constructor(logger, appRef, port = 3000) {
        this.logger = logger;
        this.appRef = appRef;
        this.port = port;
        this.app = (0, express_1.default)();
        this.app.use((0, cors_1.default)());
        this.app.use(express_1.default.json());
        this.app.use(express_1.default.urlencoded({ extended: true }));
        this.app.use('/static', express_1.default.static(path_1.default.join(__dirname, 'public')));
        this.app.get('/', (_req, res) => {
            res.sendFile(path_1.default.join(__dirname, 'views', 'index.html'));
        });
        this.setupRoutes();
    }
    setupRoutes() {
        this.app.get('/api/status', (_req, res) => {
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
        this.app.get('/api/stats', async (_req, res) => {
            try {
                const stats = await this.appRef.analytics.getStats();
                res.json(stats);
            }
            catch (err) {
                res.status(500).json({ error: 'Failed to fetch stats' });
            }
        });
        this.app.get('/api/commands', (_req, res) => {
            const commands = this.appRef.commands.getCommands?.() ?? [];
            res.json(commands.map((cmd) => ({
                name: cmd.data?.name ?? cmd.name ?? 'unknown',
                description: cmd.data?.description ?? cmd.description ?? '',
                category: cmd.category ?? 'General',
            })));
        });
        this.app.get('/api/leaderboard', async (_req, res) => {
            try {
                const leaderboard = await this.appRef.leveling.getLeaderboard('', 20);
                res.json(leaderboard);
            }
            catch (err) {
                res.status(500).json({ error: 'Failed to fetch leaderboard' });
            }
        });
        this.app.get('/api/config/leveling', (_req, res) => {
            res.json(this.appRef.leveling.config ?? {});
        });
        this.app.post('/api/config/leveling', (req, res) => {
            try {
                const config = req.body;
                Object.assign(this.appRef.leveling.config, config);
                res.json({ success: true, config: this.appRef.leveling.config });
            }
            catch (err) {
                res.status(500).json({ error: 'Failed to update leveling config' });
            }
        });
        this.app.get('/api/config/tempvc', (_req, res) => {
            res.json(this.appRef.tempvc.getConfig?.() ?? {});
        });
        this.app.post('/api/config/tempvc', async (req, res) => {
            try {
                const { createChannelId, categoryId } = req.body;
                if (createChannelId && categoryId) {
                    await this.appRef.tempvc.setup(createChannelId, categoryId);
                    res.json({ success: true, config: this.appRef.tempvc.getConfig() });
                }
                else {
                    res.status(400).json({ error: 'Missing required fields' });
                }
            }
            catch (err) {
                res.status(500).json({ error: 'Failed to update tempvc config' });
            }
        });
        this.app.get('/api/config/ai', (_req, res) => {
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
        this.app.post('/api/config/ai', (req, res) => {
            try {
                const config = req.body;
                Object.assign(this.appRef.ai.config, config);
                res.json({ success: true });
            }
            catch (err) {
                res.status(500).json({ error: 'Failed to update AI config' });
            }
        });
        this.app.get('/api/economy/balance/:userId', async (req, res) => {
            try {
                const balance = await this.appRef.economy.getBalance(req.params.userId);
                res.json({ userId: req.params.userId, balance });
            }
            catch (err) {
                res.status(500).json({ error: 'Failed to fetch balance' });
            }
        });
        this.app.get('/api/games', (_req, res) => {
            const guildId = _req.query.guildId;
            const games = this.appRef.economyGames.getActiveGames?.(guildId ?? '') ?? [];
            res.json(games.map((g) => ({
                id: g.id,
                type: g.type,
                prize: g.prize,
                entryFee: g.entryFee,
                playerCount: g.players.size,
                status: g.status,
                endsAt: g.endsAt,
            })));
        });
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
        this.app.get('/api/logs', (_req, res) => {
            res.json(this.appRef.logger.getLogs?.() ?? []);
        });
        this.app.delete('/api/logs', (_req, res) => {
            this.appRef.logger.clearLogs?.();
            res.json({ success: true });
        });
        this.app.post('/api/control/shutdown', (_req, res) => {
            res.json({ success: true, message: 'Shutting down...' });
            setTimeout(() => {
                process.exit(0);
            }, 1000);
        });
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
