/**
 * Sukuna web dashboard.
 *
 * A dependency-free HTTP server that runs inside the bot process. It exposes:
 *   - a token-protected JSON API over the live discord.js client, MongoDB and
 *     the Gemini persona;
 *   - the single-page control panel under /dashboard.
 *
 * Design constraints:
 *   - must survive esbuild bundling into one CJS file (no Express, no ESM-only
 *     dependencies);
 *   - binds 0.0.0.0 because bot-hosting.net routes to $SERVER_PORT, so every API
 *     request is authenticated with a signed HttpOnly session cookie.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Guild } from 'discord.js';
import { z } from 'zod';

import type { SukunaClient } from '../src/core/client.js';
import { mongoose } from '../src/db/index.js';
import {
  DEFAULT_DISPLAY_NAME,
  defaultSukunaConfig,
  getSukunaConfig,
  resetSukunaConfig,
  saveSukunaConfig,
  sukunaConfigPatchSchema,
  type SukunaConfig,
} from '../src/config/index.js';
import { readGuildConfig, updateGuildConfig } from '../src/db/models/Guild.js';
import {
  TicketPanel,
  TicketDepartment,
  OpenTicket,
  TicketConfig,
  defaultTicketConfig,
  type ITicketConfig,
} from '../src/db/models/Ticket.js';
import { User } from '../src/db/models/User.js';
import { setUserXp } from '../src/db/utils.js';
import { invalidateLiveLeaderboard, refreshLiveLeaderboard } from '../src/utils/liveLeaderboard.js';
import { SukunaMemory } from '../src/db/models/SukunaMemory.js';
import { clearMemories, countMemories } from '../src/utils/sukuna-memory.js';
import {
  cancelScheduledMessage,
  countScheduled,
  createAnnouncement,
  createFaqEntry,
  createScheduledMessage,
  createServerEvent,
  deleteAnnouncement,
  deleteFaqEntry,
  getServerRules,
  listAnnouncements,
  listFaq,
  listServerEvents,
  SukunaAnnouncement,
  SukunaFaq,
  SukunaScheduled,
  updateFaqEntry,
  upsertServerRules,
} from '../src/utils/sukuna-storage.js';
import { buildSukunaRuntimePrompt, SUKUNA_DEFAULT_PROMPT } from '../src/prompts/sukuna.js';
import { generateLiveText } from '../src/core/gemini-live.js';
import { getActivity, getCounters, recordActivity, type ActivityKind } from '../src/core/metrics.js';

// Auto-mod rules
import { AutoModRule, type IAutoModRule } from '../src/db/models/AutoModRule.js';
// Reaction roles
import { ReactionRolePanel, type IReactionRolePanel, type IReactionRoleOption } from '../src/db/models/ReactionRolePanel.js';
// Custom commands
import { CustomCommand, type ICustomCommand } from '../src/db/models/CustomCommand.js';
// Themes
import { ThemeConfig, type IThemeConfig } from '../src/db/models/ThemeConfig.js';
// Color roles
import { ColorRole, type IColorRole } from '../src/db/models/ColorRole.js';
// Starboard
import { StarboardConfig, type IStarboardConfig } from '../src/db/models/Starboard.js';
// Welcome config
import { WelcomeConfig, type IWelcomeConfig } from '../src/db/models/WelcomeConfig.js';

/* ------------------------------------------------------------------ */
/* Constants                                                          */
/* ------------------------------------------------------------------ */

const DASHBOARD_HOST = '0.0.0.0';
const DEFAULT_PORT = 3001;
const SESSION_COOKIE = 'sukuna_dash';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 1_000_000;
const DASHBOARD_DIR = resolveDashboardDir();

const SESSION_SECRET = crypto.randomBytes(32);
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

const ALLOWED_MODULES = ['economy', 'leveling', 'fun', 'music', 'tickets', 'ai'] as const;
const USER_SORT_FIELDS = ['totalXp', 'balance', 'level', 'xp', 'createdAt'] as const;
const ACTIVITY_KINDS: Array<ActivityKind | 'all'> = ['all', 'system', 'command', 'ai', 'error', 'log'];

/**
 * Suggestions only, and all of them are Live API models: the persona talks to
 * Gemini over `bidiGenerateContent` (WebSocket) and cannot use generateContent.
 * The model field stays free-form so a newly released Live model can be used
 * without shipping a dashboard update.
 */
const SUGGESTED_MODELS = [
  { id: 'gemini-3.8-live', label: 'Gemini 3.8 Live' },
  { id: 'gemini-3.8-live-extended-thinking', label: 'Gemini 3.8 Live (extended thinking)' },
  { id: 'gemini-live-2.5-flash-preview', label: 'Gemini Live 2.5 Flash (preview)' },
];

const STATIC_FILES: Record<string, { file: string; type: string }> = {
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/index.html': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/styles.css': { file: 'styles.css', type: 'text/css; charset=utf-8' },
  '/app.js': { file: 'app.js', type: 'application/javascript; charset=utf-8' },
};

/* ------------------------------------------------------------------ */
/* Static assets                                                      */
/* ------------------------------------------------------------------ */

/**
 * The HTML/CSS/JS assets are not bundled, so find the `dashboard` folder both
 * when running from the repo root (production bundle) and from src/ (tsx dev).
 */
function resolveDashboardDir(): string {
  const candidates = [path.join(process.cwd(), 'dashboard')];
  const here = typeof __dirname === 'string' ? __dirname : '';
  if (here) candidates.push(path.join(here, 'dashboard'), path.join(here, '..', 'dashboard'));
  for (const dir of candidates) {
    try {
      if (fs.existsSync(path.join(dir, 'index.html'))) return dir;
    } catch {
      /* keep looking */
    }
  }
  return candidates[0];
}

const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0b0d12"/><path d="M20 18h24v8H30c-4 0-6 2-6 5s2 5 6 5h4c7 0 11 4 11 10 0 7-5 11-14 11H16v-8h15c4 0 6-2 6-5s-2-5-6-5h-4c-7 0-11-4-11-10 0-7 5-11 14-11z" fill="#e5484d"/></svg>`;

/* ------------------------------------------------------------------ */
/* State                                                              */
/* ------------------------------------------------------------------ */

let server: http.Server | null = null;
let clientRef: SukunaClient | null = null;
let accessToken = '';
let tokenSource: 'environment' | 'generated' = 'generated';
let sukunaActive = false;

/* ------------------------------------------------------------------ */
/* Lifecycle                                                          */
/* ------------------------------------------------------------------ */

export function startDashboard(client: SukunaClient): void {
  clientRef = client;
  if (server) return;

  const port = Number(process.env.SERVER_PORT) || DEFAULT_PORT;
  const configuredToken = process.env.DASHBOARD_TOKEN?.trim();
  if (configuredToken) {
    accessToken = configuredToken;
    tokenSource = 'environment';
  } else {
    accessToken = crypto.randomBytes(18).toString('base64url');
    tokenSource = 'generated';
  }

  server = http.createServer((req, res) => {
    void handleRequest(req, res).catch((error: unknown) => {
      console.error('[Dashboard] Unhandled request error:', error);
      if (!res.headersSent) sendJson(res, 500, { error: 'Internal Server Error' });
      else res.end();
    });
  });

  server.listen(port, DASHBOARD_HOST, () => {
    console.log('[Dashboard] Listening on http://' + DASHBOARD_HOST + ':' + port);
    if (tokenSource === 'generated') {
      console.log('');
      console.log('  ┌────────────────────────────────────────────────────────────┐');
      console.log('  │  Dashboard access token (set DASHBOARD_TOKEN to override)  │');
      console.log('  └────────────────────────────────────────────────────────────┘');
      console.log('  ' + accessToken);
      console.log('');
    } else {
      console.log('[Dashboard] Using access token from DASHBOARD_TOKEN');
    }
  });

  server.on('error', (error: Error) => {
    console.error('[Dashboard] Server error:', error.message);
  });

  process.once('SIGTERM', () => server?.close());
  process.once('SIGINT', () => server?.close());
}

export function setSukunaActive(active: boolean): void {
  sukunaActive = active;
}

export function isSukunaActive(): boolean {
  return sukunaActive;
}

/* ------------------------------------------------------------------ */
/* Router                                                             */
/* ------------------------------------------------------------------ */

class HttpError extends Error {
  readonly status: number;
  readonly details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  applySecurityHeaders(res);

  const url = new URL(req.url ?? '/', 'http://localhost');
  const pathname = url.pathname;
  const method = req.method ?? 'GET';

  try {
    if (pathname === '/favicon.svg' || pathname === '/favicon.ico') {
      res.writeHead(200, {
        'Content-Type': 'image/svg+xml',
        'Cache-Control': 'public, max-age=86400',
      });
      res.end(FAVICON_SVG);
      return;
    }

    if (pathname === '/api/health') {
      sendJson(res, 200, {
        ok: true,
        name: 'sukuna-dashboard',
        uptimeSeconds: Math.round(process.uptime()),
      });
      return;
    }

    if (method === 'GET' && STATIC_FILES[pathname]) {
      await serveStatic(res, STATIC_FILES[pathname]);
      return;
    }

    if (!pathname.startsWith('/api/')) {
      sendText(res, 404, 'Not Found');
      return;
    }

    if (pathname === '/api/auth/session' && method === 'GET') {
      sendJson(res, 200, { authenticated: isAuthed(req), tokenSource });
      return;
    }

    if (pathname === '/api/auth/login' && method === 'POST') {
      await handleLogin(req, res);
      return;
    }

    if (pathname === '/api/auth/logout' && method === 'POST') {
      res.setHeader(
        'Set-Cookie',
        SESSION_COOKIE + '=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0',
      );
      sendJson(res, 200, { ok: true });
      return;
    }

    if (!isAuthed(req)) {
      throw new HttpError(401, 'Authentication required');
    }

    await routeApi(req, res, pathname, method, url);
  } catch (error) {
    if (error instanceof HttpError) {
      sendJson(res, error.status, {
        error: error.message,
        ...(error.details ? { details: error.details } : {}),
      });
      return;
    }
    if (isDatabaseError(error)) {
      console.error('[Dashboard] Database error:', error);
      recordActivity('error', 'Dashboard database error', { level: 'error' });
      sendJson(res, 503, { error: 'The database is not reachable. Try again in a moment.' });
      return;
    }
    console.error('[Dashboard] API error:', error);
    recordActivity('error', 'Dashboard API error', { level: 'error' });
    sendJson(res, 500, { error: 'Internal Server Error' });
  }
}

