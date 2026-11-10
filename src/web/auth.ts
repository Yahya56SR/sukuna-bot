import crypto from 'crypto';
import path from 'path';
import type { Request, Response, NextFunction, Application } from 'express';
import type { Logger } from '../infrastructure/Logger';

/**
 * Discord OAuth2 login for the dashboard.
 *
 * Design notes:
 * - The session lives in a signed, HttpOnly cookie. Nothing is stored on the
 *   server, so restarts only invalidate sessions when SESSION_SECRET is random.
 * - OAuth access tokens are never persisted: we only keep identity and the
 *   list of guilds the user may manage.
 * - Authorization is per guild. Owners (DASHBOARD_OWNER_IDS) can see every
 *   guild the bot is in; everybody else only sees guilds where they have
 *   Manage Server or Administrator.
 * - DASHBOARD_AUTH_DISABLED=true is an explicit local-only escape hatch.
 */

export interface DashboardUser {
  id: string;
  username: string;
  displayName: string;
  avatar: string | null;
  isOwner: boolean;
  guildIds: string[];
  exp: number;
}

export interface DashboardAuthOptions {
  clientId: string;
  clientSecret: string;
  publicUrl: string;
  sessionSecret: string;
  ownerIds: string[];
  allowedGuildId: string;
  disabled: boolean;
  sessionTtlMs: number;
  getBotGuildIds: () => string[];
  /** Discord REST base URL (overridable for tests/proxies). */
  apiBase?: string | undefined;
}

interface SessionPayload {
  v: 1;
  id: string;
  username: string;
  displayName: string;
  avatar: string | null;
  isOwner: boolean;
  guildIds: string[];
  iat: number;
  exp: number;
}

const SESSION_COOKIE = 'sukuna_session';
const STATE_COOKIE = 'sukuna_oauth_state';
const DISCORD_API = 'https://discord.com/api';
const MANAGE_GUILD = 0x20n;
const ADMINISTRATOR = 0x8n;
function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    if (!key) continue;
    const value = part.slice(index + 1).trim();
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

export class DashboardAuth {
  private opts: DashboardAuthOptions;
  private logger: Logger;
  private readonly configured: boolean;

  constructor(opts: DashboardAuthOptions, logger: Logger) {
    this.opts = opts;
    this.logger = logger;
    this.configured = Boolean(opts.clientId && opts.clientSecret);
  }

  public get disabled(): boolean {
    return this.opts.disabled;
  }

  public get publicUrl(): string {
    return this.opts.publicUrl.replace(/\/+$/, '');
  }

  public get isConfigured(): boolean {
    return this.configured;
  }

  /** Identity for the current request, or null when not signed in. */
  public currentUser(req: Request): DashboardUser | null {
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
    if (!this.configured) return null;
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (!token) return null;
    return this.verifySession(token);
  }

  /** True when the user may view/act on the guild. */
  public canAccessGuild(user: DashboardUser | null, guildId: string): boolean {
    if (!user) return false;
    if (this.opts.disabled || user.isOwner) return true;
    if (!guildId) return false;
    return user.guildIds.includes(guildId);
  }

  /** Guilds the user may see from the bot's guild list. */
  public filterGuilds(user: DashboardUser | null, guildIds: string[]): string[] {
    if (!user) return [];
    if (this.opts.disabled || user.isOwner) return guildIds;
    return guildIds.filter((id) => user.guildIds.includes(id));
  }

  // ---------------------------------------------------------------------
  // Express wiring
  // ---------------------------------------------------------------------

