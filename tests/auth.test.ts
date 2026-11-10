import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import express from 'express';
import { DashboardAuth } from '../src/web/auth';

/**
 * End-to-end test of the Discord dashboard login:
 * mock Discord OAuth -> session cookie -> guild scoped API access.
 */

interface MockOptions {
  userId: string;
  guilds: { id: string; permissions: string }[];
}

describe('DashboardAuth', () => {
  let mock: http.Server;
  let apiBase = '';
  let mockState: MockOptions = { userId: 'u1', guilds: [] };
  let tokenRequests = 0;

  const original = { id: 'u-owner', username: 'owner', global_name: 'Owner', avatar: null };
  let profile: any = original;

  beforeAll(async () => {
    mock = http.createServer((req, res) => {
      if (req.method === 'POST' && req.url?.startsWith('/oauth2/token')) {
        tokenRequests += 1;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ access_token: 'mock-token', token_type: 'Bearer' }));
        return;
      }
      if (req.url?.startsWith('/users/@me/guilds')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(mockState.guilds));
        return;
      }
      if (req.url?.startsWith('/users/@me')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(profile));
        return;
      }
      res.writeHead(404);
      res.end('{}');
    });
    await new Promise<void>((resolve) => mock.listen(0, '127.0.0.1', () => resolve()));
    const address = mock.address() as any;
    apiBase = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => mock.close(() => resolve()));
  });

  function buildApp(options: { ownerIds?: string[]; botGuilds?: string[] } = {}) {
    const auth = new DashboardAuth({
      clientId: 'client',
      clientSecret: 'secret',
      publicUrl: 'http://dashboard.test',
      sessionSecret: 'unit-test-secret',
      ownerIds: options.ownerIds ?? [],
      allowedGuildId: '',
      disabled: false,
      sessionTtlMs: 60_000,
      getBotGuildIds: () => options.botGuilds ?? ['g1', 'g2'],
      apiBase,
    }, { info: () => undefined, warn: () => undefined, error: () => undefined } as any);

    const app = express();
    app.use(express.json());
    auth.registerRoutes(app);
    app.use(auth.middleware());
    app.get('/api/guilds', (req: any, res: any) => {
      const client = { guilds: { cache: new Map([...auth['opts'].getBotGuildIds()].map((id) => [id, { id }])) } };
      const visible = auth.filterGuilds(req.dashboardUser, [...client.guilds.cache.keys()].map(String));
      res.json(visible);
    });
    app.get('/api/owner-only', (req: any, res: any) => {
      if (!req.dashboardUser?.isOwner) return res.status(403).json({ error: 'owner_only' });
      res.json({ ok: true });
    });
    return { app, auth };
  }

  async function startServer(app: express.Application) {
    const server = await new Promise<http.Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const address = server.address() as any;
    return { server, base: `http://127.0.0.1:${address.port}` };
  }

  function cookieFrom(response: Response, name: string): string {
    const raw = response.headers.getSetCookie?.() ?? [];
    for (const entry of raw) {
      const [pair] = entry.split(';');
      const [key, ...rest] = pair.split('=');
      if (key.trim() === name) return decodeURIComponent(rest.join('='));
    }
    return '';
  }

  async function login(base: string): Promise<string> {
    const start = await fetch(`${base}/auth/login`, { redirect: 'manual' });
    const location = start.headers.get('location') ?? '';
    const state = new URL(location).searchParams.get('state') ?? '';
    const stateCookie = cookieFrom(start, 'sukuna_oauth_state');
    const callback = await fetch(`${base}/auth/callback?code=mock-code&state=${state}`, {
      redirect: 'manual',
      headers: { cookie: `sukuna_oauth_state=${encodeURIComponent(stateCookie)}` },
    });
    expect(callback.status).toBe(302);
    expect(callback.headers.get('location')).toBe('/');
    return cookieFrom(callback, 'sukuna_session');
  }

  it('rejects unauthenticated API requests with 401', async () => {
    const { app } = buildApp();
    const { server, base } = await startServer(app);
    try {
      const res = await fetch(`${base}/api/guilds`);
      expect(res.status).toBe(401);
    } finally {
      server.close();
    }
  });

  it('completes the OAuth flow and scopes the session to manageable guilds', async () => {
    mockState = { userId: 'u1', guilds: [{ id: 'g1', permissions: '32' }, { id: 'g2', permissions: '8' }, { id: 'g3', permissions: '0' }] };
    profile = { id: 'u1', username: 'tester', global_name: 'Tester', avatar: null };
    const { app } = buildApp();
    const { server, base } = await startServer(app);
    try {
      const session = await login(base);
      expect(session).toBeTruthy();

      const guilds = await fetch(`${base}/api/guilds`, { headers: { cookie: `sukuna_session=${session}` } });
      expect(guilds.status).toBe(200);
      expect(await guilds.json()).toEqual(['g1', 'g2']);

      const ownerOnly = await fetch(`${base}/api/owner-only`, { headers: { cookie: `sukuna_session=${session}` } });
      expect(ownerOnly.status).toBe(403);
    } finally {
      server.close();
    }
  });

  it('blocks users without Manage Server from signing in', async () => {
    mockState = { userId: 'u9', guilds: [{ id: 'g3', permissions: '0' }] };
    profile = { id: 'u9', username: 'nobody', global_name: 'Nobody', avatar: null };
    const { app } = buildApp();
    const { server, base } = await startServer(app);
    try {
      const start = await fetch(`${base}/auth/login`, { redirect: 'manual' });
      const location = start.headers.get('location') ?? '';
      const state = new URL(location).searchParams.get('state') ?? '';
      const stateCookie = cookieFrom(start, 'sukuna_oauth_state');
      const callback = await fetch(`${base}/auth/callback?code=mock-code&state=${state}`, {
        redirect: 'manual',
        headers: { cookie: `sukuna_oauth_state=${encodeURIComponent(stateCookie)}` },
      });
      expect(callback.headers.get('location')).toBe('/login?error=forbidden');
      expect(cookieFrom(callback, 'sukuna_session')).toBe('');
    } finally {
      server.close();
    }
  });

  it('rejects a callback with a mismatched state', async () => {
    const { app } = buildApp();
    const { server, base } = await startServer(app);
    try {
      const callback = await fetch(`${base}/auth/callback?code=mock-code&state=tampered`, { redirect: 'manual' });
      expect(callback.headers.get('location')).toBe('/login?error=state');
    } finally {
      server.close();
    }
  });

  it('gives owners every bot guild and owner-only access', async () => {
    mockState = { userId: 'u-owner', guilds: [{ id: 'g1', permissions: '0' }] };
    profile = original;
    const { app } = buildApp({ ownerIds: ['u-owner'], botGuilds: ['g1', 'g2', 'g7'] });
    const { server, base } = await startServer(app);
    try {
      const session = await login(base);
      const guilds = await fetch(`${base}/api/guilds`, { headers: { cookie: `sukuna_session=${session}` } });
      expect(await guilds.json()).toEqual(['g1', 'g2', 'g7']);

      const ownerOnly = await fetch(`${base}/api/owner-only`, { headers: { cookie: `sukuna_session=${session}` } });
      expect(ownerOnly.status).toBe(200);
    } finally {
      server.close();
    }
  });

  it('rejects tampered session cookies', async () => {
    const { app } = buildApp();
    const { server, base } = await startServer(app);
    try {
      const res = await fetch(`${base}/api/guilds`, { headers: { cookie: 'sukuna_session=forged.signature' } });
      expect(res.status).toBe(401);
    } finally {
      server.close();
    }
  });
});