async function routeApi(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  pathname: string,
  method: string,
  url: URL,
): Promise<void> {
  const client = clientRef;
  if (!client) throw new HttpError(503, 'Bot client is not ready');

  const parts = pathname.split('/').filter(Boolean); // ['api', 'guilds', id, ...]
  const resource = parts[1];
  const guildId = parts[2];
  const sub = parts[3];
  const subId = parts[4];

  if (resource === 'overview' && method === 'GET') return sendOverview(client, res);
  if (resource === 'activity' && method === 'GET') return sendActivity(res, url);
  if (resource === 'commands' && method === 'GET') return sendCommands(client, res);

  if (resource === 'config') {
    if (method === 'GET') return sendConfig(res);
    if (method === 'PUT' || method === 'POST') return updateConfig(req, res);
    if (method === 'DELETE') return resetConfig(res);
  }

  if (resource === 'persona') {
    // /api/persona/<action> — the action is the third segment, not a guild id.
    if (guildId === 'test' && method === 'POST') return testPersona(req, res);
    if (guildId === 'prompt' && method === 'GET') return sendPersonaPrompt(client, res);
  }

  if (resource === 'guilds') {
    if (!guildId && method === 'GET') return sendGuilds(client, res);
    if (!guildId) throw new HttpError(404, 'Not found');

    const guild = resolveGuild(client, guildId);

    // Tickets sub-resource: /api/guilds/:id/tickets/...
    if (sub === 'tickets') {
      const ticketSub = parts[4]; // 'config' | 'departments' | undefined
      const ticketSubId = parts[5]; // department id

      if (!ticketSub && method === 'GET') return sendTicketOverview(client, guild, res);
      if (ticketSub === 'config' && method === 'PATCH') return updateTicketConfig(guild, req, res);
      if (ticketSub === 'departments' && !ticketSubId && method === 'GET')
        return listTicketDepartments(guild, res);
      if (ticketSub === 'departments' && !ticketSubId && method === 'POST')
        return createTicketDepartment(guild, req, res);
      if (ticketSub === 'departments' && ticketSubId && method === 'PATCH')
        return updateTicketDepartment(guild, ticketSubId, req, res);
      if (ticketSub === 'departments' && ticketSubId && method === 'DELETE')
        return deleteTicketDepartment(guild, ticketSubId, res);
      throw new HttpError(404, 'Not found');
    }

    if (!sub && method === 'GET') return sendGuildDetail(client, guild, res);
    if (!sub && (method === 'PATCH' || method === 'PUT')) return updateGuild(client, guild, req, res);
    if (!sub && method === 'DELETE') throw new HttpError(405, 'Guilds cannot be deleted');

    if (sub === 'channels' && method === 'GET') {
      return sendJson(res, 200, { channels: serializeChannels(guild) });
    }

    if (sub === 'memories') {
      if (!subId && method === 'GET') return listMemories(guild, url, res);
      if (!subId && method === 'DELETE') return clearGuildMemories(guild, res);
      if (subId && method === 'DELETE') return deleteMemory(guild, subId, res);
    }

    if (sub === 'rules') {
      if (method === 'GET') return sendRules(guild, res);
      if (method === 'PUT' || method === 'POST') return saveRules(guild, req, res);
    }

    if (sub === 'faq') {
      if (!subId && method === 'GET') return sendFaq(guild, res);
      if (!subId && method === 'POST') return addFaq(guild, req, res);
      if (subId && (method === 'PATCH' || method === 'PUT')) return editFaq(guild, subId, req, res);
      if (subId && method === 'DELETE') return removeFaq(guild, subId, res);
    }

    if (sub === 'announcements') {
      if (!subId && method === 'GET') return sendAnnouncements(guild, res);
      if (!subId && method === 'POST') return addAnnouncement(guild, req, res);
      if (subId && method === 'DELETE') return removeAnnouncement(guild, subId, res);
    }

    if (sub === 'scheduled') {
      if (!subId && method === 'GET') return sendScheduled(guild, res);
      if (!subId && method === 'POST') return addScheduled(guild, req, res);
      if (subId && method === 'DELETE') return removeScheduled(guild, subId, res);
    }

    if (sub === 'events') {
      if (!subId && method === 'GET') return sendEvents(guild, res);
      if (!subId && method === 'POST') return addEvent(guild, req, res);
    }

    if (sub === 'automod') {
      if (!subId && method === 'GET') return sendAutomodRules(guild, res);
      if (!subId && method === 'POST') return createAutomodRule(guild, req, res);
      if (subId && method === 'PATCH') return updateAutomodRule(guild, subId, req, res);
      if (subId && method === 'DELETE') return deleteAutomodRule(guild, subId, res);
      throw new HttpError(404, 'Not found');
    }

    if (sub === 'reactionroles') {
      if (!subId && method === 'GET') return sendReactionRolePanels(guild, res);
      if (!subId && method === 'POST') return createReactionRolePanel(guild, req, res);
      if (subId && method === 'PATCH') return updateReactionRolePanel(guild, subId, req, res);
      if (subId && method === 'DELETE') return deleteReactionRolePanel(guild, subId, res);
      throw new HttpError(404, 'Not found');
    }

    if (sub === 'customcmd') {
      if (!subId && method === 'GET') return sendCustomCommands(guild, res);
      if (!subId && method === 'POST') return createCustomCommand(guild, req, res);
      if (subId && method === 'PATCH') return updateCustomCommand(guild, subId, req, res);
      if (subId && method === 'DELETE') return deleteCustomCommand(guild, subId, res);
      throw new HttpError(404, 'Not found');
    }

    if (sub === 'theme') {
      if (method === 'GET') return sendThemeConfig(guild, res);
      if (method === 'PUT' || method === 'POST') return updateThemeConfig(guild, req, res);
      throw new HttpError(404, 'Not found');
    }

    if (sub === 'colorroles') {
      if (!subId && method === 'GET') return sendColorRoles(guild, res);
      if (!subId && method === 'POST') return createColorRole(guild, req, res);
      if (subId && method === 'PATCH') return updateColorRole(guild, subId, req, res);
      if (subId && method === 'DELETE') return deleteColorRole(guild, subId, res);
      throw new HttpError(404, 'Not found');
    }

    if (sub === 'welcome') {
      if (method === 'GET') return sendWelcomeConfig(guild, res);
      if (method === 'PUT' || method === 'POST') return updateWelcomeConfig(guild, req, res);
      throw new HttpError(404, 'Not found');
    }

    if (sub === 'starboard') {
      if (method === 'GET') return sendStarboardConfig(guild, res);
      if (method === 'PUT' || method === 'POST') return updateStarboardConfig(guild, req, res);
      throw new HttpError(404, 'Not found');
    }
  }

  if (resource === 'users') {
    if (!guildId && method === 'GET') return sendUsers(client, url, res);
    if (guildId && method === 'PATCH') return updateUserDoc(guildId, req, res);
  }


  throw new HttpError(404, 'Not found');
}

/* ------------------------------------------------------------------ */
/* Auth                                                               */
/* ------------------------------------------------------------------ */

async function handleLogin(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const ip = req.socket.remoteAddress ?? 'unknown';
  const now = Date.now();
  const attempt = loginAttempts.get(ip);
  if (attempt && attempt.resetAt > now && attempt.count >= 10) {
    throw new HttpError(429, 'Too many login attempts. Try again in a few minutes.');
  }
  if (!attempt || attempt.resetAt <= now) {
    loginAttempts.set(ip, { count: 0, resetAt: now + 15 * 60 * 1000 });
  }

  const body = await readJson(req);
  const token = typeof body.token === 'string' ? body.token.trim() : '';
  if (!token || !accessToken || !safeEqual(token, accessToken)) {
    const current = loginAttempts.get(ip)!;
    current.count += 1;
    throw new HttpError(401, 'Invalid access token');
  }

  loginAttempts.delete(ip);
  const secure = isHttps(req) ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    SESSION_COOKIE +
      '=' +
      createSession() +
      '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' +
      Math.floor(SESSION_TTL_MS / 1000) +
      secure,
  );
  sendJson(res, 200, { ok: true });
}

function createSession(): string {
  const exp = Date.now() + SESSION_TTL_MS;
  const payload = Buffer.from(JSON.stringify({ exp })).toString('base64url');
  const signature = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return payload + '.' + signature;
}

function verifySession(value: string): boolean {
  const dot = value.indexOf('.');
  if (dot <= 0 || dot === value.length - 1) return false;
  const payload = value.slice(0, dot);
  const signature = value.slice(dot + 1);
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  if (!safeEqual(signature, expected)) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { exp?: unknown };
    return typeof data.exp === 'number' && data.exp > Date.now();
  } catch {
    return false;
  }
}

function isAuthed(req: http.IncomingMessage): boolean {
  const cookie = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (cookie && verifySession(cookie)) return true;

  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    return safeEqual(header.slice(7).trim(), accessToken);
  }
  return false;
}

function parseCookies(header?: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!key) continue;
    try {
      cookies[key] = decodeURIComponent(value);
    } catch {
      cookies[key] = value;
    }
  }
  return cookies;
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function isHttps(req: http.IncomingMessage): boolean {
  return req.headers['x-forwarded-proto'] === 'https';
}

/* ------------------------------------------------------------------ */
/* API: overview / activity / commands                                */
/* ------------------------------------------------------------------ */

function sendOverview(client: SukunaClient, res: http.ServerResponse): void {
  const user = client.user;
  const guilds = filterDashboardGuilds(client);
  const memory = process.memoryUsage();
  const config = getSukunaConfig();

  sendJson(res, 200, {
    bot: user
      ? {
          id: user.id,
          tag: user.tag,
          username: user.username,
          avatar: user.displayAvatarURL({ size: 128, extension: 'png' }),
          createdAt: user.createdTimestamp,
        }
      : null,
    uptimeMs: Date.now() - client.startedAt,
    processUptimeMs: Math.round(process.uptime() * 1000),
    ping: client.ws.ping,
    guilds: guilds.length,
    members: guilds.reduce((total, guild) => total + guild.memberCount, 0),
    channels: guilds.reduce((total, guild) => total + guild.channels.cache.size, 0),
    commands: client.commands.size,
    memory: {
      rss: memory.rss,
      heapUsed: memory.heapUsed,
      heapTotal: memory.heapTotal,
    },
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      pid: process.pid,
    },
    database: {
      state: dbState(),
      name: mongoose.connection.name ?? null,
    },
    persona: {
      enabled: config.enabled,
      displayName: config.displayName,
      model: config.model,
      temperature: config.temperature,
      channels: config.channelIds.length,
      hasApiKey: Boolean(process.env.GEMINI_API_KEY),
    },
    counters: getCounters(),
    dashboard: {
      tokenSource,
      host: DASHBOARD_HOST,
      port: Number(process.env.SERVER_PORT) || DEFAULT_PORT,
    },
  });
}

function sendActivity(res: http.ServerResponse, url: URL): void {
  const limit = Number(url.searchParams.get('limit')) || 100;
  const requested = url.searchParams.get('kind') ?? 'all';
  const kind = (ACTIVITY_KINDS as string[]).includes(requested)
    ? (requested as ActivityKind | 'all')
    : 'all';

  sendJson(res, 200, {
    events: getActivity(limit, kind),
    counters: getCounters(),
  });
}

