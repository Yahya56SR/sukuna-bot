/* ==========================================================================
   爱 Doctora Control Panel — frontend
   Vanilla JS. No build step, no framework, CSP-safe event delegation.
   ========================================================================== */

'use strict';

/* --------------------------------------------------------------------------
   State
   -------------------------------------------------------------------------- */

const state = {
  authed: false,
  route: 'overview',
  renderToken: 0,
  overview: null,

  guilds: [],
  selectedGuildId: null,
  guildDetail: null,
  guildTab: 'modules',
  guildData: {},
  guildFilter: '',

  persona: null,
  personaModels: [],
  personaChannels: [],
  personaGuildId: null,
  personaSelectedChannels: new Set(),
  hasGeminiKey: false,

  commands: [],
  commandQuery: '',
  commandCategory: 'all',

  users: { users: [], total: 0, page: 1, pages: 1, limit: 25 },
  userQuery: '',
  userSort: 'totalXp',
  userOrder: 'desc',
  userPage: 1,

  activity: { events: [], kind: 'all', limit: 80, counters: null },
  activityTimer: null,

  confirmResolve: null,
  toastTimer: null,
  searchTimers: new Map(),
};

const MODULES = [
  { key: 'economy', label: 'Economy', desc: 'balance, daily, work' },
  { key: 'leveling', label: 'Leveling', desc: 'XP, levels, rank' },
  { key: 'fun', label: 'Fun', desc: '8ball, coinflip, dice' },
  { key: 'music', label: 'Music', desc: 'reserved for music commands' },
  { key: 'tickets', label: 'Tickets', desc: 'reserved for support tickets' },
  { key: 'ai', label: 'AI extras', desc: 'reserved for persona tools' },
];

const COMMAND_TONES = {
  moderation: 'red',
  economy: 'green',
  leveling: 'blue',
  fun: 'purple',
  utility: 'amber',
  core: 'amber',
  community: 'blue',
  logging: 'purple',
};

const ROUTES = {
  overview: { title: 'Overview', subtitle: 'Bot health and live activity', render: renderOverview },
  guilds: { title: 'Guilds', subtitle: 'Per-server modules, XP and content', render: renderGuilds },
  persona: { title: 'Persona', subtitle: '爱 Doctora AI identity, behavior and limits', render: renderPersona },
  users: { title: 'Economy', subtitle: 'User balances, XP and levels', render: renderUsers },
  commands: { title: 'Commands', subtitle: 'Everything registered on the bot', render: renderCommands },
  activity: { title: 'Activity', subtitle: 'Live commands, AI replies, warnings and errors', render: renderActivity },
  system: { title: 'System', subtitle: 'Runtime, database and dashboard security', render: renderSystem },
};

/* --------------------------------------------------------------------------
   DOM + formatting helpers
   -------------------------------------------------------------------------- */

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString('en-US') : '0';
}

function compact(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  try {
    return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
  } catch {
    return num(n);
  }
}

function duration(ms) {
  const total = Math.max(Math.floor(Number(ms || 0) / 1000), 0);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (days) return days + 'd ' + hours + 'h';
  if (hours) return hours + 'h ' + minutes + 'm';
  if (minutes) return minutes + 'm ' + seconds + 's';
  return seconds + 's';
}

function bytes(value) {
  let size = Number(value || 0);
  const units = ['B', 'KB', 'MB', 'GB'];
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return size.toFixed(size >= 100 || index === 0 ? 0 : 1) + ' ' + units[index];
}

function fmtDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fmtTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function timeAgo(value) {
  const ts = typeof value === 'number' ? value : new Date(value).getTime();
  if (!Number.isFinite(ts)) return '—';
  const diff = Math.max(Date.now() - ts, 0);
  if (diff < 5000) return 'just now';
  if (diff < 60000) return Math.floor(diff / 1000) + 's ago';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
  if (diff < 604800000) return Math.floor(diff / 86400000) + 'd ago';
  return fmtDate(ts);
}

function pingLabel(ping) {
  const value = Number(ping);
  if (!Number.isFinite(value)) return 'gateway —';
  return 'gateway ' + value + 'ms';
}

function initials(name) {
  return String(name || '?')
    .replace(/[^a-zA-Z0-9 ]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('') || '?';
}

function guildAvatar(guild) {
  if (guild.icon) {
    return '<img class="guild-avatar" src="' + esc(guild.icon) + '" alt="">';
  }
  return '<span class="guild-avatar">' + esc(initials(guild.name)) + '</span>';
}

function userAvatar(user) {
  if (user.avatar) return '<img class="avatar sm" src="' + esc(user.avatar) + '" alt="">';
  return '<span class="avatar sm" style="display:grid;place-items:center;font-size:11px;font-weight:700">' +
    esc(initials(user.username || user.userId)) + '</span>';
}

function debounce(key, task, wait = 280) {
  const existing = state.searchTimers.get(key);
  if (existing) clearTimeout(existing);
  state.searchTimers.set(key, setTimeout(() => {
    state.searchTimers.delete(key);
    task();
  }, wait));
}

function isCurrent(token) {
  return token === state.renderToken;
}

/* --------------------------------------------------------------------------
   API client
   -------------------------------------------------------------------------- */

async function api(path, options = {}) {
  const init = {
    method: options.method || 'GET',
    credentials: 'same-origin',
    headers: { ...(options.headers || {}) },
  };
  if (options.body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(options.body);
  }

  const response = await fetch(path, init);
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { error: text };
  }

  if (response.status === 401) {
    showLogin('Your session expired. Unlock the dashboard again.');
    throw new Error('Authentication required');
  }
  if (!response.ok) {
    const message = payload && (payload.error || payload.message);
    throw new Error(message || 'Request failed (' + response.status + ')');
  }
  return payload;
}

/* --------------------------------------------------------------------------
   Shell / auth
   -------------------------------------------------------------------------- */

function showLogin(message) {
  state.authed = false;
  state.renderToken += 1;
  if (state.activityTimer) {
    clearInterval(state.activityTimer);
    state.activityTimer = null;
  }
  closeModal();
  $('#boot').hidden = true;
  $('#app').hidden = true;
  $('#login').hidden = false;
  const error = $('#login-error');
  error.textContent = message || '';
  const input = $('#login-token');
  input.value = '';
  setTimeout(() => input.focus(), 50);
}