  public registerRoutes(app: Application): void {
    app.get('/login', (req: Request, res: Response) => {
      if (this.currentUser(req)) return res.redirect('/');
      res.sendFile(path.join(__dirname, 'views', 'login.html'));
    });

    app.get('/auth/login', (req: Request, res: Response) => {
      if (this.opts.disabled) return res.redirect('/');
      if (!this.configured) return res.redirect('/login?error=not_configured');

      // Preserve the page the user was trying to reach.
      const next = typeof req.query.next === 'string' && req.query.next.startsWith('/')
        ? req.query.next
        : '/';
      const state = crypto.randomBytes(24).toString('base64url');
      const cookieOpts = { httpOnly: true, sameSite: 'lax' as const, secure: this.isSecure(), path: '/', maxAge: 10 * 60 * 1000 };
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

    app.get('/auth/callback', async (req: Request, res: Response) => {
      if (this.opts.disabled) return res.redirect('/');
      if (!this.configured) return res.redirect('/login?error=not_configured');

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
        if (!profile?.id) throw new Error('Discord profile did not include an id');

        const ownerIds = new Set(this.opts.ownerIds);
        const isOwner = ownerIds.has(String(profile.id));
        const manageable = (Array.isArray(guilds) ? guilds : [])
          .filter((g: any) => this.hasManagePermission(g?.permissions))
          .map((g: any) => String(g.id));

        const botGuildIds = this.opts.getBotGuildIds();
        const botSet = new Set(botGuildIds);
        let guildIds = manageable.filter((id: string) => botSet.size === 0 || botSet.has(id));

        if (isOwner) {
          guildIds = botGuildIds.length > 0 ? [...botGuildIds] : [];
        }

        if (this.opts.allowedGuildId && !isOwner) {
          guildIds = guildIds.filter((id: string) => id === this.opts.allowedGuildId);
        }
        if (!isOwner && guildIds.length === 0) {
          this.logger.warn('Dashboard Auth', `Denied dashboard login for ${profile.id}: no manageable guild`);
          return res.redirect('/login?error=forbidden');
        }

        const now = Date.now();
        const payload: SessionPayload = {
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
      } catch (err) {
        this.logger.error('Dashboard Auth', 'OAuth callback failed', err as Error);
        return res.redirect('/login?error=failed');
      }
    });

    app.post('/auth/logout', (_req: Request, res: Response) => {
      res.clearCookie(SESSION_COOKIE, { path: '/' });
      res.json({ success: true });
    });

    app.get('/api/auth/me', (req: Request, res: Response) => {
      const user = this.currentUser(req);
      if (!user) return res.status(401).json({ authenticated: false, configured: this.configured, disabled: this.opts.disabled });
      const client = this.getClientSafe();
      const allGuildIds: string[] = client?.guilds?.cache
        ? [...client.guilds.cache.keys()].map((id: string) => String(id))
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
  public middleware() {
    return (req: Request, res: Response, next: NextFunction): void => {
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
        (req as any).dashboardUser = this.currentUser(req);
        next();
        return;
      }

      if (!this.configured) {
        if (p.startsWith('/api/') || p.startsWith('/api')) {
          res.status(503).json({ error: 'dashboard_auth_not_configured' });
        } else {
          res.redirect('/login?error=not_configured');
        }
        return;
      }

      const user = this.currentUser(req);
      if (!user) {
        if (p.startsWith('/api/')) {
          res.status(401).json({ error: 'unauthorized', loginUrl: '/auth/login' });
        } else {
          const nextPath = encodeURIComponent(req.originalUrl || '/');
          res.redirect(`/auth/login?next=${nextPath}`);
        }
        return;
      }

      (req as any).dashboardUser = user;
      next();
    };
  }

  // ---------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------

  private getClientSafe(): any {
    // Wired by WebServer after construction to avoid a circular dependency.
    const getter = (this as any)._getClient as (() => any) | undefined;
    return getter ? getter() : null;
  }

  public setClientGetter(getter: () => any): void {
    (this as any)._getClient = getter;
  }

  private hasManagePermission(permissions: unknown): boolean {
    try {
      const bits = BigInt(String(permissions ?? '0'));
      return (bits & MANAGE_GUILD) === MANAGE_GUILD || (bits & ADMINISTRATOR) === ADMINISTRATOR;
    } catch {
      return false;
    }
  }

  private isSecure(): boolean {
    return this.publicUrl.startsWith('https://');
  }

  private isSameOrigin(origin: string, req: Request): boolean {
    try {
      const originHost = new URL(origin).host;
      const expected = new URL(this.publicUrl).host;
      return originHost === expected || originHost === req.get('host');
    } catch {
      return false;
    }
  }

  private redirectUri(): string {
    return `${this.publicUrl}/auth/callback`;
  }

  private get discordApi(): string {
    return (this.opts.apiBase || DISCORD_API).replace(/\/+$/, '');
  }

  private async exchangeCode(code: string): Promise<string> {
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
    const data: any = await res.json();
    if (!data?.access_token) throw new Error('Token exchange returned no access_token');
    return String(data.access_token);
  }

  private async fetchDiscord(endpoint: string, accessToken: string): Promise<any> {
    const res = await fetch(`${this.discordApi}${endpoint}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`Discord ${endpoint} failed (${res.status})`);
    return res.json();
  }

  private encodeSession(payload: SessionPayload): string {
    const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    return `${body}.${this.sign(body)}`;
  }

  private verifySession(token: string): DashboardUser | null {
    const dot = token.lastIndexOf('.');
    if (dot <= 0) return null;
    const body = token.slice(0, dot);
    const signature = token.slice(dot + 1);
    if (!safeEqual(signature, this.sign(body))) return null;
    try {
      const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload;
      if (payload?.v !== 1 || !payload.id || !Array.isArray(payload.guildIds)) return null;
      if (!Number.isFinite(payload.exp) || payload.exp <= Date.now()) return null;
      return {
        id: String(payload.id),
        username: String(payload.username ?? ''),
        displayName: String(payload.displayName ?? payload.username ?? ''),
        avatar: payload.avatar ? String(payload.avatar) : null,
        isOwner: Boolean(payload.isOwner),
        guildIds: payload.guildIds.map(String),
        exp: Number(payload.exp),
      };
    } catch {
      return null;
    }
  }

  private sign(body: string): string {
    return crypto.createHmac('sha256', this.opts.sessionSecret).update(body).digest('base64url');
  }
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}