function sendCommands(client: SukunaClient, res: http.ServerResponse): void {
  const commands = [...client.commands.values()].map((command) => ({
    name: command.data.name,
    description: (command.data as { description?: string }).description ?? '',
    category: command.category,
    cooldownSeconds: command.cooldownSeconds ?? 1,
    premiumOnly: command.premiumOnly ?? false,
    allowWhenDisabled: command.allowWhenDisabled ?? false,
    userPermissions: (command.userPermissions ?? []).map(permissionLabel),
    botPermissions: (command.botPermissions ?? []).map(permissionLabel),
    options: serializeCommandOptions(command.data),
  }));

  commands.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  sendJson(res, 200, { commands });
}

function serializeCommandOptions(data: unknown): Array<{ name: string; description: string; required: boolean; type: string }> {
  const json = (data as { toJSON?: () => { options?: unknown[] } }).toJSON?.();
  const options = json?.options;
  if (!Array.isArray(options)) return [];
  return options
    .filter((option): option is Record<string, unknown> => Boolean(option) && typeof option === 'object')
    .map((option) => ({
      name: String(option.name ?? ''),
      description: String(option.description ?? ''),
      required: Boolean(option.required),
      type: optionTypeName(Number(option.type)),
    }));
}

function optionTypeName(type: number): string {
  const names: Record<number, string> = {
    3: 'string',
    4: 'integer',
    5: 'boolean',
    6: 'user',
    7: 'channel',
    8: 'role',
    9: 'mentionable',
    10: 'number',
    11: 'attachment',
  };
  return names[type] ?? 'option';
}

function permissionLabel(permission: unknown): string {
  if (typeof permission === 'bigint') return permission.toString();
  return String(permission);
}

/* ------------------------------------------------------------------ */
/* API: persona configuration                                         */
/* ------------------------------------------------------------------ */

function sendConfig(res: http.ServerResponse): void {
  sendJson(res, 200, {
    config: getSukunaConfig(),
    defaults: { ...defaultSukunaConfig, systemPrompt: '', thinkingLevel: null },
    models: SUGGESTED_MODELS,
    hasGeminiKey: Boolean(process.env.GEMINI_API_KEY),
  });
}

async function updateConfig(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const body = await readJson(req);
  const parsed = sukunaConfigPatchSchema.safeParse(body);
  if (!parsed.success) {
    throw new HttpError(400, 'Invalid configuration', parsed.error.flatten());
  }

  const patch = { ...parsed.data } as Record<string, unknown>;
  if (patch.systemPrompt === null) patch.systemPrompt = undefined;
  if (patch.thinkingLevel === null) patch.thinkingLevel = undefined;

  const saved = await persistOrFail(() => saveSukunaConfig(patch as Partial<SukunaConfig>));
  setSukunaActive(saved.enabled);
  recordActivity('system', 'Persona configuration saved', {
    level: 'success',
    meta: { model: saved.model, enabled: saved.enabled },
  });
  sendJson(res, 200, { config: saved });
}

async function resetConfig(res: http.ServerResponse): Promise<void> {
  const config = await persistOrFail(() => resetSukunaConfig());
  setSukunaActive(config.enabled);
  recordActivity('system', 'Persona configuration reset to defaults', { level: 'warn' });
  sendJson(res, 200, { config });
}

/** Turns a database failure into a clear 503 instead of a generic 500. */
async function persistOrFail<T>(task: () => Promise<T>): Promise<T> {
  try {
    return await task();
  } catch (error) {
    console.error('[Dashboard] Config persistence failed:', error);
    throw new HttpError(503, 'Could not save settings: the database is not reachable.');
  }
}

function sendPersonaPrompt(client: SukunaClient, res: http.ServerResponse): void {
  const config = getSukunaConfig();
  const runtime = buildRuntimePrompt(config, client.user?.id);
  sendJson(res, 200, {
    defaultPrompt: SUKUNA_DEFAULT_PROMPT,
    systemPrompt: config.systemPrompt ?? '',
    runtimePrompt: runtime,
    effectivePrompt: (config.systemPrompt?.trim() || SUKUNA_DEFAULT_PROMPT) + '\n\n' + runtime,
  });
}

async function testPersona(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const body = await readJson(req);
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) throw new HttpError(400, 'A test prompt is required');
  if (prompt.length > 4000) throw new HttpError(400, 'Test prompt is too long (max 4000 characters)');

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new HttpError(400, 'GEMINI_API_KEY is not configured on the bot host');
  }

  const config = getSukunaConfig();
  const systemPrompt =
    (config.systemPrompt?.trim() || SUKUNA_DEFAULT_PROMPT) + '\n\n' + buildRuntimePrompt(config, clientRef?.user?.id);

  const startedAt = Date.now();
  let response = '';
  try {
    // Live models reject generateContent, so the test runs a real Live turn.
    response = await generateLiveText({
      apiKey,
      model: config.model,
      systemPrompt,
      prompt,
      temperature: config.temperature,
      timeoutMs: Math.min(Math.max(config.requestTimeoutMs, 5000), 60000),
    });
  } catch (error) {
    throw new HttpError(
      502,
      'Gemini Live request failed: ' + (error instanceof Error ? error.message : 'unknown error'),
    );
  }

  const elapsedMs = Date.now() - startedAt;
  const silent = !response.trim();
  const answer = silent
    ? `(${config.displayName || DEFAULT_DISPLAY_NAME} chose to stay silent for this prompt — that is a valid decision.)`
    : response.slice(0, 10000);

  recordActivity('ai', silent ? 'Persona test: stayed silent' : 'Persona test succeeded', {
    level: 'success',
    meta: { model: config.model, ms: elapsedMs, chars: response.length },
  });
  sendJson(res, 200, { response: answer, silent, model: config.model, elapsedMs });
}

function buildRuntimePrompt(config: SukunaConfig, botId?: string): string {
  return buildSukunaRuntimePrompt({
    displayName: config.displayName || DEFAULT_DISPLAY_NAME,
    botId,
    toolsEnabled: config.toolsEnabled ?? true,
    memoryEnabled: config.memoryEnabled ?? true,
    maxMessageLength: Math.min(config.maxMessageLength || 2000, 2000),
  });
}

/* ------------------------------------------------------------------ */
/* API: guilds                                                         */
/* ------------------------------------------------------------------ */

function resolveGuild(client: SukunaClient, guildId: string): Guild {
  if (!/^\d{5,25}$/.test(guildId)) throw new HttpError(400, 'Invalid guild id');
  const guild = client.guilds.cache.get(guildId);
  if (!guild) throw new HttpError(404, 'Guild not found (has the bot been removed?)');
  return guild;
}

function sendGuilds(client: SukunaClient, res: http.ServerResponse): void {
  const guilds = filterDashboardGuilds(client)
    .map(serializeGuild)
    .sort((a, b) => b.members - a.members || a.name.localeCompare(b.name));
  sendJson(res, 200, { guilds });
}

/**
 * When GUILD_ID is set, the dashboard only surfaces that single guild so the
 * control panel never lists guilds the bot is not meant to run in.
 */
function filterDashboardGuilds(client: SukunaClient): Guild[] {
  const allowed = client.env?.GUILD_ID;
  const all = [...client.guilds.cache.values()];
  if (!allowed) return all;
  return all.filter((guild) => guild.id === allowed);
}

async function sendGuildDetail(
  client: SukunaClient,
  guild: Guild,
  res: http.ServerResponse,
): Promise<void> {
  const row = await readGuildConfig(guild.id);
  const [memoryCount, faqCount, announcementCount, scheduledCount] = await Promise.all([
    countMemories(guild.id),
    SukunaFaq.countDocuments({ guildId: guild.id }),
    SukunaAnnouncement.countDocuments({ guildId: guild.id }),
    countScheduled(guild.id),
  ]);

  sendJson(res, 200, {
    guild: serializeGuild(guild),
    config: serializeGuildConfig(row),
    channels: serializeChannels(guild),
    roles: serializeRoles(guild),
    counts: {
      memories: memoryCount,
      faq: faqCount,
      announcements: announcementCount,
      scheduled: scheduledCount,
    },
  });
}

/* -------------------------------------------------------------------------- */
/* API: ticket configuration (guild level)                                    */
/* -------------------------------------------------------------------------- */

const ticketConfigPatchSchema = z
  .object({
    maxTicketsPerUser: z.number().int().min(1).max(100).optional(),
    cooldownSeconds: z.number().int().min(0).max(86400).optional(),
    dmTranscript: z.boolean().optional(),
    transcriptChannelId: z.string().regex(/^\d{5,25}$/).nullable().optional(),
    autoCloseMinutes: z.number().int().min(0).max(525600).optional(),
    staffRoleIds: z.array(z.string().regex(/^\d{5,25}$/)).max(100).optional(),
  })
  .strict();

const ticketDepartmentSchema = z
  .object({
    name: z.string().trim().min(1).max(50),
    description: z.string().trim().min(1).max(200).default('General support'),
    emoji: z.string().trim().min(1).max(10).default('🎫'),
    color: z.number().int().min(0).max(0xffffff).default(0x5865f2),
    staffRoleId: z.string().regex(/^\d{5,25}$/).nullable().optional(),
    welcomeMessage: z.string().trim().min(1).max(1000).optional(),
    isActive: z.boolean().default(true),
  })
  .strict();

async function sendTicketOverview(
  client: SukunaClient,
  guild: Guild,
  res: http.ServerResponse,
): Promise<void> {
  const [config, departments, panels, openTickets] = await Promise.all([
    TicketConfig.findOne({ guildId: guild.id }).lean(),
    TicketDepartment.find({ guildId: guild.id }).sort({ createdAt: 1 }).lean(),
    TicketPanel.countDocuments({ guildId: guild.id }),
    OpenTicket.countDocuments({ guildId: guild.id, closedAt: null }),
  ]);

  const resolved = config ?? defaultTicketConfig(guild.id);

  sendJson(res, 200, {
    config: {
      maxTicketsPerUser: resolved.maxTicketsPerUser,
      cooldownSeconds: resolved.cooldownSeconds,
      dmTranscript: resolved.dmTranscript,
      transcriptChannelId: resolved.transcriptChannelId ?? null,
      autoCloseMinutes: resolved.autoCloseMinutes,
      staffRoleIds: resolved.staffRoleIds,
    },
    departments: departments.map((dept) => ({
      id: String(dept._id),
      name: dept.name,
      description: dept.description,
      emoji: dept.emoji,
      color: dept.color,
      staffRoleId: dept.staffRoleId ?? null,
      welcomeMessage: dept.welcomeMessage,
      isActive: dept.isActive,
    })),
    stats: {
      panels,
      openTickets,
    },
  });
}

