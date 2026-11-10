"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DashboardAuth = void 0;
const crypto_1 = __importDefault(require("crypto"));
const path_1 = __importDefault(require("path"));
const SESSION_COOKIE = 'sukuna_session';
const STATE_COOKIE = 'sukuna_oauth_state';
const DISCORD_API = 'https://discord.com/api';
const MANAGE_GUILD = 0x20n;
const ADMINISTRATOR = 0x8n;
function parseCookies(header) {
    const out = {};
    if (!header)
        return out;
    for (const part of header.split(';')) {
        const index = part.indexOf('=');
        if (index === -1)
            continue;
        const key = part.slice(0, index).trim();
        if (!key)
            continue;
        const value = part.slice(index + 1).trim();
        try {
            out[key] = decodeURIComponent(value);
        }
        catch {
            out[key] = value;
        }
    }
    return out;
}
class DashboardAuth {
    constructor(opts, logger) {
        this.opts = opts;
        this.logger = logger;
        this.configured = Boolean(opts.clientId && opts.clientSecret);
    }
    get disabled() {
        return this.opts.disabled;
    }
    get publicUrl() {
        return this.opts.publicUrl.replace(/\/+$/, '');
    }
    get isConfigured() {
        return this.configured;
    }
    /** Identity for the current request, or null when not signed in. */
    currentUser(req) {
        if (this.opts.disabled) {
            return {
                id: 'local',
                username: 'local',
                displayName: 'Local operator',
                avatar: null,
                isOwner: true,
                guildIds: [],
                exp: Number.MAX_SAFE_INTEGER,
            };
        }
        if (!this.configured)
            return null;
        const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
        if (!token)
            return null;
        return this.verifySession(token);
    }
    /** True when the user may view/act on the guild. */
    canAccessGuild(user, guildId) {
        if (!user)
            return false;
        if (this.opts.disabled || user.isOwner)
            return true;
        if (!guildId)
            return false;
        return user.guildIds.includes(guildId);
    }
    /** Guilds the user may see from the bot's guild list. */
    filterGuilds(user, guildIds) {
        if (!user)
            return [];
        if (this.opts.disabled || user.isOwner)
            return guildIds;
        return guildIds.filter((id) => user.guildIds.includes(id));
    }
    // ---------------------------------------------------------------------
    // Express wiring
    // ---------------------------------------------------------------------
    registerRoutes(app) {
        app.get('/login', (req, res) => {
            if (this.currentUser(req))
                return res.redirect('/');
            res.sendFile(path_1.default.join(__dirname, 'views', 'login.html'));
        });
        app.get('/auth/login', (req, res) => {
            if (this.opts.disabled)
                return res.redirect('/');
            if (!this.configured)
                return res.redirect('/login?error=not_configured');
            // Preserve the page the user was trying to reach.
            const next = typeof req.query.next === 'string' && req.query.next.startsWith('/')
                ? req.query.next
                : '/';
            const state = crypto_1.default.randomBytes(24).toString('base64url');
            const cookieOpts = { httpOnly: true, sameSite: 'lax', secure: this.isSecure(), path: '/', maxAge: 10 * 60 * 1000 };
            res.cookie(STATE_COOKIE, `${state}:${next}`, cookieOpts);
            const params = new URLSearchParams({
                client_id: this.opts.clientId,
                response_type: 'code',
                redirect_uri: this.redirectUri(),
                scope: 'identify guilds',
                state,
            });
            res.redirect(`https://discord.com/oauth2/authorize?${params.toString()}`);
        });
        app.get('/auth/callback', async (req, res) => {
            if (this.opts.disabled)
                return res.redirect('/');
            if (!this.configured)
                return res.redirect('/login?error=not_configured');
            const cookies = parseCookies(req.headers.cookie);
            const rawState = cookies[STATE_COOKIE] ?? '';
            const [expectedState, nextPath] = rawState.split(':');
            const state = typeof req.query.state === 'string' ? req.query.state : '';
            const code = typeof req.query.code === 'string' ? req.query.code : '';
            const oauthError = typeof req.query.error === 'string' ? req.query.error : '';
            res.clearCookie(STATE_COOKIE, { path: '/' });
            if (oauthError) {
                this.logger.warn('Dashboard Auth', `Discord OAuth returned error: ${oauthError}`);
                return res.redirect('/login?error=denied');
            }
            if (!code || !state || !expectedState || !safeEqual(state, expectedState)) {
                this.logger.warn('Dashboard Auth', 'OAuth state mismatch or missing code');
                return res.redirect('/login?error=state');
            }
            try {
                const token = await this.exchangeCode(code);
                const [profile, guilds] = await Promise.all([
                    this.fetchDiscord('/users/@me', token),
                    this.fetchDiscord('/users/@me/guilds', token),
                ]);
                if (!profile?.id)
                    throw new Error('Discord profile did not include an id');
                const ownerIds = new Set(this.opts.ownerIds);
                const isOwner = ownerIds.has(String(profile.id));
                const manageable = (Array.isArray(guilds) ? guilds : [])
                    .filter((g) => this.hasManagePermission(g?.permissions))
                    .map((g) => String(g.id));
                const botGuildIds = this.opts.getBotGuildIds();
                const botSet = new Set(botGuildIds);
                let guildIds = manageable.filter((id) => botSet.size === 0 || botSet.has(id));
                if (isOwner) {
                    guildIds = botGuildIds.length > 0 ? [...botGuildIds] : [];
                }
                if (this.opts.allowedGuildId && !isOwner) {
                    guildIds = guildIds.filter((id) => id === this.opts.allowedGuildId);
                }
                if (!isOwner && guildIds.length === 0) {
                    this.logger.warn('Dashboard Auth', `Denied dashboard login for ${profile.id}: no manageable guild`);
                    return res.redirect('/login?error=forbidden');
                }
                const now = Date.now();
                const payload = {
                    v: 1,
                    id: String(profile.id),
                    username: String(profile.username ?? 'unknown'),
                    displayName: String(profile.global_name ?? profile.username ?? 'unknown'),
                    avatar: profile.avatar ? String(profile.avatar) : null,
                    isOwner,
                    guildIds,
                    iat: now,
                    exp: now + this.opts.sessionTtlMs,
                };
                this.logger.info('Dashboard Auth', `Signed in ${payload.username} (${payload.id})${isOwner ? ' [owner]' : ''}`);
                res.cookie(SESSION_COOKIE, this.encodeSession(payload), {
                    httpOnly: true,
                    sameSite: 'lax',
                    secure: this.isSecure(),
                    path: '/',
                    maxAge: this.opts.sessionTtlMs,
                });
                const target = typeof nextPath === 'string' && nextPath.startsWith('/') ? nextPath : '/';
                return res.redirect(target);
            }
            catch (err) {
                this.logger.error('Dashboard Auth', 'OAuth callback failed', err);
                return res.redirect('/login?error=failed');
            }
        });
        app.post('/auth/logout', (_req, res) => {
            res.clearCookie(SESSION_COOKIE, { path: '/' });
            res.json({ success: true });
        });
        app.get('/api/auth/me', (req, res) => {
            const user = this.currentUser(req);
            if (!user)
                return res.status(401).json({ authenticated: false, configured: this.configured, disabled: this.opts.disabled });
            const client = this.getClientSafe();
            const allGuildIds = client?.guilds?.cache
                ? [...client.guilds.cache.keys()].map((id) => String(id))
                : [];
            return res.json({
                authenticated: true,
                configured: this.configured,
                disabled: this.opts.disabled,
                user: {
                    id: user.id,
                    username: user.username,
                    displayName: user.displayName,
                    avatar: user.avatar,
                    isOwner: user.isOwner,
                },
                guildIds: this.filterGuilds(user, allGuildIds),
            });
        });
    }
    /** Guard for every non-public route. */
    middleware() {
        return (req, res, next) => {
            const p = req.path;
            // Public surfaces.
            if (p.startsWith('/static/') || p === '/favicon.ico' || p === '/login' || p.startsWith('/auth/')) {
                next();
                return;
            }
            // Reject cross-site state-changing requests when an Origin is present.
            if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
                const origin = req.get('origin');
                if (origin && !this.isSameOrigin(origin, req)) {
                    res.status(403).json({ error: 'cross_origin_rejected' });
                    return;
                }
            }
            if (this.opts.disabled) {
                req.dashboardUser = this.currentUser(req);
                next();
                return;
            }
            if (!this.configured) {
                if (p.startsWith('/api/') || p.startsWith('/api')) {
                    res.status(503).json({ error: 'dashboard_auth_not_configured' });
                }
                else {
                    res.redirect('/login?error=not_configured');
                }
                return;
            }
            const user = this.currentUser(req);
            if (!user) {
                if (p.startsWith('/api/')) {
                    res.status(401).json({ error: 'unauthorized', loginUrl: '/auth/login' });
                }
                else {
                    const nextPath = encodeURIComponent(req.originalUrl || '/');
                    res.redirect(`/auth/login?next=${nextPath}`);
                }
                return;
            }
            req.dashboardUser = user;
            next();
        };
    }
    // ---------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------
    getClientSafe() {
        // Wired by WebServer after construction to avoid a circular dependency.
        const getter = this._getClient;
        return getter ? getter() : null;
    }
    setClientGetter(getter) {
        this._getClient = getter;
    }
    hasManagePermission(permissions) {
        try {
            const bits = BigInt(String(permissions ?? '0'));
            return (bits & MANAGE_GUILD) === MANAGE_GUILD || (bits & ADMINISTRATOR) === ADMINISTRATOR;
        }
        catch {
            return false;
        }
    }
    isSecure() {
        return this.publicUrl.startsWith('https://');
    }
    isSameOrigin(origin, req) {
        try {
            const originHost = new URL(origin).host;
            const expected = new URL(this.publicUrl).host;
            return originHost === expected || originHost === req.get('host');
        }
        catch {
            return false;
        }
    }
    redirectUri() {
        return `${this.publicUrl}/auth/callback`;
    }
    get discordApi() {
        return (this.opts.apiBase || DISCORD_API).replace(/\/+$/, '');
    }
    async exchangeCode(code) {
        const body = new URLSearchParams({
            client_id: this.opts.clientId,
            client_secret: this.opts.clientSecret,
            grant_type: 'authorization_code',
            code,
            redirect_uri: this.redirectUri(),
        });
        const res = await fetch(`${this.discordApi}/oauth2/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString(),
        });
        if (!res.ok) {
            throw new Error(`Token exchange failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
        }
        const data = await res.json();
        if (!data?.access_token)
            throw new Error('Token exchange returned no access_token');
        return String(data.access_token);
    }
    async fetchDiscord(endpoint, accessToken) {
        const res = await fetch(`${this.discordApi}${endpoint}`, {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!res.ok)
            throw new Error(`Discord ${endpoint} failed (${res.status})`);
        return res.json();
    }
    encodeSession(payload) {
        const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
        return `${body}.${this.sign(body)}`;
    }
    verifySession(token) {
        const dot = token.lastIndexOf('.');
        if (dot <= 0)
            return null;
        const body = token.slice(0, dot);
        const signature = token.slice(dot + 1);
        if (!safeEqual(signature, this.sign(body)))
            return null;
        try {
            const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
            if (payload?.v !== 1 || !payload.id || !Array.isArray(payload.guildIds))
                return null;
            if (!Number.isFinite(payload.exp) || payload.exp <= Date.now())
                return null;
            return {
                id: String(payload.id),
                username: String(payload.username ?? ''),
                displayName: String(payload.displayName ?? payload.username ?? ''),
                avatar: payload.avatar ? String(payload.avatar) : null,
                isOwner: Boolean(payload.isOwner),
                guildIds: payload.guildIds.map(String),
                exp: Number(payload.exp),
            };
        }
        catch {
            return null;
        }
    }
    sign(body) {
        return crypto_1.default.createHmac('sha256', this.opts.sessionSecret).update(body).digest('base64url');
    }
}
exports.DashboardAuth = DashboardAuth;
function safeEqual(a, b) {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    if (left.length !== right.length)
        return false;
    return crypto_1.default.timingSafeEqual(left, right);
}