async function enterApp() {
  state.authed = true;
  $('#boot').hidden = true;
  $('#login').hidden = true;
  $('#app').hidden = false;
  if (!location.hash || !ROUTES[location.hash.replace(/^#\/?/, '').split('?')[0]]) {
    location.hash = '#/overview';
  }
  await route();
}

async function handleLogin(form) {
  const input = $('#login-token');
  const error = $('#login-error');
  const button = $('#login-submit');
  const token = input.value.trim();
  if (!token) {
    error.textContent = 'Enter the dashboard access token.';
    return;
  }

  error.textContent = '';
  button.disabled = true;
  const label = button.textContent;
  button.innerHTML = '<span class="spinner sm"></span> Unlocking';
  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || 'Invalid access token');
    }
    input.value = '';
    await enterApp();
  } catch (err) {
    error.textContent = err.message || 'Could not sign in.';
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

async function logout() {
  try {
    await api('/api/auth/logout', { method: 'POST' });
  } catch {
    /* ignore */
  }
  showLogin('');
}

/* --------------------------------------------------------------------------
   Routing
   -------------------------------------------------------------------------- */

function currentRoute() {
  const raw = (location.hash || '').replace(/^#\/?/, '').split('?')[0];
  return ROUTES[raw] ? raw : 'overview';
}

async function route() {
  if (!state.authed) return;

  state.renderToken += 1;
  const token = state.renderToken;
  if (state.activityTimer) {
    clearInterval(state.activityTimer);
    state.activityTimer = null;
  }

  const name = currentRoute();
  state.route = name;
  const meta = ROUTES[name];

  $$('.nav-link').forEach((link) => {
    link.classList.toggle('active', link.dataset.route === name);
  });
  $('#page-title').textContent = meta.title;
  $('#page-subtitle').textContent = meta.subtitle;
  $('#view').scrollTop = 0;

  try {
    await meta.render(token);
    window.scrollTo({ top: 0, behavior: 'instant' });
  } catch (error) {
    if (!isCurrent(token)) return;
    setView(errorState(error.message || 'Could not load this view.'));
  }
}

function setLoading() {
  setView('<div class="loading"><span class="spinner"></span><span>Loading…</span></div>');
}

function setView(html) {
  const view = $('#view');
  if (!view) return;
  view.innerHTML = html;
}

function errorState(message) {
  return '<div class="card pad"><div class="empty-state">' +
    '<span class="big">⚠</span>' +
    '<strong>Something went wrong</strong>' +
    '<p class="muted small" style="max-width:520px">' + esc(message) + '</p>' +
    '<button class="btn primary" data-action="refresh">Try again</button>' +
    '</div></div>';
}

function refreshOverviewHeader() {
  const overview = state.overview;
  if (!overview) return;
  const dot = $('#conn-dot');
  const label = $('#conn-label');
  const sub = $('#conn-sub');
  const pill = $('#bot-pill');
  if (dot) dot.className = 'conn-dot ' + (overview.bot ? 'online' : 'offline');
  if (label) label.textContent = overview.bot ? 'Gateway online' : 'Gateway offline';
  if (sub) sub.textContent = pingLabel(overview.ping) + ' · ' + overview.guilds + ' guilds';
  if (pill) {
    pill.className = 'pill ' + (overview.persona.enabled ? 'amber' : 'red');
    pill.innerHTML = '<span class="dot"></span>' +
      (overview.bot ? esc(overview.bot.username) : '爱 Doctora') +
      ' · ' + (overview.persona.enabled ? 'AI on' : 'AI off');
  }
}

/* --------------------------------------------------------------------------
   Shared components
   -------------------------------------------------------------------------- */

function statCard(label, value, foot, tone = '', icon = '') {
  return '<div class="card stat ' + tone + '">' +
    '<div class="stat-label"><span>' + esc(icon) + '</span>' + esc(label) + '</div>' +
    '<div class="stat-value">' + esc(value) + '</div>' +
    '<div class="stat-foot">' + esc(foot) + '</div>' +
    '</div>';
}

function switchRow(name, label, desc, checked, attrs = '') {
  return '<label class="switch-row">' +
    '<span class="switch-copy"><strong>' + esc(label) + '</strong><small>' + esc(desc) + '</small></span>' +
    '<span class="switch"><input type="checkbox" name="' + esc(name) + '" ' + (checked ? 'checked' : '') + ' ' + attrs + '>' +
    '<span class="switch-track"></span></span>' +
    '</label>';
}

function rangeValue(value, format) {
  const number = Number(value);
  switch (format) {
    case 'seconds':
      return number === 0 ? '0s' : number < 1 ? Math.round(number * 1000) + 'ms' : number + 's';
    case 'ms':
      return number + 'ms';
    case 'decimal':
      return number.toFixed(1);
    case 'int':
    default:
      return String(number);
  }
}

function rangeField(name, label, value, min, max, step, format = 'int') {
  const number = Number(value);
  const pct = Math.max(0, Math.min(100, ((number - min) / (max - min)) * 100));
  return '<div class="field">' +
    '<label class="field-label" for="f-' + esc(name) + '"><span>' + esc(label) + '</span>' +
    '<span class="range-value" data-range-value="' + esc(name) + '">' + esc(rangeValue(number, format)) + '</span></label>' +
    '<div class="range-row"><input type="range" id="f-' + esc(name) + '" name="' + esc(name) + '" ' +
    'min="' + min + '" max="' + max + '" step="' + step + '" value="' + number + '" ' +
    'data-range="' + esc(name) + '" data-format="' + esc(format) + '" style="--pct:' + pct + '%"></div>' +
    '</div>';
}

function activityIcon(kind) {
  return {
    command: '⌘',
    ai: '✦',
    error: '!',
    system: '⚙',
    log: '·',
  }[kind] || '·';
}

function renderActivityList(events, compactMode) {
  if (!events || events.length === 0) {
    return '<div class="empty-state"><span class="big">≋</span><span>No activity recorded yet.</span></div>';
  }
  return '<div class="activity-list">' + events.map((event) => {
    const meta = event.meta || {};
    const chips = Object.entries(meta)
      .filter(([, value]) => value !== null && value !== '')
      .slice(0, compactMode ? 2 : 4)
      .map(([key, value]) => '<span>' + esc(key) + '=' + esc(String(value)) + '</span>')
      .join('');
    return '<div class="activity-item">' +
      '<span class="activity-ico ' + esc(event.kind) + '">' + activityIcon(event.kind) + '</span>' +
      '<div class="activity-body"><p>' + esc(event.message) + '</p>' +
      '<div class="activity-foot"><span>' + esc(event.kind) + '</span>' +
      (chips ? '<span class="activity-meta">' + chips + '</span>' : '') +
      '</div></div>' +
      '<span class="activity-time" title="' + esc(fmtDate(event.at)) + '">' + esc(timeAgo(event.at)) + '</span>' +
      '</div>';
  }).join('') + '</div>';
}

function showToast(message, tone = 'info') {
  const toast = $('#toast');
  toast.textContent = message;
  toast.className = 'toast ' + tone;
  toast.hidden = false;
  if (state.toastTimer) clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 4200);
}

function showModal(html) {
  $('#modal-root').innerHTML =
    '<div class="modal-backdrop" data-action="modal-close">' +
    '<div class="modal" role="dialog" aria-modal="true">' + html + '</div>' +
    '</div>';
}

function closeModal() {
  const pending = state.confirmResolve;
  state.confirmResolve = null;
  $('#modal-root').innerHTML = '';
  if (pending) pending(false);
}

function confirmAction(title, message, confirmLabel = 'Delete', tone = 'danger') {
  return new Promise((resolve) => {
    state.confirmResolve = resolve;
    showModal(
      '<div class="modal-head"><div><h3>' + esc(title) + '</h3><p>This action cannot be undone.</p></div>' +
      '<button class="modal-close" type="button" data-action="modal-close" aria-label="Close">×</button></div>' +
      '<div class="modal-body"><p class="small dim" style="margin:0;line-height:1.6">' + esc(message) + '</p></div>' +
      '<div class="modal-foot">' +
      '<button class="btn ghost" type="button" data-action="confirm-no">Cancel</button>' +
      '<button class="btn ' + (tone === 'danger' ? 'danger' : 'primary') + '" type="button" data-action="confirm-yes">' +
      esc(confirmLabel) + '</button>' +
      '</div>',
    );
  });
}

function resolveConfirm(value) {
  const resolve = state.confirmResolve;
  state.confirmResolve = null;
  $('#modal-root').innerHTML = '';
  if (resolve) resolve(value);
}

async function runForm(form, task) {
  const button = form.querySelector('[type="submit"]') || document.querySelector('button[form="' + form.id + '"]');
  let label = '';
  if (button) {
    label = button.innerHTML;
    button.disabled = true;
    button.innerHTML = '<span class="spinner sm"></span> Working';
  }
  try {
    await task();
  } finally {
    if (button) {
      button.disabled = false;
      button.innerHTML = label;
    }
  }
}

/* --------------------------------------------------------------------------
   Overview
   -------------------------------------------------------------------------- */

async function renderOverview(token) {
  setLoading();
  const [overview, activity] = await Promise.all([
    api('/api/overview'),
    api('/api/activity?limit=12&kind=all'),
  ]);
  if (!isCurrent(token)) return;

  state.overview = overview;
  refreshOverviewHeader();

  const bot = overview.bot;
  const persona = overview.persona;
  const counters = overview.counters || {};
  const db = overview.database;
  const memory = overview.memory;

  const html =
    '<section class="stat-grid">' +
    statCard('Guilds', num(overview.guilds), 'servers connected', 'blue', '▦') +
    statCard('Members', compact(overview.members), num(overview.channels) + ' channels', 'purple', '◉') +
    statCard('Uptime', duration(overview.uptimeMs), pingLabel(overview.ping), 'green', '⏱') +
    statCard('Commands', num(overview.commands), num(counters.commandsRun) + ' runs this session', '', '⌘') +
    statCard('AI replies', num(counters.aiReplies), persona.enabled ? persona.model : 'persona disabled', 'amber', '✦') +
    statCard('Messages seen', compact(counters.messagesSeen), num(counters.errors) + ' errors logged', '', '≋') +
    '</section>' +

    '<section class="grid side">' +
    '<div class="stack">' +

    '<div class="card pad">' +
    '<div class="bot-card">' +
    (bot
      ? '<img class="avatar lg" src="' + esc(bot.avatar) + '" alt="">'
      : '<span class="brand-mark large">爱</span>') +
    '<div class="bot-meta grow">' +
    '<h2>' + esc(bot ? bot.tag : '爱 Doctora') + '</h2>' +
    '<p>Application ID <span class="mono">' + esc(bot ? bot.id : '—') + '</span> · created ' + esc(fmtDate(bot && bot.createdAt)) + '</p>' +
    '<div class="row wrap" style="margin-top:9px">' +
    '<span class="pill green"><span class="dot"></span>Gateway online</span>' +
    '<span class="pill ' + (persona.enabled ? 'amber' : 'red') + '"><span class="dot"></span>' +
    (persona.enabled ? 'Persona active' : 'Persona off') + '</span>' +
    '<span class="badge">' + esc(persona.model) + '</span>' +
    '<span class="badge ' + (persona.hasApiKey ? 'green' : 'red') + '">' +
    (persona.hasApiKey ? 'Gemini key set' : 'No Gemini key') + '</span>' +
    '</div>' +
    '</div>' +
    '</div>' +
    '<div class="divider" style="margin:16px 0"></div>' +
    '<div class="row wrap">' +
    '<a class="btn primary" href="#/persona">Configure persona</a>' +
    '<a class="btn ghost" href="#/guilds">Manage guilds</a>' +
    '<button class="btn ghost" type="button" data-action="quick-toggle-persona" data-enabled="' +
    (persona.enabled ? 'false' : 'true') + '">' +
    (persona.enabled ? 'Disable AI' : 'Enable AI') + '</button>' +
    '</div>' +
    '</div>' +

    '<div class="card">' +
    '<div class="card-head"><div><h3>Persona snapshot</h3><p>' +
    (persona.enabled ? 'Replying as ' + esc(persona.displayName) : 'AI persona is currently disabled') +
    '</p></div><a class="btn ghost small" href="#/persona">Edit</a></div>' +
    '<div class="card-body">' +
    '<div class="kv">' +
    kvRow('Display name', esc(persona.displayName)) +
    kvRow('Model', '<span class="mono">' + esc(persona.model) + '</span>') +
    kvRow('Temperature', esc(String(persona.temperature))) +
    kvRow('Activation channels', num(persona.channels)) +
    kvRow('AI replies this session', num(counters.aiReplies)) +
    kvRow('Dashboard auth', overview.dashboard.tokenSource === 'environment' ? 'DASHBOARD_TOKEN' : 'generated token') +
    '</div>' +
    '</div>' +
    '</div>' +

    '<div class="card">' +
    '<div class="card-head"><div><h3>Recent activity</h3><p>Latest commands, AI replies and warnings</p></div>' +
    '<a class="btn ghost small" href="#/activity">Open feed</a></div>' +
    '<div class="card-body flush">' + renderActivityList(activity.events, true) + '</div>' +
    '</div>' +

    '</div>' +

    '<div class="stack">' +
    '<div class="card pad">' +
    '<div class="section-head"><div><p class="eyebrow">System health</p><h2>Runtime</h2></div>' +
    '<span class="badge ' + (db.state === 'connected' ? 'green' : 'red') + '">DB ' + esc(db.state) + '</span></div>' +
    '<div class="kv" style="margin-top:10px">' +
    kvRow('Process uptime', duration(overview.processUptimeMs)) +
    kvRow('Gateway ping', esc(pingLabel(overview.ping))) +
    kvRow('Memory (RSS)', esc(bytes(memory.rss))) +
    kvRow('Heap used', esc(bytes(memory.heapUsed)) + ' / ' + esc(bytes(memory.heapTotal))) +
    kvRow('Node.js', '<span class="mono">' + esc(overview.runtime.node) + '</span>') +
    kvRow('Platform', esc(overview.runtime.platform + ' / ' + overview.runtime.arch)) +
    kvRow('PID', '<span class="mono">' + esc(overview.runtime.pid) + '</span>') +
    kvRow('Database', '<span class="mono">' + esc(db.name || '—') + '</span>') +
    kvRow('Dashboard port', '<span class="mono">' + esc(overview.dashboard.port) + '</span>') +
    '</div>' +
    '</div>' +

    '<div class="card pad">' +
    '<p class="eyebrow">Session counters</p>' +
    '<div class="stat-grid" style="grid-template-columns:repeat(2,minmax(0,1fr))">' +
    statCard('Commands run', num(counters.commandsRun), 'this process', 'blue', '⌘') +
    statCard('AI replies', num(counters.aiReplies), 'this process', 'amber', '✦') +
    statCard('Messages', compact(counters.messagesSeen), 'seen by leveling', '', '≋') +
    statCard('Errors', num(counters.errors), 'logged failures', 'red', '!') +
    '</div>' +
    '<div class="notice info" style="margin-top:14px">Counters reset when the bot restarts. The activity feed is a bounded in-memory ring buffer.</div>' +
    '</div>' +
    '</div>' +
    '</section>';

  setView(html);
}

function kvRow(label, value) {
  return '<div class="kv-row"><span>' + esc(label) + '</span><span>' + value + '</span></div>';
}

/* --------------------------------------------------------------------------
   Guilds
   -------------------------------------------------------------------------- */

async function renderGuilds(token) {
  setLoading();
  if (!state.guilds.length) {
    const data = await api('/api/guilds');
    if (!isCurrent(token)) return;
    state.guilds = data.guilds;
  }

  if (!state.selectedGuildId || !state.guilds.some((guild) => guild.id === state.selectedGuildId)) {
    state.selectedGuildId = state.guilds[0]?.id || null;
  }

  if (!state.guilds.length) {
    setView('<div class="card pad"><div class="empty-state"><span class="big">▦</span>' +
      '<strong>No guilds</strong><p class="muted small">Invite 爱 Doctora to a server to manage it here.</p></div></div>');
    return;
  }

  setView(
    '<section class="guild-layout">' +
    '<div class="card guild-list" id="guild-list">' + guildListHtml() + '</div>' +
    '<div class="guild-detail" id="guild-detail">' +
    '<div class="loading"><span class="spinner"></span><span>Loading guild…</span></div>' +
    '</div>' +
    '</section>',
  );

  if (state.selectedGuildId) await loadGuildDetail(state.selectedGuildId, token);
}

function guildListHtml() {
  const filter = state.guildFilter.trim().toLowerCase();
  const guilds = state.guilds.filter((guild) => !filter || guild.name.toLowerCase().includes(filter));
  return '<div class="search"><input class="input sm" id="guild-filter" placeholder="Filter guilds…" value="' + esc(state.guildFilter) + '"></div>' +
    guilds.map((guild) =>
      '<button class="guild-item ' + (guild.id === state.selectedGuildId ? 'active' : '') + '" ' +
      'type="button" data-action="guild-select" data-id="' + esc(guild.id) + '">' +
      guildAvatar(guild) +
      '<span class="guild-copy"><strong>' + esc(guild.name) + '</strong>' +
      '<small>' + num(guild.members) + ' members · ' + num(guild.channels) + ' channels</small></span>' +
      '</button>',
    ).join('') +
    (guilds.length ? '' : '<div class="empty">No guilds match.</div>');
}

function renderGuildList() {
  const host = $('#guild-list');
  if (!host) return;
  host.innerHTML = guildListHtml();
}

async function selectGuild(guildId) {
  if (guildId === state.selectedGuildId) return;
  state.selectedGuildId = guildId;
  renderGuildList();
  await loadGuildDetail(guildId, state.renderToken);
}

async function loadGuildDetail(guildId, token) {
  const host = $('#guild-detail');
  if (host) host.innerHTML = '<div class="loading"><span class="spinner"></span><span>Loading guild…</span></div>';
  try {
    const detail = await api('/api/guilds/' + encodeURIComponent(guildId));
    if (!isCurrent(token)) return;
    state.guildDetail = detail;
    state.guildData = {};
    state.guildTab = 'modules';
    renderGuildDetail();
  } catch (error) {
    if (!isCurrent(token)) return;
    if (host) host.innerHTML = errorState(error.message);
  }
}

function renderGuildDetail() {
  const host = $('#guild-detail');
  if (!host || !state.guildDetail) return;
  const { guild, config, counts } = state.guildDetail;
  const tabs = [
    ['modules', 'Modules'],
    ['leveling', 'Leveling'],
    ['tickets', 'Tickets'],
    ['memories', 'Memories' + (counts ? ' (' + counts.memories + ')' : '')],
    ['content', 'Content'],
  ];

  host.innerHTML =
    '<div class="card pad">' +
    '<div class="detail-head">' +
    guildAvatar(guild) +
    '<div class="detail-title"><h2>' + esc(guild.name) + '</h2>' +
    '<p><span class="mono">' + esc(guild.id) + '</span> · ' + num(guild.members) + ' members · ' +
    num(guild.roles) + ' roles · joined ' + esc(fmtDate(guild.joinedAt)) + '</p></div>' +
    '<div class="row wrap">' +
    '<span class="badge ' + (config.xpEnabled ? 'green' : 'red') + '">XP ' + (config.xpEnabled ? 'on' : 'off') + '</span>' +
    '<span class="badge">' + num(guild.boosts) + ' boosts</span>' +
    '</div>' +
    '</div>' +
    '</div>' +
    '<div class="tabs">' + tabs.map(([key, label]) =>
      '<button class="tab ' + (state.guildTab === key ? 'active' : '') + '" type="button" ' +
      'data-action="guild-tab" data-tab="' + key + '">' + esc(label) + '</button>',
    ).join('') + '</div>' +
    '<div id="guild-tab-body">' + guildTabHtml() + '</div>';
}

function guildTabHtml() {
  switch (state.guildTab) {
    case 'modules':
      return guildModulesHtml();
    case 'leveling':
      return guildLevelingHtml();
    case 'tickets':
      return guildTicketsHtml();
    case 'memories':
      return guildMemoriesHtml();
    case 'content':
      return guildContentHtml();
    default:
      return '';
  }
}

function renderGuildTabBody() {
  const host = $('#guild-tab-body');
  if (host) host.innerHTML = guildTabHtml();
}

function applyGuildConfig(result) {
  if (!result) return;
  if (result.config) state.guildDetail.config = result.config;
  if (result.roles) state.guildDetail.roles = result.roles;
  if (result.channels) state.guildDetail.channels = result.channels;
  renderGuildDetail();
}

async function setGuildTab(tab) {
  state.guildTab = tab;
  renderGuildDetail();

  if (tab === 'memories' && !state.guildData.memories) {
    await reloadMemories();
  }
  if (tab === 'content' && !state.guildData.content) {
    await reloadContent();
  }
  if (tab === 'tickets' && !state.guildData.tickets) {
    await reloadTickets();
  }
}

/* ---- Modules ---- */

function guildModulesHtml() {
  const config = state.guildDetail.config;
  const rows = MODULES.map((module) =>
    switchRow('module:' + module.key, module.label, module.desc, config.modules[module.key] !== false),
  ).join('');

  return '<div class="card pad">' +
    '<div class="section-head"><div><p class="eyebrow">Feature modules</p><h2>Enabled commands</h2>' +
    '<p>Disabled modules hide their slash commands in this guild.</p></div></div>' +
    '<form id="guild-modules-form" class="stack" style="margin-top:16px">' +
    rows +
    '<div class="notice">Core, moderation, utility, logging and community commands are always enabled by the bot runtime.</div>' +
    '<div class="sticky-actions"><span class="muted small">Changes apply immediately and are cached by the bot.</span>' +
    '<button class="btn primary" type="submit">Save modules</button></div>' +
    '</form>' +
    '</div>';
}

/* ---- Leveling ---- */

function guildLevelingHtml() {
  const { config, channels, roles } = state.guildDetail;
  const disabled = new Set(config.disableXpChannels || []);
  const live = config.liveLeaderboard || {};
  const channelOptions = channels.map((channel) =>
    '<option value="' + esc(channel.id) + '" ' + (config.levelUpChannel === channel.id ? 'selected' : '') + '>#' +
    esc(channel.name) + '</option>',
  ).join('');
  const xpChannelOptions = channels.map((channel) =>
    '<option value="' + esc(channel.id) + '" ' + (config.xpChannel === channel.id ? 'selected' : '') + '>#' +
    esc(channel.name) + '</option>',
  ).join('');
  const liveChannelOptions = channels.map((channel) =>
    '<option value="' + esc(channel.id) + '" ' + (live.channelId === channel.id ? 'selected' : '') + '>#' +
    esc(channel.name) + '</option>',
  ).join('');

  return '<div class="stack">' +
    '<div class="card pad">' +
    '<div class="section-head"><div><p class="eyebrow">Leveling</p><h2>XP and level-up behavior</h2>' +
    '<p>Members gain XP for messages and for time spent in voice, subject to a per-user cooldown.</p></div></div>' +
    '<form id="guild-leveling-form" class="stack" style="margin-top:16px">' +
    switchRow('xpEnabled', 'XP enabled', 'Award XP for messages and voice time in this guild', config.xpEnabled !== false) +
    '<div class="form-grid" style="margin-top:6px">' +
    fieldNumber('xpCooldown', 'Cooldown (seconds)', config.xpCooldown, 0, 3600, 'Minimum seconds between message XP gains per user') +
    fieldNumber('xpMin', 'Minimum XP per message', config.xpMin, 0, 1000, 'Lower bound of the random message XP roll') +
    fieldNumber('xpMax', 'Maximum XP per message', config.xpMax, 0, 1000, 'Upper bound of the random message XP roll') +
    fieldNumber('xpVoiceMin', 'Minimum XP per voice minute', config.xpVoiceMin, 0, 1000, 'Lower bound of the random voice XP roll') +
    fieldNumber('xpVoiceMax', 'Maximum XP per voice minute', config.xpVoiceMax, 0, 1000, 'Upper bound of the random voice XP roll') +
    '<div class="field"><label class="field-label" for="f-levelUpChannel">Level-up channel</label>' +
    '<select class="select" id="f-levelUpChannel" name="levelUpChannel">' +
    '<option value="">Same channel as the message</option>' + channelOptions + '</select>' +
    '<span class="field-hint">Where level-up announcements are posted.</span></div>' +
    '<div class="field"><label class="field-label" for="f-xpChannel">XP only in channel</label>' +
    '<select class="select" id="f-xpChannel" name="xpChannel">' +
    '<option value="">Any text channel</option>' + xpChannelOptions + '</select>' +
    '<span class="field-hint">When set, voice and message XP only count in this channel.</span></div>' +
    '<div class="field span-2"><label class="field-label" for="f-levelUpMessage">Level-up message</label>' +
    '<input class="input" id="f-levelUpMessage" name="levelUpMessage" maxlength="500" ' +
    'value="' + esc(config.levelUpMessage || '') + '" placeholder="Congrats {user}! You reached level {level}!">' +
    '<span class="field-hint">Placeholders: {user}, {username}, {level}, {server}, {role}, {xp}, {xpneeded}</span></div>' +
    '</div>' +
    switchRow('xpIgnoreBots', 'Ignore bots', 'Bots never gain XP, even when they post or sit in voice', config.xpIgnoreBots !== false) +
    '<div class="field" style="margin-top:4px"><span class="field-label">Channels excluded from XP</span>' +
    '<div class="channel-picker scroll"><div class="check-list">' +
    (channels.length
      ? channels.map((channel) =>
          '<label class="check-option"><input type="checkbox" name="disableXpChannels" value="' + esc(channel.id) + '" ' +
          (disabled.has(channel.id) ? 'checked' : '') + '><span>#' + esc(channel.name) + '</span>' +
          '<span class="chan">' + esc(channel.id) + '</span></label>',
        ).join('')
      : '<div class="empty">No text channels found.</div>') +
    '</div></div><span class="field-hint">Checked channels will not award XP.</span></div>' +
    '<div class="field" style="margin-top:4px"><span class="field-label">Level reward roles</span>' +
    '<div class="stack" style="gap:8px">' + levelRoleRowsHtml(config.levelRoles, roles) + '</div>' +
    '<span class="field-hint">A member reaching a level gets its role. Higher levels replace lower reward roles; ' +
    'leave the role empty to remove a reward.</span></div>' +
    '<div class="sticky-actions"><span class="muted small">XP settings are stored per guild in MongoDB.</span>' +
    '<button class="btn primary" type="submit">Save leveling</button></div>' +
    '</form>' +
    '</div>' +
    '<div class="card pad">' +
    '<div class="section-head"><div><p class="eyebrow">Live leaderboard</p><h2>Auto-updating top members</h2>' +
    '<p>The bot posts a single ranking message and edits it on a schedule instead of spamming new ones.</p></div>' +
    '<span class="badge ' + (live.enabled ? 'green' : 'red') + '">' + (live.enabled ? 'on' : 'off') + '</span></div>' +
    '<form id="guild-live-leaderboard-form" class="stack" style="margin-top:16px">' +
    switchRow('liveEnabled', 'Live leaderboard enabled', 'Keep one ranking message up to date in the channel below', live.enabled === true) +
    '<div class="form-grid" style="margin-top:6px">' +
    '<div class="field"><label class="field-label" for="f-liveChannelId">Channel</label>' +
    '<select class="select" id="f-liveChannelId" name="liveChannelId">' +
    '<option value="">Choose a channel</option>' + liveChannelOptions + '</select>' +
    '<span class="field-hint">Changing the channel reposts the leaderboard.</span></div>' +
    fieldNumber('liveIntervalMinutes', 'Refresh interval (minutes)', live.intervalMinutes ?? 10, 1, 1440, 'How often the message is recomputed') +
    fieldNumber('liveRows', 'Rows to show', live.rows ?? 25, 3, 25, 'Number of members in the ranking') +
    '<div class="field span-2"><label class="field-label" for="f-liveTitle">Title</label>' +
    '<input class="input" id="f-liveTitle" name="liveTitle" maxlength="100" ' +
    'value="' + esc(live.title || '') + '" placeholder="Leaderboard">' +
    '<span class="field-hint">Optional heading used above the ranking.</span></div>' +
    '</div>' +
    '<div class="sticky-actions"><span class="muted small">' +
    (live.messageId ? 'Message <span class="mono">' + esc(live.messageId) + '</span> is being updated.' : 'No message posted yet.') +
    '</span><button class="btn primary" type="submit">Save leaderboard</button></div>' +
    '</form>' +
    '</div>' +
    '</div>';
}

function levelRoleRowsHtml(levelRoles, roles) {
  const entries = Object.entries(levelRoles || {}).sort((a, b) => Number(a[0]) - Number(b[0]));
  const blanks = entries.length >= 8 ? 1 : 3;
  const rows = entries.map(([level, roleId]) => levelRoleRowHtml(level, roleId, roles));
  for (let index = 0; index < blanks; index += 1) rows.push(levelRoleRowHtml('', '', roles));
  return rows.join('');
}

function levelRoleRowHtml(level, roleId, roles) {
  const options = '<option value="">— none —</option>' + (roles || []).map((role) =>
    '<option value="' + esc(role.id) + '" ' + (role.id === roleId ? 'selected' : '') + '>' +
    esc(role.name) + '</option>',
  ).join('');

  return '<div class="row wrap" style="gap:8px;align-items:center">' +
    '<input class="input sm" style="max-width:110px" type="number" min="1" max="500" ' +
    'name="levelRoleLevel" value="' + esc(level) + '" placeholder="Level">' +
    '<select class="select sm" style="max-width:260px" name="levelRoleId">' + options + '</select>' +
    '</div>';
}

function collectLevelRoles(form) {
  const levels = $$('input[name="levelRoleLevel"]', form);
  const roles = $$('select[name="levelRoleId"]', form);
  const result = {};
  levels.forEach((input, index) => {
    const level = Number.parseInt(String(input.value || ''), 10);
    const select = roles[index];
    const roleId = select ? String(select.value || '') : '';
    if (!Number.isFinite(level) || level < 1 || !roleId) return;
    result[String(level)] = roleId;
  });
  return result;
}

function fieldNumber(name, label, value, min, max, hint) {
  return '<div class="field"><label class="field-label" for="f-' + esc(name) + '">' + esc(label) + '</label>' +
    '<input class="input" id="f-' + esc(name) + '" name="' + esc(name) + '" type="number" ' +
    'min="' + min + '" max="' + max + '" value="' + esc(value) + '">' +
    (hint ? '<span class="field-hint">' + esc(hint) + '</span>' : '') +
    '</div>';
}

/* ---- Tickets ---- */

async function reloadTickets() {
  if (!state.selectedGuildId) return;
  const data = await api('/api/guilds/' + encodeURIComponent(state.selectedGuildId) + '/tickets');
  state.guildData.tickets = data;
  if (state.guildTab === 'tickets') {
    renderGuildTabBody();
  }
}

function guildTicketsHtml() {
  const { config, channels, roles } = state.guildDetail;
  const tickets = state.guildData.tickets;
  if (!tickets) {
    return '<div class="loading"><span class="spinner"></span><span>Loading ticket settings…</span></div>';
  }

  const cfg = tickets.config;
  const channelOptions = channels.map((channel) =>
    '<option value="' + esc(channel.id) + '" ' + (cfg.transcriptChannelId === channel.id ? 'selected' : '') + '>#' +
    esc(channel.name) + '</option>',
  ).join('');

  const staffRoleOptions = (roles || []).map((role) =>
    '<option value="' + esc(role.id) + '" ' + (cfg.staffRoleIds.includes(role.id) ? 'selected' : '') + '>' +
    esc(role.name) + '</option>',
  ).join('');

  const deptRows = tickets.departments.map((dept) =>
    '<div class="row wrap" style="gap:8px;align-items:center;margin-bottom:6px">' +
    '<span class="badge" style="background:' + esc(dept.color) + ';color:#fff;border:none">' +
    esc(dept.emoji) + ' ' + esc(dept.name) + '</span>' +
    '<small style="max-width:340px;display:inline-block;vertical-align:middle">' +
    esc(dept.description) + (dept.staffRoleId ? ' · staff: <@&' + esc(dept.staffRoleId) + '>' : '') + '</small>' +
    '<span class="spacer"></span>' +
    (dept.isActive ? '<span class="badge green">active</span>' : '<span class="badge red">inactive</span>') +
    '<button class="btn ghost small" type="button" data-action="edit-ticket-dept" data-id="' + esc(dept.id) + '">Edit</button>' +
    '<button class="btn danger small" type="button" data-action="delete-ticket-dept" data-id="' + esc(dept.id) + '">Delete</button>' +
    '</div>',
  ).join('');

  return '<div class="stack">' +
    '<div class="card pad">' +
    '<div class="section-head"><div><p class="eyebrow">Ticket system</p><h2>Global ticket settings</h2>' +
    '<p>Limits, cooldowns and transcript behaviour for all tickets in this guild.</p></div></div>' +
    '<form id="guild-tickets-form" class="stack" style="margin-top:16px">' +
    fieldNumber('maxTicketsPerUser', 'Max tickets per user', cfg.maxTicketsPerUser, 1, 100, 'Maximum open tickets a single user can have at once') +
    fieldNumber('cooldownSeconds', 'Cooldown (seconds)', cfg.cooldownSeconds, 0, 86400, 'Minimum seconds between ticket creations per user') +
    switchRow('dmTranscript', 'DM transcript on close', 'Send a transcript copy to the ticket owner when a ticket closes', cfg.dmTranscript === true) +
    '<div class="field"><label class="field-label" for="f-transcriptChannelId">Transcript log channel</label>' +
    '<select class="select" id="f-transcriptChannelId" name="transcriptChannelId">' +
    '<option value="">None</option>' + channelOptions + '</select>' +
    '<span class="field-hint">Transcripts are also posted here when a ticket closes.</span></div>' +
    fieldNumber('autoCloseMinutes', 'Auto-close after (minutes)', cfg.autoCloseMinutes, 0, 525600, 'Close tickets inactive for this long. 0 disables auto-close') +
    '<div class="field" style="margin-top:4px"><span class="field-label">Staff roles (can manage all tickets)</span>' +
    '<div class="channel-picker scroll" style="max-height:180px"><div class="check-list">' +
    (roles && roles.length
      ? roles.map((role) =>
          '<label class="check-option"><input type="checkbox" name="staffRoleIds" value="' + esc(role.id) + '" ' +
          (cfg.staffRoleIds.includes(role.id) ? 'checked' : '') + '><span>' + esc(role.name) + '</span>' +
          '<span class="chan">' + esc(role.id) + '</span></label>',
        ).join('')
      : '<div class="empty">No roles found.</div>') +
    '</div></div><span class="field-hint">Members with these roles can see and manage every ticket.</span></div>' +
    '<div class="sticky-actions"><span class="muted small">Ticket settings are stored per guild in MongoDB.</span>' +
    '<button class="btn primary" type="submit">Save ticket settings</button></div>' +
    '</form>' +
    '</div>' +

    '<div class="card pad">' +
    '<div class="section-head"><div><p class="eyebrow">Departments</p><h2>Ticket departments</h2>' +
    '<p>Each department has its own style, staff role and welcome message.</p></div></div>' +
    '<div class="stack" style="margin-top:16px">' +
    '<form id="guild-ticket-dept-form" class="inline-form" style="margin-bottom:16px">' +
    '<input class="input sm" name="deptName" placeholder="Department name" maxlength="50" required>' +
    '<input class="input sm" name="deptDesc" placeholder="Description" maxlength="200" required>' +
    '<input class="input sm" name="deptEmoji" placeholder="🎫" maxlength="5" required>' +
    '<select class="select sm" name="deptStaffRole"><option value="">No staff role restriction</option>' + staffRoleOptions + '</select>' +
    '<div class="row"><span class="spacer"></span><button class="btn primary small" type="submit">Add department</button></div>' +
    '</form>' +
    '<div class="dept-list">' + (deptRows || '<div class="empty">No departments yet.</div>') + '</div>' +
    '</div>' +
    '</div>' +

    '<div class="card pad">' +
    '<div class="card-head"><div><h3>Ticket statistics</h3><p>Current state of the ticket system in this guild.</p></div></div>' +
    '<div class="kv" style="margin-top:12px">' +
    kvRow('Panels posted', num(tickets.stats.panels)) +
    kvRow('Open tickets', num(tickets.stats.openTickets)) +
    '</div>' +
    '</div>' +
    '</div>';
}

function openTicketDeptModal(deptId) {
  const tickets = state.guildData.tickets;
  if (!tickets) return;
  const dept = tickets.departments.find((d) => d.id === deptId);
  if (!dept) return;
  const roles = state.guildDetail.roles || [];
  const roleOptions = roles.map((role) =>
    '<option value="' + esc(role.id) + '" ' + (dept.staffRoleId === role.id ? 'selected' : '') + '>' +
    esc(role.name) + '</option>',
  ).join('');
  showModal(
    '<div class="modal-head"><div><h3>Edit department</h3><p class="mono">' + esc(dept.name) + '</p></div>' +
    '<button class="modal-close" type="button" data-action="modal-close" aria-label="Close">×</button></div>' +
    '<form id="ticket-dept-form" class="modal-body">' +
    '<input type="hidden" name="deptId" value="' + esc(deptId) + '">' +
    '<div class="form-grid">' +
    '<div class="field"><label class="field-label" for="f-deptName">Name</label>' +
    '<input class="input" id="f-deptName" name="deptName" maxlength="50" value="' + esc(dept.name) + '" required></div>' +
    '<div class="field"><label class="field-label" for="f-deptDesc">Description</label>' +
    '<input class="input" id="f-deptDesc" name="deptDesc" maxlength="200" value="' + esc(dept.description) + '" required></div>' +
    '<div class="field"><label class="field-label" for="f-deptEmoji">Emoji</label>' +
    '<input class="input" id="f-deptEmoji" name="deptEmoji" maxlength="5" value="' + esc(dept.emoji) + '" required></div>' +
    '<div class="field"><label class="field-label" for="f-deptStaffRole">Staff role</label>' +
    '<select class="select" id="f-deptStaffRole" name="deptStaffRole">' +
    '<option value="">No restriction</option>' + roleOptions + '</select></div>' +
    '<div class="field span-2"><label class="field-label" for="f-deptWelcome">Welcome message</label>' +
    '<textarea class="input" id="f-deptWelcome" name="deptWelcome" rows="3" maxlength="1000">' +
    esc(dept.welcomeMessage || '') + '</textarea>' +
    '<span class="field-hint">Use {user} to mention the ticket owner.</span></div>' +
    switchRow('deptIsActive', 'Active', 'Inactive departments cannot be used to open tickets', dept.isActive !== false) +
    '</div>' +
    '<div class="modal-foot" style="padding:0">' +
    '<button class="btn ghost" type="button" data-action="modal-close">Cancel</button>' +
    '<button class="btn primary" type="submit">Save changes</button></div>' +
    '</form>',
  );
}

/* ---- Memories ---- */

function guildMemoriesHtml() {
  const data = state.guildData.memories;
  if (!data) {
    return '<div class="loading"><span class="spinner"></span><span>Loading memories…</span></div>';
  }

  return '<div class="card">' +
    '<div class="card-head"><div><h3>Long-term memories</h3><p>' +
    num(data.total) + ' of ' + num(data.max) + ' notes stored for this guild</p></div>' +
    '<button class="btn danger small" type="button" data-action="clear-memories">Clear all</button></div>' +
    '<div class="card-body">' +
    '<div class="search"><input class="input sm" id="memory-search" placeholder="Search facts or members…" value="' +
    esc(state.guildData.memoryQuery || '') + '"></div>' +
    '</div>' +
    '<div class="card-body flush" id="memory-list">' + memoryListHtml(data) + '</div>' +
    '</div>';
}

function memoryListHtml(data) {
  if (!data.memories.length) {
    return '<div class="empty-state"><span class="big">✦</span><span>No memories yet. 爱 Doctora writes these as she learns about the server.</span></div>';
  }
  return data.memories.map((memory) =>
    '<div class="memory"><div class="memory-body"><p>' + esc(memory.fact) + '</p>' +
    '<small>' +
    (memory.aboutName ? 'about ' + esc(memory.aboutName) + ' · ' : '') +
    (memory.aboutUserId ? '<span class="mono">' + esc(memory.aboutUserId) + '</span> · ' : '') +
    esc(timeAgo(memory.createdAt)) + '</small></div>' +
    '<button class="btn ghost small" type="button" data-action="delete-memory" data-id="' + esc(memory.id) + '">Delete</button>' +
    '</div>',
  ).join('');
}

async function reloadMemories() {
  if (!state.selectedGuildId) return;
  const query = state.guildData.memoryQuery || '';
  const data = await api('/api/guilds/' + encodeURIComponent(state.selectedGuildId) + '/memories?q=' + encodeURIComponent(query));
  state.guildData.memories = data;
  if (state.guildTab === 'memories') {
    const host = $('#memory-list');
    if (host) host.innerHTML = memoryListHtml(data);
    else renderGuildTabBody();
    const totalLabel = $('#guild-tab-body .card-head p');
    if (totalLabel) totalLabel.textContent = num(data.total) + ' of ' + num(data.max) + ' notes stored for this guild';
  }
  if (state.guildDetail?.counts) {
    state.guildDetail.counts.memories = data.total;
    updateGuildMemoriesTabLabel();
  }
}

function updateGuildMemoriesTabLabel() {
  const tab = $('.tab[data-tab="memories"]');
  if (tab && state.guildDetail?.counts) {
    tab.textContent = 'Memories (' + state.guildDetail.counts.memories + ')';
  }
}

async function deleteMemory(memoryId) {
  const confirmed = await confirmAction('Delete memory', 'Remove this fact from 爱 Doctora\'s long-term memory?', 'Delete');
  if (!confirmed) return;
  try {
    await api('/api/guilds/' + encodeURIComponent(state.selectedGuildId) + '/memories/' + encodeURIComponent(memoryId), {
      method: 'DELETE',
    });
    showToast('Memory deleted', 'success');
    await reloadMemories();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function clearMemories() {
  const confirmed = await confirmAction(
    'Clear all memories',
    'This deletes every memory 爱 Doctora has stored for this guild. This cannot be undone.',
    'Clear memories',
  );
  if (!confirmed) return;
  try {
    const result = await api('/api/guilds/' + encodeURIComponent(state.selectedGuildId) + '/memories', {
      method: 'DELETE',
    });
    showToast('Deleted ' + num(result.deleted) + ' memories', 'success');
    await reloadMemories();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

/* ---- Content ---- */

function guildContentHtml() {
  const data = state.guildData.content;
  if (!data) {
    return '<div class="loading"><span class="spinner"></span><span>Loading content…</span></div>';
  }

  const { rules, faq, announcements, scheduled, channels } = data;
  const channelOptions = channels.map((channel) =>
    '<option value="' + esc(channel.id) + '">#' + esc(channel.name) + '</option>',
  ).join('');

  return '<div class="content-grid">' +

    '<div class="card content-card"><div class="card-head"><div><h3>Server rules</h3>' +
    '<p>One rule per line. 爱 Doctora can quote these.</p></div></div>' +
    '<div class="card-body"><form id="guild-rules-form" class="stack">' +
    '<textarea class="textarea" name="rules" rows="8" placeholder="Be respectful.&#10;No spam.&#10;Keep it on topic.">' +
    esc((rules || []).join('\n')) + '</textarea>' +
    '<div class="row"><span class="muted tiny grow">' + (rules || []).length + ' rules stored</span>' +
    '<button class="btn primary small" type="submit">Save rules</button></div>' +
    '</form></div></div>' +

    '<div class="card content-card"><div class="card-head"><div><h3>FAQ</h3>' +
    '<p>Searchable answers for common questions.</p></div><span class="badge">' + (faq || []).length + '</span></div>' +
    '<div class="card-body">' +
    '<form id="guild-faq-form" class="inline-form">' +
    '<input class="input sm" name="question" placeholder="Question" maxlength="300" required>' +
    '<textarea class="textarea" name="answer" rows="2" placeholder="Answer" maxlength="4000" required></textarea>' +
    '<input class="input sm" name="tags" placeholder="tags, comma separated" maxlength="200">' +
    '<div class="row"><span class="spacer"></span><button class="btn primary small" type="submit">Add FAQ</button></div>' +
    '</form>' +
    '<div class="mini-list">' + ((faq || []).length
      ? faq.map((entry) =>
          '<div class="mini-item"><div class="body"><strong>' + esc(entry.question) + '</strong>' +
          '<p>' + esc(entry.answer) + '</p></div>' +
          '<button class="btn ghost small" type="button" data-action="delete-faq" data-id="' + esc(String(entry._id)) + '">×</button></div>',
        ).join('')
      : '<div class="empty">No FAQ entries yet.</div>') + '</div>' +
    '</div></div>' +

    '<div class="card content-card"><div class="card-head"><div><h3>Announcements</h3>' +
    '<p>Reusable announcements stored for 爱 Doctora.</p></div><span class="badge">' + (announcements || []).length + '</span></div>' +
    '<div class="card-body">' +
    '<form id="guild-ann-form" class="inline-form">' +
    '<input class="input sm" name="title" placeholder="Title" maxlength="200" required>' +
    '<textarea class="textarea" name="content" rows="2" placeholder="Announcement body" maxlength="4000" required></textarea>' +
    '<div class="row"><span class="spacer"></span><button class="btn primary small" type="submit">Add announcement</button></div>' +
    '</form>' +
    '<div class="mini-list">' + ((announcements || []).length
      ? announcements.map((entry) =>
          '<div class="mini-item"><div class="body"><strong>' + esc(entry.title) + '</strong>' +
          '<p>' + esc(entry.content) + '</p></div>' +
          '<button class="btn ghost small" type="button" data-action="delete-announcement" data-id="' + esc(String(entry._id)) + '">×</button></div>',
        ).join('')
      : '<div class="empty">No announcements yet.</div>') + '</div>' +
    '</div></div>' +

    '<div class="card content-card"><div class="card-head"><div><h3>Scheduled messages</h3>' +
    '<p>Delivered by the bot scheduler.</p></div><span class="badge">' + num(scheduled.pending) + ' pending</span></div>' +
    '<div class="card-body">' +
    '<form id="guild-scheduled-form" class="inline-form">' +
    '<select class="select sm" name="channelId" required><option value="">Choose channel…</option>' + channelOptions + '</select>' +
    '<textarea class="textarea" name="content" rows="2" placeholder="Message content" maxlength="2000" required></textarea>' +
    '<input class="input sm" type="datetime-local" name="scheduledAt" value="' + esc(defaultScheduleValue()) + '" required>' +
    '<div class="row"><span class="spacer"></span><button class="btn primary small" type="submit">Schedule</button></div>' +
    '</form>' +
    '<div class="mini-list">' + ((scheduled.scheduled || []).length
      ? scheduled.scheduled.map((entry) =>
          '<div class="mini-item"><div class="body"><strong>' + (entry.sentAt ? 'Sent' : fmtDate(entry.scheduledAt)) + '</strong>' +
          '<p>' + esc(entry.content) + '</p>' +
          '<p class="mono" style="font-size:10.5px">#' + esc(entry.channelId) + (entry.sentAt ? ' · sent ' + esc(timeAgo(entry.sentAt)) : '') + '</p></div>' +
          (entry.sentAt ? '' : '<button class="btn ghost small" type="button" data-action="cancel-scheduled" data-id="' + esc(entry.id) + '">×</button>') +
          '</div>',
        ).join('')
      : '<div class="empty">Nothing scheduled.</div>') + '</div>' +
    '</div></div>' +

    '</div>';
}

function defaultScheduleValue() {
  const date = new Date(Date.now() + 60 * 60 * 1000);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

async function reloadContent() {
  if (!state.selectedGuildId) return;
  const base = '/api/guilds/' + encodeURIComponent(state.selectedGuildId);
  const [rules, faq, announcements, scheduled] = await Promise.all([
    api(base + '/rules'),
    api(base + '/faq'),
    api(base + '/announcements'),
    api(base + '/scheduled'),
  ]);
  state.guildData.content = {
    rules: rules.rules || [],
    faq: faq.entries || [],
    announcements: announcements.announcements || [],
    scheduled: { scheduled: scheduled.scheduled || [], pending: scheduled.pending || 0 },
    channels: state.guildDetail?.channels || [],
  };
  renderGuildTabBody();
}

/* --------------------------------------------------------------------------
   Persona
   -------------------------------------------------------------------------- */

async function renderPersona(token) {
  setLoading();
  const [configData, guildsData] = await Promise.all([
    api('/api/config'),
    state.guilds.length ? Promise.resolve({ guilds: state.guilds }) : api('/api/guilds'),
  ]);
  if (!isCurrent(token)) return;

  state.guilds = guildsData.guilds;
  state.persona = configData.config;
  state.personaModels = configData.models;
  state.hasGeminiKey = configData.hasGeminiKey;
  state.personaSelectedChannels = new Set(configData.config.channelIds || []);

  if (!state.personaGuildId || !state.guilds.some((guild) => guild.id === state.personaGuildId)) {
    state.personaGuildId = state.selectedGuildId || state.guilds[0]?.id || null;
  }

  state.personaChannels = state.personaGuildId
    ? (await api('/api/guilds/' + encodeURIComponent(state.personaGuildId) + '/channels')).channels
    : [];
  if (!isCurrent(token)) return;

  setView(personaHtml());
}

function personaHtml() {
  const config = state.persona;
  const selectedCount = state.personaSelectedChannels.size;
  const modelIds = state.personaModels.map((model) => model.id);
  if (!modelIds.includes(config.model)) {
    state.personaModels = [{ id: config.model, label: config.model + ' (current)' }].concat(state.personaModels);
  }

  return '<div class="stack"><form id="persona-form" class="stack">' +

    '<div class="card pad">' +
    '<div class="section-head"><div><p class="eyebrow">Identity</p><h2>' + esc(config.displayName) + '</h2>' +
    '<p>How 爱 Doctora presents herself and which model powers replies.</p></div>' +
    '<span class="pill ' + (config.enabled ? 'green' : 'red') + '"><span class="dot"></span>' +
    (config.enabled ? 'Active' : 'Disabled') + '</span></div>' +
    '<div class="form-grid" style="margin-top:16px">' +
    switchRow('enabled', 'Enable persona', 'Respond to messages in activated channels', config.enabled) +
    '<div class="field"><label class="field-label" for="f-displayName">Display name</label>' +
    '<input class="input" id="f-displayName" name="displayName" maxlength="64" value="' + esc(config.displayName) + '" required></div>' +
    '<div class="field"><label class="field-label" for="f-model">Gemini model</label>' +
    '<input class="input mono" id="f-model" name="model" list="persona-model-options" maxlength="100" ' +
    'value="' + esc(config.model) + '" placeholder="gemini-3.8-live" required>' +
    '<datalist id="persona-model-options">' +
    state.personaModels.map((model) =>
      '<option value="' + esc(model.id) + '">' + esc(model.label) + '</option>',
    ).join('') +
    '</datalist>' +
    '<span class="field-hint">' + (state.hasGeminiKey ? 'Gemini API key is configured.' : 'No GEMINI_API_KEY on the host — the persona cannot reply.') +
    ' Pick a suggestion or type any model id. Only Gemini Live models (bidiGenerateContent) work.</span></div>' +
    '<div class="field"><label class="field-label" for="f-thinkingLevel">Thinking level</label>' +
    '<select class="select" id="f-thinkingLevel" name="thinkingLevel">' +
    '<option value="" ' + (!config.thinkingLevel ? 'selected' : '') + '>None</option>' +
    ['low', 'medium', 'high'].map((level) =>
      '<option value="' + level + '" ' + (config.thinkingLevel === level ? 'selected' : '') + '>' + level + '</option>',
    ).join('') +
    '</select><span class="field-hint">Optional reasoning budget hint for supported models.</span></div>' +
    rangeField('temperature', 'Temperature', config.temperature, 0, 2, 0.1, 'decimal') +
    '</div>' +
    '<div class="field" style="margin-top:16px"><div class="field-label"><span>System prompt</span>' +
    '<button class="btn ghost small" type="button" data-action="default-prompt">Load default prompt</button></div>' +
    '<textarea class="textarea code" id="f-systemPrompt" name="systemPrompt" rows="10" placeholder="Leave empty to use the default 爱 Doctora prompt.">' +
    esc(config.systemPrompt || '') + '</textarea>' +
    '<span class="field-hint">Leave empty to use the built-in 爱 Doctora prompt. The runtime integration contract is appended automatically.</span></div>' +
    '</div>' +

    '<div class="grid cols-2">' +
    '<div class="card pad">' +
    '<p class="eyebrow">Behavior</p><h2 style="font-size:16px;margin:0 0 6px">Conversation tools</h2>' +
    switchRow('showTyping', 'Typing indicator', 'Show typing before a reply', config.showTyping) +
    switchRow('dmEnabled', 'Private DMs', 'Also answer direct messages sent to the bot', config.dmEnabled) +
    switchRow('memoryEnabled', 'Long-term memory', 'Store and recall facts about the server', config.memoryEnabled) +
    switchRow('toolsEnabled', 'Information tools', 'Let the persona inspect server context', config.toolsEnabled) +
    switchRow('knowledgeEnabled', 'Community knowledge', 'Rules, FAQ and announcements', config.knowledgeEnabled) +
    switchRow('islamicEnabled', 'Islamic knowledge', 'Knowledge responses for that domain', config.islamicEnabled) +
    switchRow('webEnabled', 'Web search', 'Allow web search tooling', config.webEnabled) +
    switchRow('schedulingEnabled', 'Scheduling', 'Scheduled message tools', config.schedulingEnabled) +
    switchRow('attachmentsEnabled', 'Image analysis', 'Read image attachments', config.attachmentsEnabled) +
    '<div class="form-grid" style="margin-top:14px">' +
    rangeField('batchWindowMs', 'Batch window', config.batchWindowMs, 100, 2000, 100, 'ms') +
    rangeField('historySize', 'History size', config.historySize, 10, 200, 10, 'int') +
    fieldNumber('maxMessageLength', 'Max message length', config.maxMessageLength, 100, 4000, 'Characters before truncation') +
    '</div>' +
    '</div>' +

    '<div class="card pad">' +
    '<p class="eyebrow">Rate limiting</p><h2 style="font-size:16px;margin:0 0 6px">Protect the conversation</h2>' +
    rangeField('maxRepliesPerHour', 'Max replies per hour', config.maxRepliesPerHour, 1, 100, 1, 'int') +
    rangeField('decisionCooldownSeconds', 'Decision cooldown', config.decisionCooldownSeconds, 0, 10, 0.5, 'seconds') +
    rangeField('replyCooldownSeconds', 'Reply cooldown', config.replyCooldownSeconds, 0, 10, 0.5, 'seconds') +
    fieldNumber('requestTimeoutMs', 'Request timeout (ms)', config.requestTimeoutMs, 1000, 120000, 'Abort a Gemini call after this long') +
    '<div class="notice" style="margin-top:12px">These limits are global. Channel activation is per guild below.</div>' +
    '</div>' +
    '</div>' +

    '<div class="card pad">' +
    '<div class="section-head"><div><p class="eyebrow">Activation</p><h2>Channels where 爱 Doctora replies</h2>' +
    '<p><span id="persona-channel-count">' + selectedCount + '</span> <span id="persona-channel-label">channel' +
    (selectedCount === 1 ? '' : 's') + '</span> selected across all guilds.</p></div>' +
    '<span class="badge">' + num(config.channelIds.length) + ' saved</span></div>' +
    '<div class="form-grid" style="margin-top:16px">' +
    '<div class="field"><label class="field-label" for="persona-guild-select">Browse guild</label>' +
    '<select class="select" id="persona-guild-select">' +
    (state.guilds.length
      ? state.guilds.map((guild) =>
          '<option value="' + esc(guild.id) + '" ' + (guild.id === state.personaGuildId ? 'selected' : '') + '>' +
          esc(guild.name) + ' · ' + num(guild.members) + ' members</option>',
        ).join('')
      : '<option value="">No guilds available</option>') +
    '</select><span class="field-hint">Selections are preserved across guilds.</span></div>' +
    '</div>' +
    '<div class="channel-picker scroll" id="persona-channels" style="margin-top:12px">' + personaChannelsHtml() + '</div>' +
    '</div>' +

    '</form>' +

    '<div class="card pad">' +
    '<div class="section-head"><div><p class="eyebrow">Sandbox</p><h2>Test the persona</h2>' +
    '<p>Runs one real Gemini call using the saved configuration.</p></div></div>' +
    '<form id="persona-test-form" class="stack" style="margin-top:14px">' +
    '<textarea class="textarea" name="prompt" rows="3" maxlength="4000" placeholder="Ask 爱 Doctora something, e.g. “someone just said the server is dead, roast them gently”" required></textarea>' +
    '<div class="row"><span class="muted tiny grow">The test uses the current saved model, prompt and temperature.</span>' +
    '<button class="btn primary" type="submit">Run test</button></div>' +
    '</form>' +
    '<div id="persona-test-result" class="test-output" hidden></div>' +
    '</div>' +

    '<div class="sticky-actions">' +
    '<span class="muted small">Persona settings are stored globally in MongoDB and applied on the next message.</span>' +
    '<div class="row"><button class="btn ghost" type="button" data-action="reset-persona">Reset to defaults</button>' +
    '<button class="btn primary" type="submit" form="persona-form">Save persona</button></div>' +
    '</div>' +
    '</div>';
}

function personaChannelsHtml() {
  if (!state.personaChannels.length) {
    return '<div class="empty">No text channels available for this guild.</div>';
  }
  return '<div class="check-list">' + state.personaChannels.map((channel) => {
    const checked = state.personaSelectedChannels.has(channel.id);
    return '<label class="check-option"><input type="checkbox" name="channelIds" value="' + esc(channel.id) + '" ' +
      (checked ? 'checked' : '') + '><span>#' + esc(channel.name) + '</span>' +
      '<span class="chan">' + esc(channel.id) + '</span></label>';
  }).join('') + '</div>';
}

function renderPersonaChannels() {
  const host = $('#persona-channels');
  if (host) host.innerHTML = personaChannelsHtml();
  renderPersonaChannelCount();
}

function renderPersonaChannelCount() {
  const size = state.personaSelectedChannels.size;
  const count = $('#persona-channel-count');
  if (count) count.textContent = String(size);
  const label = $('#persona-channel-label');
  if (label) label.textContent = size === 1 ? 'channel' : 'channels';
}

async function updatePersonaGuild(guildId) {
  state.personaGuildId = guildId || null;
  if (!guildId) {
    state.personaChannels = [];
    renderPersonaChannels();
    return;
  }
  const host = $('#persona-channels');
  if (host) host.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
  try {
    const data = await api('/api/guilds/' + encodeURIComponent(guildId) + '/channels');
    state.personaChannels = data.channels;
    renderPersonaChannels();
  } catch (error) {
    showToast(error.message, 'error');
    if (host) host.innerHTML = '<div class="empty">' + esc(error.message) + '</div>';
  }
}

async function savePersona(form) {
  const data = new FormData(form);
  const patch = {
    enabled: data.get('enabled') === 'on',
    displayName: String(data.get('displayName') || '').trim(),
    model: String(data.get('model') || '').trim(),
    temperature: Number(data.get('temperature')),
    thinkingLevel: String(data.get('thinkingLevel') || '') || null,
    systemPrompt: String(data.get('systemPrompt') || '').trim() || null,
    showTyping: data.get('showTyping') === 'on',
    dmEnabled: data.get('dmEnabled') === 'on',
    memoryEnabled: data.get('memoryEnabled') === 'on',
    toolsEnabled: data.get('toolsEnabled') === 'on',
    knowledgeEnabled: data.get('knowledgeEnabled') === 'on',
    islamicEnabled: data.get('islamicEnabled') === 'on',
    webEnabled: data.get('webEnabled') === 'on',
    schedulingEnabled: data.get('schedulingEnabled') === 'on',
    attachmentsEnabled: data.get('attachmentsEnabled') === 'on',
    batchWindowMs: Number(data.get('batchWindowMs')),
    historySize: Number(data.get('historySize')),
    maxMessageLength: Number(data.get('maxMessageLength')),
    maxRepliesPerHour: Number(data.get('maxRepliesPerHour')),
    decisionCooldownSeconds: Number(data.get('decisionCooldownSeconds')),
    replyCooldownSeconds: Number(data.get('replyCooldownSeconds')),
    requestTimeoutMs: Number(data.get('requestTimeoutMs')),
    channelIds: Array.from(state.personaSelectedChannels),
  };

  const result = await api('/api/config', { method: 'PUT', body: patch });
  state.persona = result.config;
  state.personaSelectedChannels = new Set(result.config.channelIds || []);
  showToast('Persona configuration saved', 'success');

  const enabled = result.config.enabled;
  if (state.overview) state.overview.persona.enabled = enabled;
  refreshOverviewHeader();
}

async function useDefaultPrompt() {
  try {
    const data = await api('/api/persona/prompt');
    const textarea = $('#f-systemPrompt');
    if (textarea) {
      textarea.value = data.defaultPrompt;
      textarea.focus();
      showToast('Default prompt loaded — save to apply', 'info');
    }
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function testPersona(form) {
  const prompt = String(new FormData(form).get('prompt') || '').trim();
  if (!prompt) {
    showToast('Enter a test prompt first', 'warn');
    return;
  }

  const result = $('#persona-test-result');
  result.hidden = false;
  result.innerHTML = '<div class="row"><span class="spinner sm"></span><span class="muted small">Calling Gemini…</span></div>';

  try {
    const data = await api('/api/persona/test', { method: 'POST', body: { prompt } });
    result.innerHTML =
      '<div class="row wrap" style="margin-bottom:8px">' +
      '<span class="badge green">' + esc(data.model) + '</span>' +
      '<span class="badge">' + num(data.elapsedMs) + 'ms</span></div>' +
      '<div class="test-text">' + esc(data.response) + '</div>';
    showToast('Persona test completed', 'success');
  } catch (error) {
    result.innerHTML = '<div class="notice danger">' + esc(error.message) + '</div>';
    showToast(error.message, 'error');
  }
}

async function resetPersona() {
  const confirmed = await confirmAction(
    'Reset persona configuration',
    'Restore the default 爱 Doctora prompt, model, limits and disable all activation channels?',
    'Reset settings',
  );
  if (!confirmed) return;
  try {
    const result = await api('/api/config', { method: 'DELETE' });
    state.persona = result.config;
    state.personaSelectedChannels = new Set(result.config.channelIds || []);
    showToast('Persona configuration reset', 'success');
    await route();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

/* --------------------------------------------------------------------------
   Users / economy
   -------------------------------------------------------------------------- */

async function renderUsers(token) {
  setLoading();
  await loadUsers(token);
  if (!isCurrent(token)) return;
  setView(usersHtml());
}

async function loadUsers(token) {
  const params = new URLSearchParams({
    sort: state.userSort,
    order: state.userOrder,
    limit: '25',
    page: String(state.userPage),
  });
  if (state.userQuery) params.set('q', state.userQuery);
  const data = await api('/api/users?' + params.toString());
  if (token !== undefined && !isCurrent(token)) return;
  state.users = data;
}

function usersHtml() {
  const data = state.users;
  return '<section class="card">' +
    '<div class="card-head"><div><h3>Economy &amp; levels</h3><p id="user-summary">' +
    num(data.total) + ' tracked users · page ' + data.page + ' of ' + data.pages + '</p></div>' +
    '<div class="badge" id="user-sort-badge">' + esc(data.sort) + ' · ' + esc(data.order) + '</div></div>' +
    '<div class="card-body"><div class="toolbar">' +
    '<div class="search"><input class="input sm" id="user-search" placeholder="Search by user ID…" value="' + esc(state.userQuery) + '"></div>' +
    '<select class="select sm" id="user-sort">' +
    [['totalXp', 'Total XP'], ['balance', 'Wallet'], ['level', 'Level'], ['createdAt', 'Newest']]
      .map(([value, label]) => '<option value="' + value + '" ' + (data.sort === value ? 'selected' : '') + '>' + label + '</option>').join('') +
    '</select>' +
    '<select class="select sm" id="user-order">' +
    '<option value="desc" ' + (data.order === 'desc' ? 'selected' : '') + '>High → low</option>' +
    '<option value="asc" ' + (data.order === 'asc' ? 'selected' : '') + '>Low → high</option>' +
    '</select>' +
    '<span class="spacer"></span>' +
    '<button class="btn ghost small" type="button" data-action="refresh">Refresh</button>' +
    '</div></div>' +
    '<div class="table-wrap"><table>' +
    '<thead><tr><th>#</th><th>User</th><th class="num">Wallet</th><th class="num">Bank</th>' +
    '<th class="num">Level</th><th class="num">Total XP</th><th>Last daily</th><th></th></tr></thead>' +
    '<tbody id="user-rows">' + userRowsHtml(data) + '</tbody></table></div>' +
    '<div class="card-body" id="user-foot">' + userFootHtml(data) + '</div>' +
    '</section>';
}

function userRowsHtml(data) {
  if (!data.users.length) {
    return '<tr><td colspan="8"><div class="empty">No user records yet. Economy and leveling create them on first interaction.</div></td></tr>';
  }
  return data.users.map((user) =>
    '<tr>' +
    '<td class="num muted">' + user.position + '</td>' +
    '<td><div class="user-cell">' + userAvatar(user) +
    '<div class="who"><strong>' + esc(user.username || user.tag || 'Unknown user') + '</strong>' +
    '<small>' + esc(user.userId) + '</small></div></div></td>' +
    '<td class="num">' + num(user.balance) + '</td>' +
    '<td class="num">' + num(user.bank) + ' <span class="muted tiny">/ ' + num(user.bankLimit) + '</span></td>' +
    '<td class="num">' + num(user.level) + '</td>' +
    '<td class="num">' + num(user.totalXp) + '</td>' +
    '<td class="muted">' + esc(user.lastDaily ? timeAgo(user.lastDaily) : 'never') + '</td>' +
    '<td class="right"><button class="btn ghost small" type="button" data-action="edit-user" data-id="' +
    esc(user.userId) + '">Edit</button></td>' +
    '</tr>',
  ).join('');
}

function userFootHtml(data) {
  return '<div class="row">' +
    '<span class="muted small">Showing ' + (data.users.length ? (data.page - 1) * data.limit + 1 : 0) +
    '–' + ((data.page - 1) * data.limit + data.users.length) + ' of ' + num(data.total) + '</span>' +
    '<span class="spacer"></span>' +
    '<button class="btn ghost small" type="button" data-action="users-prev" ' + (data.page <= 1 ? 'disabled' : '') + '>Previous</button>' +
    '<button class="btn ghost small" type="button" data-action="users-next" ' + (data.page >= data.pages ? 'disabled' : '') + '>Next</button>' +
    '</div>';
}

/** Re-render only the result parts so the search box keeps focus and caret. */
function refreshUsersView() {
  if (!$('#user-rows')) {
    setView(usersHtml());
    return;
  }
  const data = state.users;
  const summary = $('#user-summary');
  if (summary) {
    summary.textContent = num(data.total) + ' tracked users · page ' + data.page + ' of ' + data.pages;
  }
  const badge = $('#user-sort-badge');
  if (badge) badge.textContent = data.sort + ' · ' + data.order;
  const rows = $('#user-rows');
  if (rows) rows.innerHTML = userRowsHtml(data);
  const foot = $('#user-foot');
  if (foot) foot.innerHTML = userFootHtml(data);
}

function openUserModal(userId) {
  const user = state.users.users.find((row) => row.userId === userId);
  if (!user) return;
  showModal(
    '<div class="modal-head"><div><h3>Edit user record</h3><p class="mono">' + esc(user.userId) + '</p></div>' +
    '<button class="modal-close" type="button" data-action="modal-close" aria-label="Close">×</button></div>' +
    '<form id="user-form" class="modal-body">' +
    '<input type="hidden" name="userId" value="' + esc(user.userId) + '">' +
    '<div class="form-grid">' +
    modalNumber('balance', 'Wallet balance', user.balance) +
    modalNumber('bank', 'Bank balance', user.bank) +
    modalNumber('bankLimit', 'Bank limit', user.bankLimit) +
    modalNumber('totalXp', 'Total XP', user.totalXp) +
    '</div>' +
    '<div class="notice warn">Direct edits bypass normal economy rules. Level (' +
    esc(num(user.level)) + ') is derived from total XP with the MEE6 curve and is recalculated on save.</div>' +
    '<div class="modal-foot" style="padding:0">' +
    '<button class="btn ghost" type="button" data-action="modal-close">Cancel</button>' +
    '<button class="btn primary" type="submit">Save changes</button></div>' +
    '</form>',
  );
}

function modalNumber(name, label, value) {
  return '<div class="field"><label class="field-label" for="u-' + name + '">' + esc(label) + '</label>' +
    '<input class="input" id="u-' + name + '" type="number" min="0" name="' + name + '" value="' + esc(value) + '"></div>';
}

async function saveUser(form) {
  const data = new FormData(form);
  const userId = String(data.get('userId') || '');
  const patch = {};
  for (const key of ['balance', 'bank', 'bankLimit', 'totalXp']) {
    const raw = data.get(key);
    if (raw !== null && raw !== '') patch[key] = Math.max(0, Math.round(Number(raw)));
  }
  await api('/api/users/' + encodeURIComponent(userId), { method: 'PATCH', body: patch });
  closeModal();
  showToast('User record updated', 'success');
  await loadUsers(state.renderToken);
  refreshUsersView();
}

async function usersPage(delta) {
  state.userPage = Math.max(1, state.userPage + delta);
  await loadUsers(state.renderToken);
  refreshUsersView();
}

/* --------------------------------------------------------------------------
   Commands
   -------------------------------------------------------------------------- */

async function renderCommands(token) {
  setLoading();
  if (!state.commands.length) {
    const data = await api('/api/commands');
    if (!isCurrent(token)) return;
    state.commands = data.commands;
  }
  setView(commandsHtml());
}

function commandsHtml() {
  const categories = Array.from(new Set(state.commands.map((command) => command.category))).sort();
  const filtered = state.commands.filter((command) => {
    if (state.commandCategory !== 'all' && command.category !== state.commandCategory) return false;
    if (state.commandQuery) {
      const needle = state.commandQuery.toLowerCase();
      return command.name.toLowerCase().includes(needle) ||
        command.description.toLowerCase().includes(needle) ||
        command.category.toLowerCase().includes(needle);
    }
    return true;
  });

  return '<section class="stack">' +
    '<div class="card pad"><div class="toolbar">' +
    '<div class="search"><input class="input sm" id="command-search" placeholder="Search commands…" value="' +
    esc(state.commandQuery) + '"></div>' +
    '<select class="select sm" id="command-category">' +
    '<option value="all">All categories (' + state.commands.length + ')</option>' +
    categories.map((category) => {
      const count = state.commands.filter((command) => command.category === category).length;
      return '<option value="' + esc(category) + '" ' + (state.commandCategory === category ? 'selected' : '') + '>' +
        esc(category) + ' (' + count + ')</option>';
    }).join('') +
    '</select>' +
    '<span class="spacer"></span>' +
    '<span class="muted small" id="command-count">' + filtered.length + ' shown</span>' +
    '</div></div>' +
    '<div class="cmd-grid" id="command-list">' + commandCards(filtered) + '</div>' +
    '</section>';
}

function commandCards(commands) {
  if (!commands.length) {
    return '<div class="card pad"><div class="empty-state"><span class="big">⌘</span><span>No commands match this filter.</span></div></div>';
  }
  return commands.map((command) => {
    const tone = COMMAND_TONES[command.category] || '';
    const options = command.options || [];
    return '<div class="card cmd-card">' +
      '<div class="cmd-name">' + esc(command.name) + '</div>' +
      '<p class="cmd-desc">' + esc(command.description || 'No description.') + '</p>' +
      '<div class="cmd-meta">' +
      '<span class="badge ' + tone + '">' + esc(command.category) + '</span>' +
      '<span class="badge">' + command.cooldownSeconds + 's cooldown</span>' +
      (command.premiumOnly ? '<span class="badge amber">premium</span>' : '') +
      (command.userPermissions.length ? '<span class="badge red">perms</span>' : '') +
      '</div>' +
      (options.length
        ? '<div class="cmd-options">' + options.map((option) =>
            '<span>' + esc(option.name) + (option.required ? '*' : '') + '</span>',
          ).join('') + '</div>'
        : '') +
      '</div>';
  }).join('');
}

function refreshCommandList() {
  const filtered = state.commands.filter((command) => {
    if (state.commandCategory !== 'all' && command.category !== state.commandCategory) return false;
    if (state.commandQuery) {
      const needle = state.commandQuery.toLowerCase();
      return command.name.toLowerCase().includes(needle) ||
        command.description.toLowerCase().includes(needle) ||
        command.category.toLowerCase().includes(needle);
    }
    return true;
  });
  const host = $('#command-list');
  if (host) host.innerHTML = commandCards(filtered);
  const count = $('#command-count');
  if (count) count.textContent = filtered.length + ' shown';
}

/* --------------------------------------------------------------------------
   Activity
   -------------------------------------------------------------------------- */

async function renderActivity(token) {
  setLoading();
  await loadActivity(token);
  if (!isCurrent(token)) return;
  setView(activityHtml());
}

async function loadActivity(token) {
  const data = await api('/api/activity?limit=' + state.activity.limit + '&kind=' + encodeURIComponent(state.activity.kind));
  if (token !== undefined && !isCurrent(token)) return;
  state.activity.events = data.events;
  state.activity.counters = data.counters;
}

function activityHtml() {
  const kinds = [['all', 'All'], ['command', 'Commands'], ['ai', 'AI'], ['error', 'Errors'], ['system', 'System'], ['log', 'Logs']];
  return '<section class="card">' +
    '<div class="card-head"><div><h3>Live activity</h3><p>Bounded in-memory feed · newest first</p></div>' +
    '<div class="row"><button class="btn ghost small" type="button" data-action="activity-auto">' +
    (state.activityTimer ? '■ Stop auto-refresh' : '▶ Auto-refresh') + '</button>' +
    '<button class="btn ghost small" type="button" data-action="refresh">Refresh</button></div></div>' +
    '<div class="card-body"><div class="tabs">' +
    kinds.map(([kind, label]) =>
      '<button class="tab ' + (state.activity.kind === kind ? 'active' : '') + '" type="button" ' +
      'data-action="activity-kind" data-kind="' + kind + '">' + label + '</button>',
    ).join('') + '</div></div>' +
    '<div class="card-body flush" id="activity-feed">' + renderActivityList(state.activity.events, false) + '</div>' +
    '</section>';
}

function scheduleActivityRefresh() {
  if (state.activityTimer) clearInterval(state.activityTimer);
  if (state.route !== 'activity') return;
  state.activityTimer = setInterval(async () => {
    try {
      await loadActivity();
      const host = $('#activity-feed');
      if (host) host.innerHTML = renderActivityList(state.activity.events, false);
    } catch {
      /* ignore transient errors */
    }
  }, 8000);
}

async function setActivityKind(kind) {
  state.activity.kind = kind;
  await loadActivity();
  setView(activityHtml());
}

function toggleActivityAuto() {
  if (state.activityTimer) {
    clearInterval(state.activityTimer);
    state.activityTimer = null;
    showToast('Auto-refresh paused', 'info');
  } else {
    scheduleActivityRefresh();
    showToast('Auto-refresh enabled (8s)', 'success');
  }
  setView(activityHtml());
}

/* --------------------------------------------------------------------------
   System
   -------------------------------------------------------------------------- */

async function renderSystem(token) {
  setLoading();
  const overview = await api('/api/overview');
  if (!isCurrent(token)) return;
  state.overview = overview;
  refreshOverviewHeader();

  const db = overview.database;
  const persona = overview.persona;
  const runtime = overview.runtime;

  const endpoints = [
    ['GET', '/api/overview', 'Runtime snapshot'],
    ['GET', '/api/activity', 'Activity feed'],
    ['GET', '/api/guilds', 'Guild list'],
    ['GET', '/api/guilds/:id', 'Guild settings'],
    ['PATCH', '/api/guilds/:id', 'Update modules / XP'],
    ['GET', '/api/guilds/:id/memories', 'List memories'],
    ['DELETE', '/api/guilds/:id/memories', 'Clear memories'],
    ['GET/PUT', '/api/guilds/:id/rules', 'Server rules'],
    ['GET/POST', '/api/guilds/:id/faq', 'FAQ entries'],
    ['GET/POST', '/api/guilds/:id/announcements', 'Announcements'],
    ['GET/POST', '/api/guilds/:id/scheduled', 'Scheduled messages'],
    ['GET/PUT', '/api/config', 'Persona config'],
    ['POST', '/api/persona/test', 'Run Gemini test'],
    ['GET/PATCH', '/api/users', 'Economy records'],
    ['GET', '/api/commands', 'Command registry'],
  ];

  setView(
    '<section class="grid side">' +
    '<div class="stack">' +
    '<div class="card pad"><div class="section-head"><div><p class="eyebrow">Runtime</p><h2>Bot process</h2>' +
    '<p>Live values from the Node.js process hosting 爱 Doctora.</p></div>' +
    '<span class="badge ' + (db.state === 'connected' ? 'green' : 'red') + '">' + esc(db.state) + '</span></div>' +
    '<div class="kv" style="margin-top:12px">' +
    kvRow('Bot', esc(overview.bot ? overview.bot.tag : '—')) +
    kvRow('Application ID', '<span class="mono">' + esc(overview.bot ? overview.bot.id : '—') + '</span>') +
    kvRow('Node.js', '<span class="mono">' + esc(runtime.node) + '</span>') +
    kvRow('Platform', esc(runtime.platform + ' / ' + runtime.arch)) +
    kvRow('PID', '<span class="mono">' + esc(runtime.pid) + '</span>') +
    kvRow('Process uptime', duration(overview.processUptimeMs)) +
    kvRow('Bot uptime', duration(overview.uptimeMs)) +
    kvRow('Gateway ping', esc(pingLabel(overview.ping))) +
    kvRow('Memory RSS', esc(bytes(overview.memory.rss))) +
    kvRow('Heap', esc(bytes(overview.memory.heapUsed) + ' / ' + bytes(overview.memory.heapTotal))) +
    '</div></div>' +

    '<div class="card pad"><div class="section-head"><div><p class="eyebrow">Persona</p><h2>AI configuration</h2></div>' +
    '<span class="pill ' + (persona.enabled ? 'green' : 'red') + '"><span class="dot"></span>' +
    (persona.enabled ? 'Active' : 'Disabled') + '</span></div>' +
    '<div class="kv" style="margin-top:12px">' +
    kvRow('Model', '<span class="mono">' + esc(persona.model) + '</span>') +
    kvRow('Display name', esc(persona.displayName)) +
    kvRow('Temperature', esc(String(persona.temperature))) +
    kvRow('Activation channels', num(persona.channels)) +
    kvRow('Gemini API key', persona.hasApiKey ? '<span class="badge green">configured</span>' : '<span class="badge red">missing</span>') +
    kvRow('AI replies', num(overview.counters.aiReplies)) +
    kvRow('Errors', num(overview.counters.errors)) +
    '</div>' +
    '<div class="row" style="margin-top:14px"><a class="btn ghost small" href="#/persona">Edit persona</a>' +
    '<button class="btn ghost small" type="button" data-action="reset-persona">Reset persona</button></div>' +
    '</div>' +

    '<div class="card pad"><div class="section-head"><div><p class="eyebrow">Security</p><h2>Dashboard access</h2></div>' +
    '<span class="badge green">authenticated</span></div>' +
    '<div class="kv" style="margin-top:12px">' +
    kvRow('Access token', overview.dashboard.tokenSource === 'environment' ? 'DASHBOARD_TOKEN' : 'generated at startup') +
    kvRow('Listen address', '<span class="mono">' + esc(overview.dashboard.host + ':' + overview.dashboard.port) + '</span>') +
    kvRow('Session', 'signed HttpOnly cookie · 7 days') +
    kvRow('Transport', 'set DASHBOARD_TOKEN and use HTTPS behind a proxy') +
    '</div>' +
    '<div class="notice warn" style="margin-top:12px">The dashboard binds 0.0.0.0 so the hosting platform can reach it. ' +
    'Keep the access token private and rotate it by changing DASHBOARD_TOKEN.</div>' +
    '</div>' +
    '</div>' +

    '<div class="stack">' +
    '<div class="card pad"><div class="section-head"><div><p class="eyebrow">API</p><h2>Endpoints</h2>' +
    '<p>Every route except health and auth requires the session.</p></div></div>' +
    '<div class="table-wrap" style="margin-top:12px"><table><thead><tr><th>Method</th><th>Path</th><th>Purpose</th></tr></thead><tbody>' +
    endpoints.map(([method, path, purpose]) =>
      '<tr><td><span class="badge blue">' + esc(method) + '</span></td>' +
      '<td class="mono">' + esc(path) + '</td><td class="muted">' + esc(purpose) + '</td></tr>',
    ).join('') +
    '</tbody></table></div></div>' +

    '<div class="card pad"><div class="section-head"><div><p class="eyebrow">Session</p><h2>Sign out</h2>' +
    '<p>Clears the signed session cookie from this browser.</p></div></div>' +
    '<button class="btn danger" type="button" data-action="logout" style="margin-top:12px">Sign out of dashboard</button>' +
    '</div>' +
    '</div>' +
    '</section>',
  );
}

/* --------------------------------------------------------------------------
   Event handling
   -------------------------------------------------------------------------- */

document.addEventListener('submit', async (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();

  try {
    switch (form.id) {
      case 'login-form':
        await handleLogin(form);
        break;

      case 'persona-form':
        await runForm(form, () => savePersona(form));
        break;

      case 'persona-test-form':
        await runForm(form, () => testPersona(form));
        break;

      case 'guild-modules-form': {
        const guildId = state.selectedGuildId;
        await runForm(form, async () => {
          const modules = {};
          $$('input[name^="module:"]', form).forEach((input) => {
            modules[input.name.slice('module:'.length)] = input.checked;
          });
          const result = await api('/api/guilds/' + encodeURIComponent(guildId), { method: 'PATCH', body: { modules } });
          state.guildDetail.config = result.config;
          showToast('Module settings saved', 'success');
        });
        break;
      }

      case 'guild-leveling-form': {
        const guildId = state.selectedGuildId;
        await runForm(form, async () => {
          const data = new FormData(form);
          const body = {
            xpEnabled: data.get('xpEnabled') === 'on',
            xpIgnoreBots: data.get('xpIgnoreBots') === 'on',
            xpCooldown: Number(data.get('xpCooldown')),
            xpMin: Number(data.get('xpMin')),
            xpMax: Number(data.get('xpMax')),
            xpVoiceMin: Number(data.get('xpVoiceMin')),
            xpVoiceMax: Number(data.get('xpVoiceMax')),
            xpChannel: String(data.get('xpChannel') || '') || null,
            levelUpChannel: String(data.get('levelUpChannel') || '') || null,
            levelUpMessage: String(data.get('levelUpMessage') || '').trim() || null,
            disableXpChannels: data.getAll('disableXpChannels').map(String),
            levelRoles: collectLevelRoles(form),
          };
          const result = await api('/api/guilds/' + encodeURIComponent(guildId), { method: 'PATCH', body });
          applyGuildConfig(result);
          showToast('Leveling settings saved', 'success');
        });
        break;
      }

      case 'guild-live-leaderboard-form': {
        const guildId = state.selectedGuildId;
        await runForm(form, async () => {
          const data = new FormData(form);
          const body = {
            liveLeaderboard: {
              enabled: data.get('liveEnabled') === 'on',
              channelId: String(data.get('liveChannelId') || '') || null,
              intervalMinutes: Number(data.get('liveIntervalMinutes')),
              rows: Number(data.get('liveRows')),
              title: String(data.get('liveTitle') || '').trim() || null,
            },
          };
          const result = await api('/api/guilds/' + encodeURIComponent(guildId), { method: 'PATCH', body });
          applyGuildConfig(result);
          showToast('Live leaderboard saved', 'success');
        });
        break;
      }

      case 'guild-tickets-form': {
        const guildId = state.selectedGuildId;
        await runForm(form, async () => {
          const data = new FormData(form);
          const body = {
            maxTicketsPerUser: Number(data.get('maxTicketsPerUser')),
            cooldownSeconds: Number(data.get('cooldownSeconds')),
            dmTranscript: data.get('dmTranscript') === 'on',
            transcriptChannelId: String(data.get('transcriptChannelId') || '') || null,
            autoCloseMinutes: Number(data.get('autoCloseMinutes')),
            staffRoleIds: data.getAll('staffRoleIds').map(String),
          };
          await api('/api/guilds/' + encodeURIComponent(guildId) + '/tickets/config', {
            method: 'PATCH',
            body,
          });
          state.guildData.tickets = null;
          await reloadTickets();
          showToast('Ticket settings saved', 'success');
        });
        break;
      }

      case 'guild-ticket-dept-form': {
        const guildId = state.selectedGuildId;
        await runForm(form, async () => {
          const data = new FormData(form);
          await api('/api/guilds/' + encodeURIComponent(guildId) + '/tickets/departments', {
            method: 'POST',
            body: {
              name: String(data.get('deptName') || ''),
              description: String(data.get('deptDesc') || ''),
              emoji: String(data.get('deptEmoji') || '🎫'),
              staffRoleId: String(data.get('deptStaffRole') || '') || null,
            },
          });
          state.guildData.tickets = null;
          await reloadTickets();
          showToast('Department created', 'success');
        });
        break;
      }

      case 'ticket-dept-form': {
        const guildId = state.selectedGuildId;
        await runForm(form, async () => {
          const data = new FormData(form);
          const body = {
            name: String(data.get('deptName') || ''),
            description: String(data.get('deptDesc') || ''),
            emoji: String(data.get('deptEmoji') || '🎫'),
            staffRoleId: String(data.get('deptStaffRole') || '') || null,
            welcomeMessage: String(data.get('deptWelcome') || ''),
            isActive: data.get('deptIsActive') === 'on',
          };
          await api('/api/guilds/' + encodeURIComponent(guildId) + '/tickets/departments/' + encodeURIComponent(data.get('deptId')), {
            method: 'PATCH',
            body,
          });
          closeModal();
          state.guildData.tickets = null;
          await reloadTickets();
          showToast('Department updated', 'success');
        });
        break;
      }

      case 'guild-rules-form': {
        const guildId = state.selectedGuildId;
        await runForm(form, async () => {
          const raw = String(new FormData(form).get('rules') || '');
          const rules = raw.split('\n').map((rule) => rule.trim()).filter(Boolean);
          await api('/api/guilds/' + encodeURIComponent(guildId) + '/rules', { method: 'PUT', body: { rules } });
          state.guildData.content.rules = rules;
          showToast('Server rules saved', 'success');
          await reloadContent();
        });
        break;
      }

      case 'guild-faq-form': {
        const guildId = state.selectedGuildId;
        await runForm(form, async () => {
          const data = new FormData(form);
          const tags = String(data.get('tags') || '').split(',').map((tag) => tag.trim()).filter(Boolean);
          await api('/api/guilds/' + encodeURIComponent(guildId) + '/faq', {
            method: 'POST',
            body: {
              question: String(data.get('question') || ''),
              answer: String(data.get('answer') || ''),
              tags,
            },
          });
          showToast('FAQ entry added', 'success');
          await reloadContent();
        });
        break;
      }

      case 'guild-ann-form': {
        const guildId = state.selectedGuildId;
        await runForm(form, async () => {
          const data = new FormData(form);
          await api('/api/guilds/' + encodeURIComponent(guildId) + '/announcements', {
            method: 'POST',
            body: { title: String(data.get('title') || ''), content: String(data.get('content') || '') },
          });
          showToast('Announcement added', 'success');
          await reloadContent();
        });
        break;
      }

      case 'guild-scheduled-form': {
        const guildId = state.selectedGuildId;
        await runForm(form, async () => {
          const data = new FormData(form);
          const scheduledAt = String(data.get('scheduledAt') || '');
          if (!scheduledAt) throw new Error('Choose a date and time');
          await api('/api/guilds/' + encodeURIComponent(guildId) + '/scheduled', {
            method: 'POST',
            body: {
              channelId: String(data.get('channelId') || ''),
              content: String(data.get('content') || ''),
              scheduledAt: new Date(scheduledAt).toISOString(),
            },
          });
          showToast('Message scheduled', 'success');
          await reloadContent();
        });
        break;
      }

      case 'user-form':
        await runForm(form, () => saveUser(form));
        break;

      default:
        break;
    }
  } catch (error) {
    showToast(error.message || 'Request failed', 'error');
  }
});

document.addEventListener('input', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;

  if (target.matches('[data-range]')) {
    const name = target.dataset.range;
    const format = target.dataset.format || 'int';
    const value = Number(target.value);
    const output = document.querySelector('[data-range-value="' + name + '"]');
    if (output) output.textContent = rangeValue(value, format);
    const min = Number(target.min) || 0;
    const max = Number(target.max) || 100;
    const pct = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
    target.style.setProperty('--pct', pct + '%');
    return;
  }

  if (target.id === 'guild-filter') {
    state.guildFilter = target.value;
    renderGuildList();
    return;
  }

  if (target.id === 'memory-search') {
    state.guildData.memoryQuery = target.value;
    debounce('memory-search', () => {
      reloadMemories().catch((error) => showToast(error.message, 'error'));
    });
    return;
  }

  if (target.id === 'user-search') {
    debounce('user-search', async () => {
      state.userQuery = target.value.trim();
      state.userPage = 1;
      try {
        await loadUsers(state.renderToken);
        refreshUsersView();
      } catch (error) {
        showToast(error.message, 'error');
      }
    });
    return;
  }

  if (target.id === 'command-search') {
    state.commandQuery = target.value.trim();
    refreshCommandList();
  }
});

document.addEventListener('change', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;

  if (target.id === 'user-sort') {
    state.userSort = target.value;
    state.userPage = 1;
    loadUsers(state.renderToken).then(() => refreshUsersView()).catch((error) => showToast(error.message, 'error'));
    return;
  }

  if (target.id === 'user-order') {
    state.userOrder = target.value;
    state.userPage = 1;
    loadUsers(state.renderToken).then(() => refreshUsersView()).catch((error) => showToast(error.message, 'error'));
    return;
  }

  if (target.id === 'command-category') {
    state.commandCategory = target.value;
    refreshCommandList();
    return;
  }

  if (target.id === 'persona-guild-select') {
    updatePersonaGuild(target.value);
    return;
  }

  if (target.matches('input[name="channelIds"]')) {
    if (target.checked) state.personaSelectedChannels.add(target.value);
    else state.personaSelectedChannels.delete(target.value);
    renderPersonaChannelCount();
  }
});

document.addEventListener('click', (event) => {
  const trigger = event.target.closest('[data-action]');
  if (!trigger) return;
  const action = trigger.dataset.action;

  switch (action) {
    case 'logout':
      logout();
      break;

    case 'refresh':
      route();
      break;

    case 'guild-select':
      selectGuild(trigger.dataset.id);
      break;

    case 'guild-tab':
      setGuildTab(trigger.dataset.tab).catch((error) => showToast(error.message, 'error'));
      break;

    case 'delete-memory':
      deleteMemory(trigger.dataset.id);
      break;

    case 'clear-memories':
      clearMemories();
      break;

    case 'delete-faq':
      deleteContent('faq', trigger.dataset.id);
      break;

    case 'delete-announcement':
      deleteContent('announcements', trigger.dataset.id);
      break;

    case 'cancel-scheduled':
      deleteContent('scheduled', trigger.dataset.id);
      break;

    case 'delete-ticket-dept': {
      (async () => {
        const confirmed = await confirmAction(
          'Delete department',
          'Remove this ticket department? It cannot be used by panels anymore.',
          'Delete',
        );
        if (!confirmed) return;
        try {
          await api('/api/guilds/' + encodeURIComponent(state.selectedGuildId) + '/tickets/departments/' + encodeURIComponent(trigger.dataset.id), {
            method: 'DELETE',
          });
          showToast('Department deleted', 'success');
          state.guildData.tickets = null;
          await reloadTickets();
        } catch (error) {
          showToast(error.message, 'error');
        }
      })();
      break;
    }

    case 'edit-ticket-dept':
      openTicketDeptModal(trigger.dataset.id);
      break;

    case 'edit-user':
      openUserModal(trigger.dataset.id);
      break;

    case 'users-prev':
      usersPage(-1);
      break;

    case 'users-next':
      usersPage(1);
      break;

    case 'quick-toggle-persona':
      quickTogglePersona(trigger.dataset.enabled === 'true');
      break;

    case 'activity-kind':
      setActivityKind(trigger.dataset.kind);
      break;

    case 'activity-auto':
      toggleActivityAuto();
      break;

    case 'default-prompt':
      useDefaultPrompt();
      break;

    case 'reset-persona':
      resetPersona();
      break;

    case 'confirm-yes':
      resolveConfirm(true);
      break;

    case 'confirm-no':
      resolveConfirm(false);
      break;

    case 'modal-close':
      if (event.target === trigger || trigger.classList.contains('modal-close')) closeModal();
      break;

    default:
      break;
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && $('#modal-root')?.innerHTML) {
    closeModal();
  }
});

async function deleteContent(kind, id) {
  if (!state.selectedGuildId) return;
  const labels = {
    faq: ['Delete FAQ entry', 'Remove this FAQ entry?'],
    announcements: ['Delete announcement', 'Remove this announcement?'],
    scheduled: ['Cancel scheduled message', 'Cancel this scheduled message?'],
  };
  const [title, message] = labels[kind] || ['Delete', 'Delete this record?'];
  const confirmed = await confirmAction(title, message, 'Delete');
  if (!confirmed) return;

  const base = '/api/guilds/' + encodeURIComponent(state.selectedGuildId);
  const path = kind === 'faq' ? base + '/faq/' + encodeURIComponent(id)
    : kind === 'announcements' ? base + '/announcements/' + encodeURIComponent(id)
    : base + '/scheduled/' + encodeURIComponent(id);

  try {
    await api(path, { method: 'DELETE' });
    showToast('Deleted', 'success');
    await reloadContent();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function quickTogglePersona(enabled) {
  try {
    const result = await api('/api/config', { method: 'PUT', body: { enabled } });
    if (state.overview) state.overview.persona.enabled = result.config.enabled;
    showToast('Persona ' + (result.config.enabled ? 'enabled' : 'disabled'), 'success');
    route();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

window.addEventListener('hashchange', () => {
  if (state.authed) route();
});

/* --------------------------------------------------------------------------
   Boot
   -------------------------------------------------------------------------- */

async function boot() {
  try {
    const response = await fetch('/api/auth/session', { credentials: 'same-origin' });
    const session = await response.json();
    if (session.authenticated) {
      await enterApp();
    } else {
      showLogin('');
    }
  } catch {
    showLogin('Unable to reach the dashboard API. Is the bot running?');
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