async function updateTicketConfig(
  guild: Guild,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const parsed = ticketConfigPatchSchema.safeParse(await readJson(req));
  if (!parsed.success) throw new HttpError(400, 'Invalid ticket config', parsed.error.flatten());

  const data = parsed.data;

  // Validate that configured channels/roles exist in this guild.
  if (data.transcriptChannelId && !guild.channels.cache.has(data.transcriptChannelId)) {
    throw new HttpError(400, 'Transcript log channel does not exist in this guild');
  }
  for (const roleId of data.staffRoleIds ?? []) {
    if (!guild.roles.cache.has(roleId)) {
      throw new HttpError(400, `Staff role ${roleId} does not exist in this guild`);
    }
  }

  let config = await TicketConfig.findOne({ guildId: guild.id });
  if (!config) {
    config = await TicketConfig.create(defaultTicketConfig(guild.id));
  }

  if (data.maxTicketsPerUser !== undefined) config.maxTicketsPerUser = data.maxTicketsPerUser;
  if (data.cooldownSeconds !== undefined) config.cooldownSeconds = data.cooldownSeconds;
  if (data.dmTranscript !== undefined) config.dmTranscript = data.dmTranscript;
  if (data.transcriptChannelId !== undefined)
    config.transcriptChannelId = data.transcriptChannelId ?? undefined;
  if (data.autoCloseMinutes !== undefined) config.autoCloseMinutes = data.autoCloseMinutes;
  if (data.staffRoleIds !== undefined) config.staffRoleIds = data.staffRoleIds;

  await config.save();

  sendJson(res, 200, {
    config: {
      maxTicketsPerUser: config.maxTicketsPerUser,
      cooldownSeconds: config.cooldownSeconds,
      dmTranscript: config.dmTranscript,
      transcriptChannelId: config.transcriptChannelId ?? null,
      autoCloseMinutes: config.autoCloseMinutes,
      staffRoleIds: config.staffRoleIds,
    },
  });
}

async function listTicketDepartments(guild: Guild, res: http.ServerResponse): Promise<void> {
  const departments = await TicketDepartment.find({ guildId: guild.id }).sort({ createdAt: 1 }).lean();
  sendJson(res, 200, {
    departments: departments.map((dept) => ({
      id: String(dept._id),
      name: dept.name,
      description: dept.description,
      emoji: dept.emoji,
      color: dept.color,
      staffRoleId: dept.staffRoleId ?? null,
      welcomeMessage: dept.welcomeMessage,
      isActive: dept.isActive,
    })),
  });
}

async function createTicketDepartment(
  guild: Guild,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const parsed = ticketDepartmentSchema.safeParse(await readJson(req));
  if (!parsed.success) throw new HttpError(400, 'Invalid department', parsed.error.flatten());

  const data = parsed.data;

  if (data.staffRoleId && !guild.roles.cache.has(data.staffRoleId)) {
    throw new HttpError(400, 'Staff role does not exist in this guild');
  }

  const existing = await TicketDepartment.findOne({
    guildId: guild.id,
    name: data.name,
  });
  if (existing) throw new HttpError(409, 'A department with this name already exists.');

  const dept = await TicketDepartment.create({
    guildId: guild.id,
    name: data.name,
    description: data.description,
    emoji: data.emoji,
    color: data.color,
    staffRoleId: data.staffRoleId ?? undefined,
    welcomeMessage: data.welcomeMessage,
    isActive: data.isActive,
  });

  sendJson(res, 201, {
    id: String(dept._id),
    name: dept.name,
    description: dept.description,
    emoji: dept.emoji,
    color: dept.color,
    staffRoleId: dept.staffRoleId ?? null,
    welcomeMessage: dept.welcomeMessage,
    isActive: dept.isActive,
  });
}

async function updateTicketDepartment(
  guild: Guild,
  departmentId: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const parsed = ticketDepartmentSchema.partial().safeParse(await readJson(req));
  if (!parsed.success) throw new HttpError(400, 'Invalid department update', parsed.error.flatten());

  const data = parsed.data;
  const dept = await TicketDepartment.findOne({ _id: departmentId, guildId: guild.id });
  if (!dept) throw new HttpError(404, 'Department not found');

  if (data.name !== undefined && data.name !== dept.name) {
    const existing = await TicketDepartment.findOne({
      guildId: guild.id,
      name: data.name,
    });
    if (existing) throw new HttpError(409, 'A department with this name already exists.');
    dept.name = data.name;
  }
  if (data.description !== undefined) dept.description = data.description;
  if (data.emoji !== undefined) dept.emoji = data.emoji;
  if (data.color !== undefined) dept.color = data.color;
  if (data.staffRoleId !== undefined) {
    if (data.staffRoleId && !guild.roles.cache.has(data.staffRoleId)) {
      throw new HttpError(400, 'Staff role does not exist in this guild');
    }
    dept.staffRoleId = data.staffRoleId || undefined;
  }
  if (data.welcomeMessage !== undefined) dept.welcomeMessage = data.welcomeMessage;
  if (data.isActive !== undefined) dept.isActive = data.isActive;

  await dept.save();

  sendJson(res, 200, {
    id: String(dept._id),
    name: dept.name,
    description: dept.description,
    emoji: dept.emoji,
    color: dept.color,
    staffRoleId: dept.staffRoleId ?? null,
    welcomeMessage: dept.welcomeMessage,
    isActive: dept.isActive,
  });
}

async function deleteTicketDepartment(
  guild: Guild,
  departmentId: string,
  res: http.ServerResponse,
): Promise<void> {
  const dept = await TicketDepartment.findOne({ _id: departmentId, guildId: guild.id });
  if (!dept) throw new HttpError(404, 'Department not found');

  const panelCount = await TicketPanel.countDocuments({ guildId: guild.id });
  if (panelCount > 0) {
    throw new HttpError(409, 'Cannot delete a department while ticket panels exist. Remove panels first.');
  }

  await TicketDepartment.deleteOne({ _id: departmentId });
  sendJson(res, 200, { ok: true });
}

const guildPatchSchema = z
  .object({
    modules: z.record(z.string().min(1).max(40), z.boolean()).optional(),
    xpEnabled: z.boolean().optional(),
    xpCooldown: z.number().int().min(0).max(3600).optional(),
    xpMin: z.number().int().min(0).max(1000).optional(),
    xpMax: z.number().int().min(0).max(1000).optional(),
    xpVoiceMin: z.number().int().min(0).max(1000).optional(),
    xpVoiceMax: z.number().int().min(0).max(1000).optional(),
    xpIgnoreBots: z.boolean().optional(),
    xpChannel: z.string().regex(/^\d{5,25}$/).nullable().optional(),
    levelUpChannel: z.string().regex(/^\d{5,25}$/).nullable().optional(),
    levelUpMessage: z.string().max(2000).nullable().optional(),
    disableXpChannels: z.array(z.string().regex(/^\d{5,25}$/)).max(200).optional(),
    levelRoles: z
      .record(z.string().regex(/^\d+$/).max(10), z.string().regex(/^\d{5,25}$/))
      .optional(),
    liveLeaderboard: z
      .object({
        enabled: z.boolean().optional(),
        channelId: z.string().regex(/^\d{5,25}$/).nullable().optional(),
        intervalMinutes: z.number().int().min(1).max(1440).optional(),
        rows: z.number().int().min(3).max(25).optional(),
        title: z.string().max(100).nullable().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

async function updateGuild(
  client: SukunaClient,
  guild: Guild,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const parsed = guildPatchSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    throw new HttpError(400, 'Invalid guild settings', parsed.error.flatten());
  }
  const data = parsed.data;
  const current = await readGuildConfig(guild.id);
  const updates: Record<string, unknown> = {};

  if (data.modules) {
    const merged = normalizeModules(current?.modules);
    for (const key of ALLOWED_MODULES) {
      if (data.modules[key] !== undefined) merged[key] = data.modules[key];
    }
    updates.modules = merged;
  }

  if (data.xpEnabled !== undefined) updates.xpEnabled = data.xpEnabled;
  if (data.xpCooldown !== undefined) updates.xpCooldown = data.xpCooldown;

  const nextMin = data.xpMin ?? current?.xpMin ?? 15;
  const nextMax = data.xpMax ?? current?.xpMax ?? 25;
  if (nextMin > nextMax) throw new HttpError(400, 'Minimum XP cannot exceed maximum XP');
  if (data.xpMin !== undefined) updates.xpMin = data.xpMin;
  if (data.xpMax !== undefined) updates.xpMax = data.xpMax;

  const nextVoiceMin = data.xpVoiceMin ?? current?.xpVoiceMin ?? 5;
  const nextVoiceMax = data.xpVoiceMax ?? current?.xpVoiceMax ?? 8;
  if (nextVoiceMin > nextVoiceMax) {
    throw new HttpError(400, 'Minimum voice XP cannot exceed maximum voice XP');
  }
  if (data.xpVoiceMin !== undefined) updates.xpVoiceMin = data.xpVoiceMin;
  if (data.xpVoiceMax !== undefined) updates.xpVoiceMax = data.xpVoiceMax;
  if (data.xpIgnoreBots !== undefined) updates.xpIgnoreBots = data.xpIgnoreBots;

  if (data.xpChannel !== undefined) {
    if (data.xpChannel && !guild.channels.cache.has(data.xpChannel)) {
      throw new HttpError(400, 'XP channel does not exist in this guild');
    }
    updates.xpChannel = data.xpChannel ?? '';
  }

  if (data.levelUpChannel !== undefined) {
    if (data.levelUpChannel && !guild.channels.cache.has(data.levelUpChannel)) {
      throw new HttpError(400, 'Level-up channel does not exist in this guild');
    }
    updates.levelUpChannel = data.levelUpChannel;
  }
  if (data.levelUpMessage !== undefined) updates.levelUpMessage = data.levelUpMessage;
  if (data.disableXpChannels !== undefined) updates.disableXpChannels = data.disableXpChannels;

  if (data.levelRoles !== undefined) {
    for (const roleId of Object.values(data.levelRoles)) {
      if (!guild.roles.cache.has(roleId)) {
        throw new HttpError(400, `Level reward role ${roleId} does not exist in this guild`);
      }
    }
    updates.levelRoles = data.levelRoles;
  }

  let liveChanged = false;
  if (data.liveLeaderboard !== undefined) {
    const previous = {
      enabled: current?.liveLeaderboard?.enabled ?? false,
      channelId: current?.liveLeaderboard?.channelId ?? '',
      messageId: current?.liveLeaderboard?.messageId ?? '',
      intervalMinutes: current?.liveLeaderboard?.intervalMinutes ?? 10,
      rows: current?.liveLeaderboard?.rows ?? 25,
      title: current?.liveLeaderboard?.title ?? '',
    };
    const patch = data.liveLeaderboard;
    if (patch.channelId && !guild.channels.cache.has(patch.channelId)) {
      throw new HttpError(400, 'Live leaderboard channel does not exist in this guild');
    }
    const channelId = patch.channelId === undefined ? previous.channelId : (patch.channelId ?? '');
    updates.liveLeaderboard = {
      enabled: patch.enabled ?? previous.enabled,
      channelId,
      // A channel change invalidates the stored message id: the old message is
      // not in the new channel and would never be found again.
      messageId: channelId === previous.channelId ? previous.messageId : '',
      intervalMinutes: patch.intervalMinutes ?? previous.intervalMinutes,
      rows: patch.rows ?? previous.rows,
      title: patch.title === undefined ? previous.title : (patch.title ?? ''),
    };
    liveChanged = true;
  }

  if (Object.keys(updates).length === 0) throw new HttpError(400, 'No changes supplied');

  await updateGuildConfig(guild.id, updates);
  const fresh = await readGuildConfig(guild.id);
  client.cacheSettings(guild.id, fresh ?? { modules: {} }, Date.now());

  if (liveChanged) {
    invalidateLiveLeaderboard(guild.id);
    const live = fresh?.liveLeaderboard;
    if (live?.enabled && live.channelId) {
      void refreshLiveLeaderboard(client, guild.id, { force: true }).catch((err) => {
        recordActivity('error', 'Live leaderboard refresh failed', {
          level: 'error',
          meta: { guildId: guild.id, error: String(err) },
        });
      });
    }
  }

  recordActivity('system', 'Guild settings updated: ' + guild.name, {
    level: 'success',
    meta: { guildId: guild.id },
  });

  sendJson(res, 200, {
    guild: serializeGuild(guild),
    config: serializeGuildConfig(fresh),
    channels: serializeChannels(guild),
    roles: serializeRoles(guild),
  });
}

function serializeRoles(guild: Guild) {
  return [...guild.roles.cache.values()]
    .filter((role) => role.id !== guild.id && !role.managed)
    .map((role) => ({
      id: role.id,
      name: role.name,
      color: role.hexColor,
      position: role.position,
    }))
    .sort((a, b) => b.position - a.position);
}

function serializeGuild(guild: Guild) {
  return {
    id: guild.id,
    name: guild.name,
    icon: guild.iconURL({ size: 128, extension: 'png' }),
    description: guild.description ?? null,
    members: guild.memberCount,
    ownerId: guild.ownerId,
    channels: guild.channels.cache.size,
    roles: guild.roles.cache.size,
    boosts: guild.premiumSubscriptionCount ?? 0,
    boostTier: guild.premiumTier,
    createdAt: guild.createdTimestamp,
    joinedAt: guild.joinedTimestamp,
  };
}

function serializeChannels(guild: Guild) {
  return [...guild.channels.cache.values()]
    .filter((channel) => channel.isTextBased())
    .map((channel) => {
      const anyChannel = channel as unknown as {
        id: string;
        name: string;
        type: number;
        parentId: string | null;
        rawPosition: number;
        nsfw?: boolean;
      };
      return {
        id: anyChannel.id,
        name: anyChannel.name,
        type: anyChannel.type,
        parentId: anyChannel.parentId ?? null,
        position: anyChannel.rawPosition ?? 0,
        nsfw: Boolean(anyChannel.nsfw),
      };
    })
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
}

function serializeGuildConfig(
  row:
    | {
        modules?: unknown;
        xpEnabled?: boolean;
        xpCooldown?: number;
        xpMin?: number;
        xpMax?: number;
        xpVoiceMin?: number;
        xpVoiceMax?: number;
        xpIgnoreBots?: boolean;
        xpChannel?: string | null;
        levelUpChannel?: string | null;
        levelUpMessage?: string | null;
        disableXpChannels?: string[];
        levelRoles?: unknown;
        liveLeaderboard?: {
          enabled?: boolean;
          channelId?: string;
          messageId?: string;
          intervalMinutes?: number;
          rows?: number;
          title?: string;
        };
        updatedAt?: unknown;
      }
    | null
    | undefined,
) {
  const live = row?.liveLeaderboard ?? {};
  return {
    modules: normalizeModules(row?.modules),
    xpEnabled: row?.xpEnabled ?? true,
    xpCooldown: row?.xpCooldown ?? 60,
    xpMin: row?.xpMin ?? 15,
    xpMax: row?.xpMax ?? 25,
    xpVoiceMin: row?.xpVoiceMin ?? 5,
    xpVoiceMax: row?.xpVoiceMax ?? 8,
    xpIgnoreBots: row?.xpIgnoreBots ?? true,
    xpChannel: row?.xpChannel ?? null,
    levelUpChannel: row?.levelUpChannel ?? null,
    levelUpMessage: row?.levelUpMessage ?? null,
    disableXpChannels: Array.isArray(row?.disableXpChannels) ? row.disableXpChannels : [],
    levelRoles: normalizeLevelRoles(row?.levelRoles),
    liveLeaderboard: {
      enabled: live.enabled ?? false,
      channelId: live.channelId ?? '',
      messageId: live.messageId ?? '',
      intervalMinutes: live.intervalMinutes ?? 10,
      rows: live.rows ?? 25,
      title: live.title ?? '',
    },
    updatedAt: row?.updatedAt ?? null,
  };
}

function normalizeLevelRoles(value: unknown): Record<string, string> {
  const source =
    value instanceof Map
      ? (Object.fromEntries(value as Map<string, unknown>) as Record<string, unknown>)
      : value && typeof value === 'object'
        ? (value as Record<string, unknown>)
        : {};
  const result: Record<string, string> = {};
  for (const [level, roleId] of Object.entries(source)) {
    if (!/^\d+$/.test(level)) continue;
    if (typeof roleId !== 'string' || roleId === '') continue;
    result[String(Number.parseInt(level, 10))] = roleId;
  }
  return result;
}

function normalizeModules(value: unknown): Record<string, boolean> {
  if (!value) return {};
  if (value instanceof Map) return Object.fromEntries(value as Map<string, boolean>);
  if (typeof value === 'object') {
    const result: Record<string, boolean> = {};
    for (const [key, enabled] of Object.entries(value as Record<string, unknown>)) {
      result[key] = Boolean(enabled);
    }
    return result;
  }
  return {};
}

/* ------------------------------------------------------------------ */
/* API: memories / rules / FAQ / announcements / scheduling           */
/* ------------------------------------------------------------------ */

async function listMemories(guild: Guild, url: URL, res: http.ServerResponse): Promise<void> {
  const query = url.searchParams.get('q')?.trim() ?? '';
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 100, 1), 300);
  const filter: Record<string, unknown> = { guildId: guild.id };
  if (query) {
    const pattern = new RegExp(escapeRegex(query), 'i');
    filter.$or = [{ fact: pattern }, { aboutName: pattern }, { aboutUserId: query }];
  }

  const [memories, total] = await Promise.all([
    SukunaMemory.find(filter).sort({ createdAt: -1 }).limit(limit).lean(),
    countMemories(guild.id),
  ]);

  sendJson(res, 200, {
    memories: memories.map((memory) => ({
      id: String(memory._id),
      fact: memory.fact,
      aboutUserId: memory.aboutUserId ?? null,
      aboutName: memory.aboutName ?? null,
      createdAt: memory.createdAt,
    })),
    total,
    max: 300,
  });
}

async function deleteMemory(guild: Guild, memoryId: string, res: http.ServerResponse): Promise<void> {
  requireObjectId(memoryId);
  const deleted = await SukunaMemory.findOneAndDelete({ _id: memoryId, guildId: guild.id });
  if (!deleted) throw new HttpError(404, 'Memory not found');
  recordActivity('system', 'Memory deleted', { meta: { guildId: guild.id } });
  sendJson(res, 200, { ok: true });
}

async function clearGuildMemories(guild: Guild, res: http.ServerResponse): Promise<void> {
  const deleted = await clearMemories(guild.id);
  recordActivity('system', 'Cleared ' + deleted + ' memories', {
    level: 'warn',
    meta: { guildId: guild.id },
  });
  sendJson(res, 200, { ok: true, deleted });
}

const rulesSchema = z
  .object({ rules: z.array(z.string().trim().min(1).max(500)).max(100) })
  .strict();

async function sendRules(guild: Guild, res: http.ServerResponse): Promise<void> {
  const row = await getServerRules(guild.id);
  sendJson(res, 200, {
    rules: row?.rules ?? [],
    updatedAt: (row as { updatedAt?: number } | null)?.updatedAt ?? null,
  });
}

async function saveRules(
  guild: Guild,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const parsed = rulesSchema.safeParse(await readJson(req));
  if (!parsed.success) throw new HttpError(400, 'Invalid rules', parsed.error.flatten());
  const rules = parsed.data.rules.map((rule) => rule.trim()).filter(Boolean);
  await upsertServerRules(guild.id, rules);
  recordActivity('system', 'Server rules updated', {
    level: 'success',
    meta: { guildId: guild.id, count: rules.length },
  });
  sendJson(res, 200, { rules });
}

const faqCreateSchema = z
  .object({
    question: z.string().trim().min(1).max(300),
    answer: z.string().trim().min(1).max(4000),
    tags: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
  })
  .strict();

const faqUpdateSchema = z
  .object({
    question: z.string().trim().min(1).max(300).optional(),
    answer: z.string().trim().min(1).max(4000).optional(),
    tags: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
  })
  .strict();

async function sendFaq(guild: Guild, res: http.ServerResponse): Promise<void> {
  sendJson(res, 200, { entries: await listFaq(guild.id) });
}

async function addFaq(
  guild: Guild,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const parsed = faqCreateSchema.safeParse(await readJson(req));
  if (!parsed.success) throw new HttpError(400, 'Invalid FAQ entry', parsed.error.flatten());
  const entry = await createFaqEntry(guild.id, parsed.data);
  recordActivity('system', 'FAQ entry created', {
    level: 'success',
    meta: { guildId: guild.id },
  });
  sendJson(res, 201, { entry: toPlainObject(entry) });
}

async function editFaq(
  guild: Guild,
  entryId: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  requireObjectId(entryId);
  const parsed = faqUpdateSchema.safeParse(await readJson(req));
  if (!parsed.success) throw new HttpError(400, 'Invalid FAQ update', parsed.error.flatten());
  if (Object.keys(parsed.data).length === 0) throw new HttpError(400, 'No changes supplied');
  const updated = await updateFaqEntry(guild.id, entryId, parsed.data);
  if (!updated) throw new HttpError(404, 'FAQ entry not found');
  sendJson(res, 200, { ok: true });
}

async function removeFaq(
  guild: Guild,
  entryId: string,
  res: http.ServerResponse,
): Promise<void> {
  requireObjectId(entryId);
  const deleted = await deleteFaqEntry(guild.id, entryId);
  if (!deleted) throw new HttpError(404, 'FAQ entry not found');
  sendJson(res, 200, { ok: true });
}

const announcementSchema = z
  .object({ title: z.string().trim().min(1).max(200), content: z.string().trim().min(1).max(4000) })
  .strict();

async function sendAnnouncements(guild: Guild, res: http.ServerResponse): Promise<void> {
  sendJson(res, 200, { announcements: await listAnnouncements(guild.id, 50) });
}

async function addAnnouncement(
  guild: Guild,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const parsed = announcementSchema.safeParse(await readJson(req));
  if (!parsed.success) throw new HttpError(400, 'Invalid announcement', parsed.error.flatten());
  const entry = await createAnnouncement(guild.id, parsed.data);
  recordActivity('system', 'Announcement created', {
    level: 'success',
    meta: { guildId: guild.id },
  });
  sendJson(res, 201, { announcement: toPlainObject(entry) });
}

async function removeAnnouncement(
  guild: Guild,
  entryId: string,
  res: http.ServerResponse,
): Promise<void> {
  requireObjectId(entryId);
  const deleted = await deleteAnnouncement(guild.id, entryId);
  if (!deleted) throw new HttpError(404, 'Announcement not found');
  sendJson(res, 200, { ok: true });
}

const scheduledSchema = z
  .object({
    channelId: z.string().regex(/^\d{5,25}$/),
    content: z.string().trim().min(1).max(2000),
    scheduledAt: z.union([z.string().min(1), z.number()]),
  })
  .strict();

async function sendScheduled(guild: Guild, res: http.ServerResponse): Promise<void> {
  const [scheduled, pending] = await Promise.all([
    SukunaScheduled.find({ guildId: guild.id }).sort({ scheduledAt: 1 }).limit(100).lean(),
    countScheduled(guild.id),
  ]);
  sendJson(res, 200, {
    scheduled: scheduled.map((entry) => ({
      id: String(entry._id),
      channelId: entry.channelId,
      content: entry.content,
      scheduledAt: entry.scheduledAt,
      sentAt: entry.sentAt ?? null,
      createdAt: entry.createdAt,
    })),
    pending,
  });
}

async function addScheduled(
  guild: Guild,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const parsed = scheduledSchema.safeParse(await readJson(req));
  if (!parsed.success) throw new HttpError(400, 'Invalid scheduled message', parsed.error.flatten());

  const channel = guild.channels.cache.get(parsed.data.channelId);
  if (!channel || !channel.isTextBased()) {
    throw new HttpError(400, 'Channel is not a text channel in this guild');
  }

  const scheduledAt =
    typeof parsed.data.scheduledAt === 'number'
      ? parsed.data.scheduledAt
      : Date.parse(parsed.data.scheduledAt);
  if (!Number.isFinite(scheduledAt) || scheduledAt <= 0) {
    throw new HttpError(400, 'Invalid scheduled time');
  }

  const entry = await createScheduledMessage(guild.id, {
    channelId: parsed.data.channelId,
    content: parsed.data.content,
    scheduledAt,
  });
  recordActivity('system', 'Message scheduled', {
    level: 'success',
    meta: { guildId: guild.id, channelId: parsed.data.channelId },
  });
  sendJson(res, 201, { scheduled: toPlainObject(entry) });
}

async function removeScheduled(
  guild: Guild,
  entryId: string,
  res: http.ServerResponse,
): Promise<void> {
  requireObjectId(entryId);
  const deleted = await cancelScheduledMessage(guild.id, entryId);
  if (!deleted) throw new HttpError(404, 'Scheduled message not found');
  sendJson(res, 200, { ok: true });
}

const eventSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(4000).optional(),
    startsAt: z.union([z.string().min(1), z.number()]),
    endsAt: z.union([z.string().min(1), z.number()]).optional(),
    pinned: z.boolean().optional(),
  })
  .strict();

async function sendEvents(guild: Guild, res: http.ServerResponse): Promise<void> {
  sendJson(res, 200, { events: await listServerEvents(guild.id) });
}

async function addEvent(
  guild: Guild,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const parsed = eventSchema.safeParse(await readJson(req));
  if (!parsed.success) throw new HttpError(400, 'Invalid event', parsed.error.flatten());

  const startsAt = toTimestamp(parsed.data.startsAt);
  const endsAt = parsed.data.endsAt !== undefined ? toTimestamp(parsed.data.endsAt) : undefined;
  if (endsAt !== undefined && endsAt < startsAt) {
    throw new HttpError(400, 'Event end must be after its start');
  }

  const entry = await createServerEvent(guild.id, {
    title: parsed.data.title,
    description: parsed.data.description,
    startsAt,
    endsAt,
    pinned: parsed.data.pinned,
  });
  recordActivity('system', 'Server event created', {
    level: 'success',
    meta: { guildId: guild.id },
  });
  sendJson(res, 201, { event: toPlainObject(entry) });
}

/* ------------------------------------------------------------------ */
/* API: users                                                          */
/* ------------------------------------------------------------------ */

async function sendUsers(client: SukunaClient, url: URL, res: http.ServerResponse): Promise<void> {
  const requestedSort = url.searchParams.get('sort');
  const sort = (USER_SORT_FIELDS as readonly string[]).includes(requestedSort ?? '')
    ? (requestedSort as (typeof USER_SORT_FIELDS)[number])
    : 'totalXp';
  const order = url.searchParams.get('order') === 'asc' ? 1 : -1;
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 25, 1), 100);
  const page = Math.max(Number(url.searchParams.get('page')) || 1, 1);
  const search = (url.searchParams.get('q') ?? '').trim();

  const filter: Record<string, unknown> = {};
  if (search) {
    if (/^\d{5,25}$/.test(search)) {
      filter.userId = { $regex: '^' + escapeRegex(search) };
    } else {
      filter.userId = { $regex: escapeRegex(search), $options: 'i' };
    }
  }

  const [docs, total] = await Promise.all([
    User.find(filter)
      .sort({ [sort]: order })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    User.countDocuments(filter),
  ]);

  const users = docs.map((doc, index) => {
    const cached = client.users.cache.get(doc.userId);
    return {
      userId: doc.userId,
      username: cached?.username ?? null,
      tag: cached?.tag ?? null,
      avatar: cached?.displayAvatarURL({ size: 64, extension: 'png' }) ?? null,
      balance: doc.balance ?? 0,
      bank: doc.bank ?? 0,
      bankLimit: doc.bankLimit ?? 0,
      xp: doc.xp ?? 0,
      level: doc.level ?? 0,
      totalXp: doc.totalXp ?? 0,
      lastDaily: doc.lastDaily ?? null,
      lastWork: doc.lastWork ?? null,
      createdAt: doc.createdAt ?? null,
      position: (page - 1) * limit + index + 1,
    };
  });

  sendJson(res, 200, {
    users,
    total,
    page,
    limit,
    pages: Math.max(Math.ceil(total / limit), 1),
    sort,
    order: order === 1 ? 'asc' : 'desc',
  });
}

const userPatchSchema = z
  .object({
    balance: z.number().int().min(0).max(1e15).optional(),
    bank: z.number().int().min(0).max(1e15).optional(),
    bankLimit: z.number().int().min(0).max(1e15).optional(),
    xp: z.number().int().min(0).max(1e15).optional(),
    level: z.number().int().min(0).max(100000).optional(),
    totalXp: z.number().int().min(0).max(1e15).optional(),
  })
  .strict();

async function updateUserDoc(
  userId: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  if (!/^\d{5,25}$/.test(userId)) throw new HttpError(400, 'Invalid user id');
  const parsed = userPatchSchema.safeParse(await readJson(req));
  if (!parsed.success) throw new HttpError(400, 'Invalid user update', parsed.error.flatten());
  if (Object.keys(parsed.data).length === 0) throw new HttpError(400, 'No changes supplied');

  const data = { ...parsed.data };
  const xpValue = data.totalXp ?? data.xp;
  delete data.xp;
  delete data.totalXp;

  const exists = await User.exists({ userId });
  if (!exists) throw new HttpError(404, 'User not found');

  if (Object.keys(data).length > 0) {
    await User.findOneAndUpdate({ userId }, { $set: data }, { new: true });
  }
  // XP edits go through setUserXp so `level` is re-derived instead of left
  // stale, which would otherwise swallow every future level-up.
  if (xpValue !== undefined) await setUserXp(userId, xpValue);

  const updated = await User.findOne({ userId }).lean();
  if (!updated) throw new HttpError(404, 'User not found');

  recordActivity('system', 'User economy record updated', {
    level: 'warn',
    meta: { userId, fields: Object.keys(parsed.data).join(',') },
  });
  sendJson(res, 200, { user: updated });
}

/* ------------------------------------------------------------------ */
/* API: Auto-Mod Rules                                                */
/* ------------------------------------------------------------------ */

const automodRuleSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    type: z.enum(['spam', 'links', 'invites', 'words', 'caps', 'mentions', 'attachments', 'newlines', 'emojis', 'repeated']),
    enabled: z.boolean().optional(),
    actions: z.array(z.enum(['delete', 'warn', 'timeout', 'ban', 'log'] as const)).min(1),
    timeoutDuration: z.number().int().min(1).max(86400).optional(),
    warnMessage: z.string().max(500).optional(),
    logChannel: z.string().regex(/^\d{5,25}$/).optional(),
    ignoreChannels: z.array(z.string().regex(/^\d{5,25}$/)).optional(),
    ignoreRoles: z.array(z.string().regex(/^\d{5,25}$/)).optional(),
    config: z.record(z.string(), z.any()).optional(),
  })
  .strict();

function isValidObjectId(id: string): boolean {
  return /^\d{5,25}$|^[0-9a-fA-F]{24}$/.test(id);
}

async function sendAutomodRules(guild: Guild, res: http.ServerResponse): Promise<void> {
  const rules = await AutoModRule.find({ guildId: guild.id }).sort({ createdAt: -1 }).lean();
  sendJson(res, 200, { rules: rules.map((r) => ({ id: String(r._id), ...r })) });
}

async function createAutomodRule(guild: Guild, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const parsed = automodRuleSchema.safeParse(await readJson(req));
  if (!parsed.success) throw new HttpError(400, 'Invalid auto-mod rule', parsed.error.flatten());
  const data = parsed.data;
  const rule = await AutoModRule.create({
    guildId: guild.id,
    name: data.name,
    type: data.type as IAutoModRule['type'],
    enabled: data.enabled ?? true,
    actions: data.actions as IAutoModRule['actions'],
    timeoutDuration: data.timeoutDuration,
    warnMessage: data.warnMessage,
    logChannel: data.logChannel,
    ignoreChannels: data.ignoreChannels ?? [],
    ignoreRoles: data.ignoreRoles ?? [],
    config: data.config ?? {},
  });
  recordActivity('system', 'Auto-mod rule created', { level: 'success', meta: { guildId: guild.id, ruleId: String(rule._id) } });
  sendJson(res, 201, { rule: { id: String(rule._id), ...rule.toObject() } });
}

async function updateAutomodRule(guild: Guild, ruleId: string, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (!isValidObjectId(ruleId)) throw new HttpError(400, 'Invalid rule id');
  const parsed = automodRuleSchema.partial().safeParse(await readJson(req));
  if (!parsed.success) throw new HttpError(400, 'Invalid auto-mod rule update', parsed.error.flatten());
  const rule = await AutoModRule.findOneAndUpdate({ _id: ruleId, guildId: guild.id }, parsed.data, { new: true });
  if (!rule) throw new HttpError(404, 'Auto-mod rule not found');
  recordActivity('system', 'Auto-mod rule updated', { meta: { guildId: guild.id, ruleId } });
  sendJson(res, 200, { rule: { id: String(rule._id), ...rule.toObject() } });
}

async function deleteAutomodRule(guild: Guild, ruleId: string, res: http.ServerResponse): Promise<void> {
  if (!isValidObjectId(ruleId)) throw new HttpError(400, 'Invalid rule id');
  const deleted = await AutoModRule.findOneAndDelete({ _id: ruleId, guildId: guild.id });
  if (!deleted) throw new HttpError(404, 'Auto-mod rule not found');
  recordActivity('system', 'Auto-mod rule deleted', { meta: { guildId: guild.id, ruleId } });
  sendJson(res, 200, { ok: true });
}

/* ------------------------------------------------------------------ */
/* API: Reaction Role Panels                                          */
/* ------------------------------------------------------------------ */

const rrOptionSchema = z.object({
  roleId: z.string().regex(/^\d{5,25}$/),
  emoji: z.string().min(1).max(50),
  label: z.string().max(80).optional(),
  description: z.string().max(100).optional(),
});

const rrPanelSchema = z.object({
  title: z.string().trim().min(1).max(256),
  description: z.string().max(4000).optional(),
  color: z.number().int().min(0).max(0xffffff).optional(),
  thumbnail: z.string().url().optional().nullable(),
  image: z.string().url().optional().nullable(),
  mode: z.enum(['unique', 'verify', 'reversed', 'binding', 'temporary']),
  temporaryDuration: z.number().int().min(1).max(86400).optional(),
  bindingRoleId: z.string().regex(/^\d{5,25}$/).optional(),
  options: z.array(rrOptionSchema).min(1).max(25),
  useButtons: z.boolean().optional(),
  buttonStyle: z.number().int().min(1).max(4).optional(),
  selectPlaceholder: z.string().max(150).optional(),
  minSelect: z.number().int().min(1).max(25).optional(),
  maxSelect: z.number().int().min(1).max(25).optional(),
  dmUser: z.boolean().optional(),
}).strict();

async function sendReactionRolePanels(guild: Guild, res: http.ServerResponse): Promise<void> {
  const panels = await ReactionRolePanel.find({ guildId: guild.id }).sort({ createdAt: -1 }).lean();
  sendJson(res, 200, { panels: panels.map((p) => ({ id: String(p._id), ...p })) });
}

async function createReactionRolePanel(guild: Guild, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const parsed = rrPanelSchema.safeParse(await readJson(req));
  if (!parsed.success) throw new HttpError(400, 'Invalid reaction role panel', parsed.error.flatten());
  const data = parsed.data;
  const panel = await ReactionRolePanel.create({
    guildId: guild.id,
    channelId: '',
    title: data.title,
    description: data.description,
    color: data.color,
    thumbnail: data.thumbnail,
    image: data.image,
    mode: data.mode as IReactionRolePanel['mode'],
    temporaryDuration: data.temporaryDuration,
    bindingRoleId: data.bindingRoleId,
    options: data.options.map((o) => ({ roleId: o.roleId, emoji: o.emoji, label: o.label, description: o.description })),
    useButtons: data.useButtons ?? false,
    buttonStyle: data.buttonStyle as 1 | 2 | 3 | 4 | undefined,
    selectPlaceholder: data.selectPlaceholder,
    minSelect: data.minSelect ?? 1,
    maxSelect: data.maxSelect ?? 1,
    dmUser: data.dmUser ?? false,
    active: true,
  } as any);
  recordActivity('system', 'Reaction role panel created', { level: 'success', meta: { guildId: guild.id, panelId: String(panel._id) } });
  sendJson(res, 201, { panel: { id: String(panel._id), ...(panel as any).toObject() } });
}

async function updateReactionRolePanel(guild: Guild, panelId: string, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (!isValidObjectId(panelId)) throw new HttpError(400, 'Invalid panel id');
  const parsed = rrPanelSchema.partial().safeParse(await readJson(req));
  if (!parsed.success) throw new HttpError(400, 'Invalid reaction role panel update', parsed.error.flatten());
  const data = parsed.data;
  const update: Record<string, unknown> = {};
  if (data.title !== undefined) update.title = data.title;
  if (data.description !== undefined) update.description = data.description;
  if (data.color !== undefined) update.color = data.color;
  if (data.thumbnail !== undefined) update.thumbnail = data.thumbnail;
  if (data.image !== undefined) update.image = data.image;
  if (data.mode !== undefined) update.mode = data.mode;
  if (data.temporaryDuration !== undefined) update.temporaryDuration = data.temporaryDuration;
  if (data.bindingRoleId !== undefined) update.bindingRoleId = data.bindingRoleId;
  if (data.options !== undefined) update.options = data.options.map((o) => ({ roleId: o.roleId, emoji: o.emoji, label: o.label, description: o.description }));
  if (data.useButtons !== undefined) update.useButtons = data.useButtons;
  if (data.buttonStyle !== undefined) update.buttonStyle = data.buttonStyle;
  if (data.selectPlaceholder !== undefined) update.selectPlaceholder = data.selectPlaceholder;
  if (data.minSelect !== undefined) update.minSelect = data.minSelect;
  if (data.maxSelect !== undefined) update.maxSelect = data.maxSelect;
  if (data.dmUser !== undefined) update.dmUser = data.dmUser;
  const panel = await ReactionRolePanel.findOneAndUpdate({ _id: panelId, guildId: guild.id }, update, { new: true });
  if (!panel) throw new HttpError(404, 'Reaction role panel not found');
  recordActivity('system', 'Reaction role panel updated', { meta: { guildId: guild.id, panelId } });
  sendJson(res, 200, { panel: { id: String(panel._id), ...panel.toObject() } });
}

async function deleteReactionRolePanel(guild: Guild, panelId: string, res: http.ServerResponse): Promise<void> {
  if (!isValidObjectId(panelId)) throw new HttpError(400, 'Invalid panel id');
  const deleted = await ReactionRolePanel.findOneAndDelete({ _id: panelId, guildId: guild.id });
  if (!deleted) throw new HttpError(404, 'Reaction role panel not found');
  recordActivity('system', 'Reaction role panel deleted', { meta: { guildId: guild.id, panelId } });
  sendJson(res, 200, { ok: true });
}

/* ------------------------------------------------------------------ */
/* API: Custom Commands (Tags)                                        */
/* ------------------------------------------------------------------ */

const customCmdSchema = z.object({
  name: z.string().trim().min(1).max(100).toLowerCase(),
  aliases: z.array(z.string().trim().max(100)).optional(),
  content: z.string().trim().min(1).max(4000),
  embed: z.record(z.string(), z.any()).optional(),
  requiredPermissions: z.array(z.string()).optional(),
  requiredRoles: z.array(z.string().regex(/^\d{5,25}$/)).optional(),
  cooldown: z.number().int().min(0).max(86400).optional(),
  enabled: z.boolean().optional(),
  nsfw: z.boolean().optional(),
}).strict();

async function sendCustomCommands(guild: Guild, res: http.ServerResponse): Promise<void> {
  const tags = await CustomCommand.find({ guildId: guild.id }).sort({ name: 1 }).lean();
  sendJson(res, 200, { commands: tags.map((t) => ({ id: String(t._id), ...t })) });
}

async function createCustomCommand(guild: Guild, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const parsed = customCmdSchema.safeParse(await readJson(req));
  if (!parsed.success) throw new HttpError(400, 'Invalid custom command', parsed.error.flatten());
  const data = parsed.data;
  const existing = await CustomCommand.findOne({ guildId: guild.id, name: data.name });
  if (existing) throw new HttpError(409, 'A command with this name already exists');
  const tag = await CustomCommand.create({
    guildId: guild.id,
    name: data.name,
    aliases: data.aliases ?? [],
    content: data.content,
    embed: data.embed,
    requiredPermissions: data.requiredPermissions ?? [],
    requiredRoles: data.requiredRoles ?? [],
    cooldown: data.cooldown ?? 0,
    enabled: data.enabled ?? true,
    nsfw: data.nsfw ?? false,
    creatorId: guild.ownerId,
  });
  recordActivity('system', 'Custom command created', { level: 'success', meta: { guildId: guild.id, name: tag.name } });
  sendJson(res, 201, { command: { id: String(tag._id), ...tag.toObject() } });
}

async function updateCustomCommand(guild: Guild, cmdId: string, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (!isValidObjectId(cmdId)) throw new HttpError(400, 'Invalid command id');
  const parsed = customCmdSchema.partial().safeParse(await readJson(req));
  if (!parsed.success) throw new HttpError(400, 'Invalid custom command update', parsed.error.flatten());
  const tag = await CustomCommand.findOneAndUpdate({ _id: cmdId, guildId: guild.id }, parsed.data, { new: true });
  if (!tag) throw new HttpError(404, 'Custom command not found');
  recordActivity('system', 'Custom command updated', { meta: { guildId: guild.id, commandId: cmdId } });
  sendJson(res, 200, { command: { id: String(tag._id), ...tag.toObject() } });
}

async function deleteCustomCommand(guild: Guild, cmdId: string, res: http.ServerResponse): Promise<void> {
  if (!isValidObjectId(cmdId)) throw new HttpError(400, 'Invalid command id');
  const deleted = await CustomCommand.findOneAndDelete({ _id: cmdId, guildId: guild.id });
  if (!deleted) throw new HttpError(404, 'Custom command not found');
  recordActivity('system', 'Custom command deleted', { meta: { guildId: guild.id, commandId: cmdId } });
  sendJson(res, 200, { ok: true });
}

/* ------------------------------------------------------------------ */
/* API: Theme Configuration                                           */
/* ------------------------------------------------------------------ */

const themeSchema = z.object({
  preset: z.string().optional(),
  primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  secondaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  backgroundColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  surfaceColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  textColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  mutedColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  borderColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  successColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  warningColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  errorColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  fontFamily: z.string().optional(),
  headingFontFamily: z.string().optional(),
  borderRadius: z.number().int().min(0).max(50).optional(),
  glassmorphism: z.boolean().optional(),
  glassOpacity: z.number().min(0).max(1).optional(),
  customCSS: z.string().max(10000).optional(),
  embedDefaults: z.record(z.string(), z.any()).optional(),
}).strict();

async function sendThemeConfig(guild: Guild, res: http.ServerResponse): Promise<void> {
  let theme = await ThemeConfig.findOne({ guildId: guild.id }).lean();
  if (!theme) {
    theme = await ThemeConfig.create({ guildId: guild.id, active: true });
  }
  sendJson(res, 200, { theme: { id: String(theme._id), ...theme } });
}

async function updateThemeConfig(guild: Guild, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const parsed = themeSchema.safeParse(await readJson(req));
  if (!parsed.success) throw new HttpError(400, 'Invalid theme config', parsed.error.flatten());
  let theme = await ThemeConfig.findOne({ guildId: guild.id });
  if (!theme) {
    theme = await ThemeConfig.create({ guildId: guild.id, active: true });
  }
  Object.assign(theme, parsed.data);
  await theme.save();
  recordActivity('system', 'Theme config updated', { meta: { guildId: guild.id } });
  sendJson(res, 200, { theme: { id: String(theme._id), ...theme.toObject() } });
}

/* ------------------------------------------------------------------ */
/* API: Color Roles                                                   */
/* ------------------------------------------------------------------ */

const colorRoleSchema = z.object({
  name: z.string().trim().min(1).max(50),
  gradient: z.string().min(1),
  colors: z.array(z.string().regex(/^#[0-9A-Fa-f]{6}$/)).min(2),
  animationDuration: z.number().int().min(1).max(60).optional(),
  pickable: z.boolean().optional(),
  requiredRoleId: z.string().regex(/^\d{5,25}$/).optional(),
  cost: z.number().int().min(0).optional(),
  maxUsers: z.number().int().min(0).optional(),
  position: z.number().int().optional(),
  active: z.boolean().optional(),
}).strict();

async function sendColorRoles(guild: Guild, res: http.ServerResponse): Promise<void> {
  const roles = await ColorRole.find({ guildId: guild.id }).sort({ position: 1 }).lean();
  sendJson(res, 200, { roles: roles.map((r) => ({ id: String(r._id), ...r })) });
}

async function createColorRole(guild: Guild, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const parsed = colorRoleSchema.safeParse(await readJson(req));
  if (!parsed.success) throw new HttpError(400, 'Invalid color role', parsed.error.flatten());
  const data = parsed.data;
  const role = await ColorRole.create({
    guildId: guild.id,
    name: data.name,
    gradient: data.gradient,
    colors: data.colors,
    animationDuration: data.animationDuration ?? 10,
    pickable: data.pickable ?? true,
    requiredRoleId: data.requiredRoleId,
    cost: data.cost ?? 0,
    maxUsers: data.maxUsers ?? 0,
    position: data.position ?? 0,
    active: data.active ?? true,
  });
  recordActivity('system', 'Color role created', { level: 'success', meta: { guildId: guild.id, roleId: String(role._id) } });
  sendJson(res, 201, { role: { id: String(role._id), ...role.toObject() } });
}

async function updateColorRole(guild: Guild, roleId: string, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (!isValidObjectId(roleId)) throw new HttpError(400, 'Invalid role id');
  const parsed = colorRoleSchema.partial().safeParse(await readJson(req));
  if (!parsed.success) throw new HttpError(400, 'Invalid color role update', parsed.error.flatten());
  const role = await ColorRole.findOneAndUpdate({ _id: roleId, guildId: guild.id }, parsed.data, { new: true });
  if (!role) throw new HttpError(404, 'Color role not found');
  recordActivity('system', 'Color role updated', { meta: { guildId: guild.id, roleId } });
  sendJson(res, 200, { role: { id: String(role._id), ...role.toObject() } });
}

async function deleteColorRole(guild: Guild, roleId: string, res: http.ServerResponse): Promise<void> {
  if (!isValidObjectId(roleId)) throw new HttpError(400, 'Invalid role id');
  const deleted = await ColorRole.findOneAndDelete({ _id: roleId, guildId: guild.id });
  if (!deleted) throw new HttpError(404, 'Color role not found');
  recordActivity('system', 'Color role deleted', { meta: { guildId: guild.id, roleId } });
  sendJson(res, 200, { ok: true });
}

/* ------------------------------------------------------------------ */
/* API: Welcome Configuration                                         */
/* ------------------------------------------------------------------ */

const welcomeSchema = z.object({
  welcomeChannelId: z.string().regex(/^\d{5,25}$/).optional().nullable(),
  welcomeMessage: z.string().max(2000).optional(),
  welcomeEmbed: z.record(z.string(), z.any()).optional(),
  dmMessage: z.string().max(2000).optional(),
  dmEmbed: z.record(z.string(), z.any()).optional(),
  leaveChannelId: z.string().regex(/^\d{5,25}$/).optional().nullable(),
  leaveMessage: z.string().max(2000).optional(),
  leaveEmbed: z.record(z.string(), z.any()).optional(),
  autoRoleId: z.string().regex(/^\d{5,25}$/).optional().nullable(),
  botAutoRoleId: z.string().regex(/^\d{5,25}$/).optional().nullable(),
  banChannelId: z.string().regex(/^\d{5,25}$/).optional().nullable(),
  banMessage: z.string().max(1000).optional(),
  updateMemberCount: z.boolean().optional(),
  vanityRoleId: z.string().regex(/^\d{5,25}$/).optional().nullable(),
  vanityCode: z.string().max(50).optional(),
  welcomeImage: z.record(z.string(), z.any()).optional(),
}).strict();

async function sendWelcomeConfig(guild: Guild, res: http.ServerResponse): Promise<void> {
  let config = await WelcomeConfig.findOne({ guildId: guild.id }).lean();
  if (!config) {
    config = await WelcomeConfig.create({ guildId: guild.id });
  }
  sendJson(res, 200, { config: { id: String(config._id), ...config } });
}

async function updateWelcomeConfig(guild: Guild, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const parsed = welcomeSchema.safeParse(await readJson(req));
  if (!parsed.success) throw new HttpError(400, 'Invalid welcome config', parsed.error.flatten());
  let config = await WelcomeConfig.findOne({ guildId: guild.id });
  if (!config) {
    config = await WelcomeConfig.create({ guildId: guild.id });
  }
  Object.assign(config, parsed.data);
  await config.save();
  recordActivity('system', 'Welcome config updated', { meta: { guildId: guild.id } });
  sendJson(res, 200, { config: { id: String(config._id), ...config.toObject() } });
}

/* ------------------------------------------------------------------ */
/* API: Starboard Configuration                                       */
/* ------------------------------------------------------------------ */

const starboardSchema = z.object({
  channelId: z.string().regex(/^\d{5,25}$/).optional(),
  threshold: z.number().int().min(1).max(1000).optional(),
  emoji: z.string().min(1).max(50).optional(),
  allowSelfStar: z.boolean().optional(),
  allowBotMessages: z.boolean().optional(),
  requireAttachment: z.boolean().optional(),
  requireEmbed: z.boolean().optional(),
  ignoredChannels: z.array(z.string().regex(/^\d{5,25}$/)).optional(),
  ignoredRoles: z.array(z.string().regex(/^\d{5,25}$/)).optional(),
  color: z.number().int().min(0).max(0xffffff).optional(),
  includeJumpLink: z.boolean().optional(),
  showCountOnOriginal: z.boolean().optional(),
  maxAgeDays: z.number().int().min(0).max(365).optional(),
  allowMultiple: z.boolean().optional(),
  enabled: z.boolean().optional(),
}).strict();

async function sendStarboardConfig(guild: Guild, res: http.ServerResponse): Promise<void> {
  let config = await StarboardConfig.findOne({ guildId: guild.id }).lean();
  if (!config) {
    config = await StarboardConfig.create({ guildId: guild.id, enabled: true });
  }
  sendJson(res, 200, { config: { id: String(config._id), ...config } });
}

async function updateStarboardConfig(guild: Guild, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const parsed = starboardSchema.safeParse(await readJson(req));
  if (!parsed.success) throw new HttpError(400, 'Invalid starboard config', parsed.error.flatten());
  let config = await StarboardConfig.findOne({ guildId: guild.id });
  if (!config) {
    config = await StarboardConfig.create({ guildId: guild.id, enabled: true });
  }
  Object.assign(config, parsed.data);
  await config.save();
  recordActivity('system', 'Starboard config updated', { meta: { guildId: guild.id } });
  sendJson(res, 200, { config: { id: String(config._id), ...config.toObject() } });
}

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

function applySecurityHeaders(res: http.ServerResponse): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data: https://cdn.discordapp.com; connect-src 'self'; " +
      "frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  );
}

async function serveStatic(
  res: http.ServerResponse,
  entry: { file: string; type: string },
): Promise<void> {
  const filePath = path.join(DASHBOARD_DIR, entry.file);
  try {
    const content = await fs.promises.readFile(filePath);
    res.writeHead(200, {
      'Content-Type': entry.type,
      'Cache-Control': 'no-store',
    });
    res.end(content);
  } catch {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Dashboard assets are missing. Expected ' + filePath);
  }
}

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  if (res.writableEnded) return;
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

function sendText(res: http.ServerResponse, status: number, text: string): void {
  if (res.writableEnded) return;
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    if (req.method === 'GET' || req.method === 'HEAD') return resolve({});

    let size = 0;
    const chunks: Buffer[] = [];

    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new HttpError(413, 'Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          reject(new HttpError(400, 'Request body must be a JSON object'));
          return;
        }
        resolve(parsed as Record<string, unknown>);
      } catch {
        reject(new HttpError(400, 'Invalid JSON body'));
      }
    });

    req.on('error', (error) => reject(new HttpError(400, 'Could not read request body: ' + error.message)));
  });
}

function dbState(): string {
  const names = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  return names[mongoose.connection.readyState] ?? 'unknown';
}

function isDatabaseError(error: unknown): boolean {
  if (mongoose.connection.readyState !== 1) return true;
  if (!error || typeof error !== 'object') return false;
  const name = (error as { name?: string }).name ?? '';
  const message = (error as { message?: string }).message ?? '';
  return (
    error instanceof mongoose.Error ||
    name.includes('Mongo') ||
    /buffering timed out|connection .*closed|ECONNREFUSED|ENOTFOUND/i.test(message)
  );
}

function requireObjectId(id: string): void {
  if (!isValidObjectId(id)) throw new HttpError(400, 'Invalid record id');
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toTimestamp(value: string | number): number {
  const timestamp = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    throw new HttpError(400, 'Invalid date value');
  }
  return timestamp;
}

function toPlainObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') return {};
  const candidate = value as { toObject?: () => Record<string, unknown> };
  return typeof candidate.toObject === 'function' ? candidate.toObject() : (value as Record<string, unknown>);
}
