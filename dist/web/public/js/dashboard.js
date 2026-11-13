const API = '/api';

const PAGE_META = {
  dashboard: { title: 'Dashboard', subtitle: 'Live telemetry from your Discord community' },
  guilds: { title: 'Servers', subtitle: 'Every guild Sukuna is connected to' },
  moderation: { title: 'Moderation', subtitle: 'Warnings, kicks, bans and mutes' },
  economy: { title: 'Economy', subtitle: 'Balances, transactions and currency settings' },
  leveling: { title: 'Leveling', subtitle: 'Leaderboards, XP and rewards' },
  cards: { title: 'Cards', subtitle: 'Design welcome and rank cards' },
  tickets: { title: 'Tickets', subtitle: 'Support tickets, claims and closures' },
  giveaways: { title: 'Giveaways', subtitle: 'Escrow-funded giveaways and winners' },
  games: { title: 'Economy games', subtitle: 'Dice, coinflip and prize games' },
  staffapps: { title: 'Staff applications', subtitle: 'Review and approve applicants' },
  tempvc: { title: 'Temporary voice', subtitle: 'Live temporary voice channels' },
  community: { title: 'Community', subtitle: 'Welcome, goodbye and autoroles' },
  automation: { title: 'Automation', subtitle: 'Scheduled background jobs' },
  analytics: { title: 'Analytics', subtitle: 'Message tracking and the stats collector' },
  ai: { title: 'AI assistant', subtitle: 'Provider, limits and conversations' },
  music: { title: 'Music', subtitle: 'Lavalink node and playback queues' },
  analytics: { title: 'Analytics', subtitle: 'Activity, moderation and economy trends' },
  settings: { title: 'Settings', subtitle: 'Configure every module of the bot' },
  system: { title: 'System', subtitle: 'Runtime, process and host diagnostics' },
};

const SETTINGS_META = {
  overview: { title: 'Settings', subtitle: 'Configure every system of Sukuna in one place', label: 'Overview' },
  general: { title: 'Bot & modules', subtitle: 'Prefix, web port and module master switches', label: 'Bot & modules' },
  leveling: { title: 'Leveling', subtitle: 'XP curve, rewards, announcements and the staff track', label: 'Leveling' },
  economy: { title: 'Economy', subtitle: 'Currency, starting balance and defaults', label: 'Economy' },
  welcome: { title: 'Welcome & goodbye', subtitle: 'Join and leave messages and welcome cards', label: 'Welcome & goodbye' },
  ai: { title: 'AI assistant', subtitle: 'Model, prompt, channels and reply limits', label: 'AI assistant' },
  music: { title: 'Music', subtitle: 'Lavalink, volume and playback limits', label: 'Music' },
  tempvc: { title: 'Temporary voice', subtitle: 'Join-to-create channels and control panel', label: 'Temporary voice' },
  automation: { title: 'Automation', subtitle: 'Scheduled background jobs', label: 'Automation' },
  moderation: { title: 'Moderation', subtitle: 'Log channel and default reason', label: 'Moderation' },
  tickets: { title: 'Tickets', subtitle: 'Category and support roles', label: 'Tickets' },
  staffapps: { title: 'Staff applications', subtitle: 'Questions, roles and reviewers', label: 'Staff applications' },
  panels: { title: 'Panels & emoji', subtitle: 'Custom emoji, panel icons and canvas fonts', label: 'Panels & emoji' },
  advanced: { title: 'Danger zone', subtitle: 'Restart, shut down or clear logs', label: 'Danger zone' },
};

const app = {
  currentPage: 'dashboard',
  settingsSection: 'overview',
  intervalId: null,
  // caches for friendly pickers
  _guildCache: new Map(),
  _cards: null,
  _cardsPreviewTimers: {},
  _leveling: null,
  _community: null,
  _overview: null,

  init() {
    const [hashPage, hashSection] = (window.location.hash || '').replace('#', '').split('/');
    const initialPage = PAGE_META[hashPage] ? hashPage : 'dashboard';
    if (hashPage === 'settings' && SETTINGS_META[hashSection]) this.settingsSection = hashSection;

    this.setupNav();
    this.fetchStatus();
    this.fetchGuilds();
    this.loadOverview();
    this.startPolling();
    this.setupForms();
    this.setupColorPairs();
    this.setupCardEditors();
    this.loadMe();

    if (initialPage !== 'dashboard') this.openPage(initialPage, false);
    this.setActiveNav(initialPage);
    window.addEventListener('hashchange', () => {
      const [page, section] = (window.location.hash || '').replace('#', '').split('/');
      if (!PAGE_META[page]) return;
      if (page === 'settings' && SETTINGS_META[section] && section !== this.settingsSection) {
        this.openSettingsSection(section, false);
      }
      if (page !== this.currentPage) this.openPage(page, false);
    });

    // Close the mobile menu when growing to desktop width so it does not
    // reappear unexpectedly if the window is shrunk again.
    window.addEventListener('resize', () => {
      if (window.innerWidth >= 1025) this.toggleMobileNav(false);
    });

    // Pause polling in background tabs and refresh immediately on return.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.refreshCurrent(true);
    });

    document.getElementById('mobileNav')?.addEventListener('click', (event) => {
      if (event.target.id === 'mobileNav') this.toggleMobileNav(false);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.toggleMobileNav(false);
    });
  },

  setActiveNav(page) {
    document.querySelectorAll('.nav-btn[data-page]').forEach(btn => {
      const active = btn.getAttribute('data-page') === page;
      btn.classList.toggle('active', active);
      btn.classList.toggle('text-white', active);
      if (active) btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
    });
  },

  setupNav() {
    document.querySelectorAll('[data-page]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const page = e.currentTarget.getAttribute('data-page');
        if (page === 'settings') this.settingsSection = 'overview';
        this.openPage(page);
      });
    });

    document.querySelectorAll('[data-settings-section], [data-settings-open]').forEach(btn => {
      btn.addEventListener('click', () => {
        const section = btn.getAttribute('data-settings-section') || btn.getAttribute('data-settings-open');
        if (this.currentPage !== 'settings') this.openPage('settings', false);
        this.openSettingsSection(section);
      });
    });
  },

  toggleMobileNav(force) {
    const menu = document.getElementById('mobileNav');
    const toggle = document.getElementById('mobileNavToggle');
    if (!menu) return;

    const shouldOpen = typeof force === 'boolean'
      ? force
      : menu.classList.contains('hidden');

    menu.classList.toggle('hidden', !shouldOpen);
    if (toggle) toggle.setAttribute('aria-expanded', String(shouldOpen));
  },

  openPage(page, updateHash = true) {
    if (!PAGE_META[page]) return;
    const ownerOnly = ['settings', 'cards', 'system'];
    if (this._me && !this._me.user?.isOwner && ownerOnly.includes(page)) {
      this.showAlert('That area is restricted to the bot owner.', 'error');
      page = 'dashboard';
    }
    this.currentPage = page;

    document.querySelectorAll('.page').forEach(el => el.classList.remove('active'));
    this.setActiveNav(page);

    // On phones the navigation is a collapsible menu; close it after choosing
    // a page so the content is visible immediately.
    this.toggleMobileNav(false);

    const target = document.getElementById(`page-${page}`);
    if (target) target.classList.add('active');

    if (page === 'settings') {
      this.applySettingsSectionMeta(this.settingsSection);
    } else {
      const meta = PAGE_META[page];
      const title = document.getElementById('pageTitle');
      const subtitle = document.getElementById('pageSubtitle');
      if (title) title.textContent = meta.title;
      if (subtitle) subtitle.textContent = meta.subtitle;
      document.title = `Sukuna Bot — ${meta.title}`;
    }

    if (updateHash) {
      const hash = page === 'settings' ? `#settings/${this.settingsSection || 'overview'}` : `#${page}`;
      if (window.location.hash !== hash) {
        history.replaceState(null, '', hash);
      }
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });

    if (page === 'dashboard') this.loadOverview();
    if (page === 'guilds') this.fetchGuilds();
    if (page === 'moderation') this.loadModeration();
    if (page === 'economy') this.loadEconomy();
    if (page === 'leveling') this.loadLeveling();
    if (page === 'cards') this.loadCardsConfig();
    if (page === 'system') this.fetchSystemInfo();
    if (page === 'tickets') this.loadTickets();
    if (page === 'giveaways') this.loadGiveaways();
    if (page === 'games') this.loadGames();
    if (page === 'staffapps') this.loadStaffApps();
    if (page === 'tempvc') this.loadTempVC();
    if (page === 'community') this.loadCommunity();
    if (page === 'automation') this.loadAutomation();
    if (page === 'ai') this.loadAI();
    if (page === 'music') this.loadMusic();
    if (page === 'analytics') this.loadAnalytics();
    if (page === 'settings') {
      this.openSettingsSection(this.settingsSection || 'overview', false);
      this.loadSettings();
    }
  },

  applySettingsSectionMeta(section) {
    const meta = SETTINGS_META[section] || SETTINGS_META.overview;
    const title = document.getElementById('pageTitle');
    const subtitle = document.getElementById('pageSubtitle');
    if (title) title.textContent = section === 'overview' ? 'Settings' : `Settings · ${meta.label}`;
    if (subtitle) subtitle.textContent = meta.subtitle;
    document.title = `Sukuna Bot — Settings · ${meta.label}`;
  },

  openSettingsSection(section = 'overview', updateHash = true) {
    const id = SETTINGS_META[section] ? section : 'overview';
    this.settingsSection = id;

    document.querySelectorAll('[data-settings-pane]').forEach(el => {
      el.classList.toggle('active', el.getAttribute('data-settings-pane') === id);
    });
    document.querySelectorAll('.settings-nav-btn[data-settings-section]').forEach(btn => {
      const active = btn.getAttribute('data-settings-section') === id;
      btn.classList.toggle('active', active);
      if (active) btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
    });
    this.applySettingsSectionMeta(id);
    this.refreshSettingsOverview();

    if (updateHash && this.currentPage === 'settings') {
      const hash = `#settings/${id}`;
      if (window.location.hash !== hash) history.replaceState(null, '', hash);
    }

    const body = document.querySelector('.settings-body');
    if (body && window.innerWidth <= 860) body.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },

  refreshSettingsOverview() {
    const states = {
      leveling: 'toggleLeveling',
      economy: 'toggleEconomy',
      welcome: 'wel_enabled',
      ai: 'toggleAI',
      music: 'toggleMusic',
      tempvc: 'tvc_enabled',
      automation: 'auto_enabled',
      analytics: 'ana_enabled',
      moderation: 'mod_enabled',
      tickets: 'tix_enabled',
      staffapps: 'sapp_enabled',
    };
    for (const [section, inputId] of Object.entries(states)) {
      const input = document.getElementById(inputId);
      const on = !!input && input.checked;
      document.querySelectorAll(`[data-overview-state="${section}"]`).forEach(el => {
        el.textContent = on ? 'On' : 'Off';
        el.classList.toggle('on', on);
        el.classList.toggle('off', !on);
        if (el.classList.contains('badge')) {
          el.classList.remove('badge-neutral', 'badge-success');
          el.classList.add(on ? 'badge-success' : 'badge-neutral');
        }
      });
    }
  },

  async request(endpoint, options = {}) {
    try {
      const res = await fetch(`${API}${endpoint}`, {
        ...options,
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
        credentials: 'same-origin',
      });
      if (res.status === 401) {
        window.location.href = '/auth/login';
        throw new Error('Your session expired — redirecting to Discord sign-in.');
      }
      if (!res.ok) {
        let message = `HTTP ${res.status}`;
        try {
          const body = await res.json();
          message = body?.message || body?.error || message;
        } catch { /* response was not JSON */ }
        throw new Error(message);
      }
      return await res.json();
    } catch (err) {
      console.error('API error:', err);
      throw err;
    }
  },

  async loadMe() {
    try {
      const me = await this.request('/auth/me');
      this._me = me;
      const chip = document.getElementById('userChip');
      const avatar = document.getElementById('userAvatar');
      const name = document.getElementById('userName');
      const role = document.getElementById('userRole');
      if (chip) chip.style.display = 'flex';
      if (name) name.textContent = me?.user?.displayName || me?.user?.username || 'Signed in';
      if (role) role.textContent = me?.user?.isOwner ? 'Bot owner' : 'Server admin';
      if (avatar) {
        const url = me?.user?.avatar
          ? `https://cdn.discordapp.com/avatars/${me.user.id}/${me.user.avatar}.png?size=64`
          : '';
        if (url) { avatar.src = url; avatar.style.display = 'grid'; } else { avatar.style.display = 'none'; }
      }
      if (!me?.user?.isOwner) {
        document.querySelectorAll('.nav-btn[data-page="settings"], .nav-btn[data-page="cards"], .nav-btn[data-page="system"]')
          .forEach((btn) => { btn.style.display = 'none'; });
      }
    } catch (err) {
      this._me = null;
    }
  },

  async logout() {
    try {
      await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' });
    } catch { /* ignore — we are leaving anyway */ }
    window.location.href = '/login';
  },

  async requestBlob(endpoint, options = {}) {
    const res = await fetch(`${API}${endpoint}`, {
      headers: { 'Content-Type': 'application/json', ...options.headers },
      ...options,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.blob();
  },

  showAlert(message, type = 'error') {
    const container = document.getElementById('alertContainer');
    if (!container) return;
    // Keep the stack short so notifications never cover the UI.
    while (container.children.length >= 4) container.firstElementChild?.remove();

    const div = document.createElement('div');
    div.className = `alert alert-${type}`;
    div.setAttribute('role', type === 'error' ? 'alert' : 'status');
    div.textContent = message;
    div.addEventListener('click', () => div.remove());
    container.appendChild(div);
    setTimeout(() => div.remove(), 5200);
  },

  // ---------- Formatting helpers ----------
  escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  formatNumber(value) {
    const n = Number(value ?? 0);
    if (!Number.isFinite(n)) return '0';
    return n.toLocaleString('en-US', { maximumFractionDigits: 1 });
  },

  compactNumber(value) {
    const n = Number(value ?? 0);
    if (!Number.isFinite(n)) return '0';
    return Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
  },

  avatarUrl(userId, hash, size = 64) {
    if (!userId || !hash) return '';
    return `https://cdn.discordapp.com/avatars/${userId}/${hash}.png?size=${size}`;
  },

  iconUrl(guildId, hash, size = 64) {
    if (!guildId || !hash) return '';
    return `https://cdn.discordapp.com/icons/${guildId}/${hash}.png?size=${size}`;
  },

  timeAgo(iso) {
    if (!iso) return '—';
    const then = new Date(iso).getTime();
    if (!Number.isFinite(then)) return '—';
    const diff = Math.max(0, Date.now() - then);
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(iso).toLocaleDateString();
  },

  sparkPath(values, width = 100, height = 34, pad = 2) {
    const nums = (values || []).map(v => Number(v) || 0);
    while (nums.length < 2) nums.push(0);
    const max = Math.max(...nums, 1);
    const min = Math.min(...nums, 0);
    const span = Math.max(max - min, 1);
    const step = (width - pad * 2) / Math.max(nums.length - 1, 1);
    const points = nums.map((v, i) => {
      const x = pad + i * step;
      const y = height - pad - ((v - min) / span) * (height - pad * 2);
      return [Number(x.toFixed(2)), Number(y.toFixed(2))];
    });
    const line = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x} ${y}`).join(' ');
    const area = `${line} L${width - pad} ${height} L${pad} ${height} Z`;
    return { line, area };
  },

  // ---------- Guild / channel / role pickers (no raw IDs) ----------
  selectedGuildId() {
    const settings = document.getElementById('settingsGuildSelect')?.value;
    const lvl = document.getElementById('lvlGuildSelect')?.value;
    const mod = document.getElementById('modGuildSelect')?.value;
    return settings || lvl || mod || '';
  },

  async fetchGuildChannels(guildId) {
    if (!guildId) return [];
    if (this._guildCache.has(guildId)) return this._guildCache.get(guildId);
    try {
      const guild = await this.request(`/guilds/${guildId}`);
      const channels = guild.channels ?? [];
      const roles = guild.roles ?? [];
      const entry = { channels, roles, name: guild.name };
      this._guildCache.set(guildId, entry);
      return entry;
    } catch (err) {
      return { channels: [], roles: [] };
    }
  },

  async refreshChannelPickers() {
    // Use the first guild the bot is in if no picker has a selection yet.
    let guildId = this.selectedGuildId();
    if (!guildId) {
      try {
        const guilds = await this.request('/guilds');
        if (guilds && guilds.length) guildId = guilds[0].id;
      } catch { /* ignore */ }
    }
    if (!guildId) {
      this.showAlert('Pick a server in the Leveling or Moderation page first, so channels/roles can load.', 'info');
      return;
    }
    const data = await this.fetchGuildChannels(guildId);
    this.populateChannelSelects(data.channels || []);
    this.populateChecklists(data.channels || []);
    this.populateAiPicker(data.channels || []);
    this.populateRoleSelects(data.roles || []);
    // re-render leveling editors with fresh channel/role names
    if (this._leveling) this.fillLeveling(this._leveling, data.channels || [], data.roles || []);
    this.showAlert(`Loaded ${data.channels?.length ?? 0} channels and ${data.roles?.length ?? 0} roles`, 'success');
  },

  populateChannelSelects(channels) {
    const selects = {
      mod_logChannelId: 'No log channel',
      tvc_createChannelId: 'Select…',
      tvc_categoryId: 'Select…',
      tvc_panelChannelId: 'Select…',
      wel_channel: 'No channel',
      bye_channel: 'No channel',
      tix_category: 'No category (root)',
      sapp_panelChannel: 'No panel',
      sapp_reviewChannel: 'Same as panel',
    };
    for (const [id, emptyLabel] of Object.entries(selects)) {
      const sel = document.getElementById(id);
      if (!sel) continue;
      const saved = sel.value;
      sel.innerHTML = `<option value="">${emptyLabel}</option>`;
      channels.forEach(c => {
        if (c.type === 4) return; // skip categories in most selects (category select handled separately below)
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = `# ${c.name}`;
        sel.appendChild(opt);
      });
      if (saved) sel.value = saved;
    }
    // Category picker for TempVC should include categories
    const catSel = document.getElementById('tvc_categoryId');
    if (catSel) {
      const saved = catSel.value;
      catSel.innerHTML = '<option value="">Select…</option>';
      channels.filter(c => c.type === 4).forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = `📁 ${c.name}`;
        catSel.appendChild(opt);
      });
      if (saved) catSel.value = saved;
    }
    // Ticket category: categories only
    const tixCatSel = document.getElementById('tix_category');
    if (tixCatSel) {
      const saved = tixCatSel.value;
      tixCatSel.innerHTML = '<option value="">No category (root)</option>';
      channels.filter(c => c.type === 4).forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = `📁 ${c.name}`;
        tixCatSel.appendChild(opt);
      });
      if (saved) tixCatSel.value = saved;
    }
    // Voice create channel: voice channels only (type 2)
    const createSel = document.getElementById('tvc_createChannelId');
    if (createSel) {
      const saved = createSel.value;
      createSel.innerHTML = '<option value="">Select…</option>';
      channels.filter(c => c.type === 2 || c.type === 0).forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = `${c.type === 2 ? '🔊' : '#'} ${c.name}`;
        createSel.appendChild(opt);
      });
      if (saved) createSel.value = saved;
    }
  },

  populateRoleSelects(roles) {
    // Roles for level roles / announcements / multipliers are in dynamic rows,
    // so just cache them for row rendering.
    this._cachedRoles = roles || [];
    this.populateStaffRolesChecklist(roles || [], this._pendingStaffRoles || this._leveling?.staffRoleIds || []);
    // Tickets + staff applications role pickers
    this.renderRoleChecklist('tix_supportRolesUI', roles || [], this._pendingTicketRoles || this._tickets?.supportRoles || [], (ids) => { this._pendingTicketRoles = ids; });
    this.renderRoleChecklist('sapp_staffRolesUI', roles || [], this._pendingAppRoles || this._staffapps?.staffRoles || [], (ids) => { this._pendingAppRoles = ids; });
    this.renderRoleChecklist('sapp_approverRolesUI', roles || [], this._pendingApproverRoles || this._staffapps?.approverRoleIds || [], (ids) => { this._pendingApproverRoles = ids; });
  },

  renderRoleChecklist(containerId, roles, selected, onChange) {
    const wrap = document.getElementById(containerId);
    if (!wrap) return;
    if (!roles?.length) {
      wrap.innerHTML = '<span class="hint">No roles loaded yet. Pick a server in Leveling/Moderation, then refresh.</span>';
      return;
    }
    const selectedSet = new Set(selected || []);
    wrap.innerHTML = '';
    const search = document.createElement('input');
    search.type = 'text';
    search.className = 'input-field mb-2';
    search.placeholder = 'Search roles…';
    wrap.appendChild(search);
    const list = document.createElement('div');
    list.className = 'flex flex-col gap-0.5';
    wrap.appendChild(list);
    const draw = (filter = '') => {
      list.innerHTML = '';
      roles.filter(r => !filter || r.name.toLowerCase().includes(filter.toLowerCase())).forEach(r => {
        if (r.id === r.guildId) return;
        const label = document.createElement('label');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = selectedSet.has(r.id);
        cb.onchange = () => {
          if (cb.checked) selectedSet.add(r.id); else selectedSet.delete(r.id);
          onChange([...selectedSet]);
        };
        const span = document.createElement('span');
        span.textContent = r.name;
        span.className = 'flex-1';
        const dot = document.createElement('span');
        dot.className = 'w-3 h-3 rounded-full inline-block';
        dot.style.background = '#' + (r.color ? (r.color >>> 0).toString(16).padStart(6, '0') : '888888');
        label.appendChild(cb);
        label.appendChild(dot);
        label.appendChild(span);
        list.appendChild(label);
      });
      if (!list.children.length) list.innerHTML = '<span class="hint">No matching roles.</span>';
    };
    search.oninput = () => draw(search.value);
    draw();
  },

  populateChecklists(channels) {
    const textChannels = channels.filter(c => c.type !== 4 && c.type !== 2);
    // No-XP + whitelist use the current leveling values if loaded
    const lvl = this._leveling || {};
    this.renderChannelChecklist('lvl_noXpChannelsUI', textChannels, lvl.noXpChannels || [], (ids) => {
      this._pendingNoXp = ids;
    });
    this.renderChannelChecklist('lvl_xpWhitelistUI', textChannels, lvl.xpChannelWhitelist || [], (ids) => {
      this._pendingWhitelist = ids;
    });
  },

  renderChannelChecklist(containerId, channels, selected, onChange) {
    const wrap = document.getElementById(containerId);
    if (!wrap) return;
    if (!channels.length) {
      wrap.innerHTML = '<span class="hint">No channels found. Select a server first.</span>';
      return;
    }
    const selectedSet = new Set(selected || []);
    wrap.innerHTML = '';
    // Search box
    const search = document.createElement('input');
    search.type = 'text';
    search.className = 'input-field mb-2';
    search.placeholder = 'Search channels…';
    wrap.appendChild(search);
    const list = document.createElement('div');
    list.className = 'flex flex-col gap-0.5';
    wrap.appendChild(list);
    const draw = (filter = '') => {
      list.innerHTML = '';
      channels
        .filter(c => !filter || c.name.toLowerCase().includes(filter.toLowerCase()))
        .forEach(c => {
          const label = document.createElement('label');
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.checked = selectedSet.has(c.id);
          cb.onchange = () => {
            if (cb.checked) selectedSet.add(c.id); else selectedSet.delete(c.id);
            onChange([...selectedSet]);
          };
          const span = document.createElement('span');
          span.textContent = `# ${c.name}`;
          span.className = 'flex-1';
          const count = document.createElement('span');
          count.className = 'text-xs text-slate-500 font-mono';
          count.textContent = c.id.slice(-6);
          label.appendChild(cb);
          label.appendChild(span);
          label.appendChild(count);
          list.appendChild(label);
        });
      if (!list.children.length) list.innerHTML = '<span class="hint">No matching channels.</span>';
    };
    search.oninput = () => draw(search.value);
    draw();
  },

  clearChannelSelection(which) {
    if (which === 'noXp') this._pendingNoXp = [];
    if (which === 'whitelist') this._pendingWhitelist = [];
    this.refreshChannelPickers();
  },

  populateAiPicker(channels) {
    const wrap = document.getElementById('ai_channelPickerUI');
    if (!wrap) return;
    const textChannels = channels.filter(c => c.type !== 4 && c.type !== 2);
    const selected = new Set(this.listText('ai_channelIds'));
    this.renderChannelChecklist('ai_channelPickerUI', textChannels, [...selected], (ids) => {
      this._pendingAiChannels = ids;
    });
  },

  syncAiChannelPicker() {
    if (this._pendingAiChannels) {
      this.setVal('ai_channelIds', this._pendingAiChannels.join(', '));
      this.showAlert('AI channels applied from picker', 'success');
    } else {
      this.showAlert('No picker selection to apply. Tick channels first.', 'info');
    }
  },

  // ---------- Color pickers ----------
  setupColorPairs() {
    const pairs = [
      ['lvl_defaultColor', 'lvl_defaultColorPicker'],
      ['card_welcome_bgStart', 'card_welcome_bgStartPicker'],
      ['card_welcome_bgEnd', 'card_welcome_bgEndPicker'],
      ['card_welcome_accent', 'card_welcome_accentPicker'],
      ['card_welcome_accent2', 'card_welcome_accent2Picker'],
      ['card_rank_bgStart', 'card_rank_bgStartPicker'],
      ['card_rank_bgEnd', 'card_rank_bgEndPicker'],
      ['card_rank_accent', 'card_rank_accentPicker'],
      ['card_rank_accent2', 'card_rank_accent2Picker'],
      ['card_rank_rank', 'card_rank_rankPicker'],
      ['card_rank_level', 'card_rank_levelPicker'],
    ];
    for (const [textId, pickerId] of pairs) {
      const text = document.getElementById(textId);
      const picker = document.getElementById(pickerId);
      if (!text || !picker) continue;
      picker.addEventListener('input', () => { text.value = picker.value; this.onCardInput(); });
      text.addEventListener('input', () => {
        const v = text.value.trim();
        if (/^#[0-9a-fA-F]{6}$/.test(v)) picker.value = v;
        this.onCardInput();
      });
    }
  },

  setColorPair(textId, pickerId, value) {
    if (!value) return;
    this.setVal(textId, value);
    const picker = document.getElementById(pickerId);
    if (picker && /^#[0-9a-fA-F]{6}$/.test(value)) picker.value = value;
  },

  // ---------- Placeholder helper ----------
  insertPlaceholder(inputId, token) {
    const el = document.getElementById(inputId);
    if (!el) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    el.value = el.value.slice(0, start) + token + el.value.slice(end);
    el.focus();
    el.selectionStart = el.selectionEnd = start + token.length;
  },

  async fetchStatus() {
    try {
      const data = await this.request('/status');
      this.applyStatus(data);
    } catch (err) {
      console.error('Failed to fetch status:', err);
      this.applyStatus({ ready: false, online: false, guilds: 0, users: 0, ping: 0, uptime: 0 });
    }
  },

  applyStatus(data) {
    const online = !!(data.ready || data.online);
    const label = data.ready ? 'Operational' : online ? 'Starting…' : 'Offline';

    const navStatus = document.getElementById('navStatus');
    if (navStatus) {
      navStatus.textContent = label;
      navStatus.style.color = online ? '#6ee7b7' : '#fca5a5';
    }
    const statusDot = document.getElementById('statusDot');
    if (statusDot) statusDot.classList.toggle('offline', !online);
    const sideDot = document.getElementById('sideDot');
    if (sideDot) sideDot.classList.toggle('offline', !online);
    const sideGateway = document.getElementById('sideGateway');
    if (sideGateway) sideGateway.textContent = online ? 'Online' : 'Offline';

    const gateway = document.getElementById('heroGateway');
    if (gateway) gateway.textContent = data.ready ? 'Connected' : online ? 'Connecting…' : 'Disconnected';
    const gatewaySub = document.getElementById('heroGatewaySub');
    if (gatewaySub) gatewaySub.textContent = data.user ? data.user : online ? 'Discord gateway not ready' : 'Not connected to Discord';
    const orb = document.getElementById('heroOrb');
    if (orb) {
      orb.textContent = online ? '✓' : '!';
      orb.classList.toggle('offline', !online);
    }

    const set = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    };
    set('statGuilds', this.formatNumber(data.guilds ?? 0));
    set('statUsers', this.formatNumber(data.users ?? 0));
    set('sideGuilds', this.formatNumber(data.guilds ?? 0));
    set('statPing', data.ping ? `${Math.round(data.ping)}ms` : '—');
    set('statUptime', this.formatUptime(data.uptime ?? 0));
    set('healthPing', data.ping ? `${Math.round(data.ping)}ms` : '—');

    const pingBar = document.getElementById('healthPingBar');
    if (pingBar) pingBar.style.width = `${Math.max(4, Math.min(100, 100 - Math.min(Number(data.ping) || 0, 500) / 5))}%`;

    if (data.memory) {
      const heap = Number(data.memory.heapUsed ?? 0) / 1024 / 1024;
      const total = Number(data.memory.heapTotal ?? 0) / 1024 / 1024;
      set('statMemory', `${heap.toFixed(1)} MB`);
      set('healthHeap', `${heap.toFixed(1)} / ${total.toFixed(1)} MB`);
      const heapBar = document.getElementById('healthHeapBar');
      if (heapBar) heapBar.style.width = `${Math.max(3, Math.min(100, total ? (heap / total) * 100 : 0))}%`;
    }

    set('healthNode', data.nodeVersion ?? '—');
    set('healthEnv', (data.env ?? 'development').replace(/^\w/, c => c.toUpperCase()));
    set('healthChannels', this.formatNumber(data.channels ?? 0));
    const channelBar = document.getElementById('healthChannelsBar');
    if (channelBar) channelBar.style.width = `${Math.max(3, Math.min(100, ((Number(data.channels) || 0) / 500) * 100))}%`;
  },

  async fetchStats() {
    // Kept for backwards compatibility; the overview request supersedes it.
    return this.loadOverview();
  },

  async loadOverview() {
    try {
      const data = await this.request('/overview');
      this._overview = data;
      this.renderOverview(data);
    } catch (err) {
      console.error('Failed to load overview:', err);
      this.renderOverview(null);
    }
    this.loadSystemTiles();
  },

  renderOverview(data) {
    if (!data) {
      ['topServersList', 'topMembersList', 'recentCasesList'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = '<div class="empty-state">Unable to load data — check the bot logs.</div>';
      });
      return;
    }

    const { status = {}, stats = {}, economy = {}, activity = {}, logs = {} } = data;
    this.applyStatus(status);

    const members = Number(status.members ?? 0);
    const days = activity.days ?? [];
    const totals = days.reduce((acc, d) => {
      acc.messages += Number(d.messages ?? 0);
      acc.moderation += Number(d.moderation ?? 0);
      acc.users += Number(d.users ?? 0);
      return acc;
    }, { messages: 0, moderation: 0, users: 0 });

    const setText = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    };
    setText('statGuilds', this.formatNumber(status.guilds ?? stats.totalGuilds ?? 0));
    setText('statMembers', this.compactNumber(members));
    setText('statMessages', this.compactNumber(stats.totalMessages ?? 0));
    setText('statCases', this.compactNumber(stats.totalModerationCases ?? 0));
    setText('sideGuilds', this.formatNumber(status.guilds ?? stats.totalGuilds ?? 0));
    setText('sideMembers', this.compactNumber(members));
    setText('legendMessages', this.formatNumber(totals.messages));
    setText('legendModeration', this.formatNumber(totals.moderation));
    setText('legendUsers', this.formatNumber(totals.users));

    const trendEl = document.getElementById('kpiMembersTrend');
    if (trendEl) {
      trendEl.textContent = `${totals.users ? '+' : ''}${this.formatNumber(totals.users)} / 7d`;
      trendEl.classList.toggle('neutral', totals.users === 0);
    }
    const messagesTrend = document.getElementById('kpiMessagesTrend');
    if (messagesTrend) messagesTrend.textContent = totals.messages ? `${this.formatNumber(totals.messages)} / 7d` : 'Recorded';
    const casesTrend = document.getElementById('kpiCasesTrend');
    if (casesTrend) casesTrend.textContent = totals.moderation ? `${this.formatNumber(totals.moderation)} / 7d` : 'All time';

    const heroSub = document.getElementById('heroSubtitle');
    if (heroSub) {
      heroSub.textContent = status.ready
        ? `${this.formatNumber(status.guilds ?? 0)} servers · ${this.formatNumber(members)} members · ${this.formatNumber(economy.fundedUsers ?? 0)} funded wallets`
        : 'Discord gateway is offline. The dashboard will reconnect automatically.';
    }
    const heroDate = document.getElementById('heroDate');
    if (heroDate) {
      heroDate.textContent = new Date().toLocaleDateString('en-US', {
        weekday: 'long', month: 'short', day: 'numeric',
      });
    }

    // Sparklines reuse the 7-day series so every card tells a story.
    const spark = (id, series) => {
      const svg = document.getElementById(id);
      if (!svg) return;
      const { line, area } = this.sparkPath(series);
      const paths = svg.querySelectorAll('path');
      if (paths[0]) paths[0].setAttribute('d', area);
      if (paths[1]) paths[1].setAttribute('d', line);
    };
    spark('sparkServers', days.map(d => d.users ?? 0));
    spark('sparkMembers', days.map(d => d.users ?? 0));
    spark('sparkMessages', days.map(d => d.messages ?? 0));
    spark('sparkCases', days.map(d => d.moderation ?? 0));

    this.renderActivityChart(days);
    this.renderTopServers(data.topServers ?? []);
    this.renderTopMembers(data.topMembers ?? []);
    this.renderRecentCases(data.recentCases ?? []);

    const healthBadge = document.getElementById('healthBadge');
    if (healthBadge) {
      const issues = Number(logs.errors ?? 0);
      healthBadge.textContent = issues ? `${issues} error${issues === 1 ? '' : 's'}` : 'Stable';
      healthBadge.className = `badge ${issues ? 'badge-danger' : 'badge-success'}`;
    }
  },

  renderActivityChart(days) {
    const svg = document.getElementById('activityChart');
    if (!svg) return;
    if (!days.length) {
      svg.innerHTML = '';
      return;
    }

    const W = 720, H = 238;
    const pad = { top: 16, right: 12, bottom: 28, left: 34 };
    const innerW = W - pad.left - pad.right;
    const innerH = H - pad.top - pad.bottom;
    const series = [
      { key: 'messages', color: '#34d399' },
      { key: 'moderation', color: '#ef4444' },
      { key: 'users', color: '#60a5fa' },
    ];
    const max = Math.max(1, ...days.flatMap(d => series.map(s => Number(d[s.key] ?? 0))));
    const hasData = days.some(d => series.some(s => Number(d[s.key] ?? 0) > 0));
    const yTicks = 4;
    const groupW = innerW / days.length;
    const barW = Math.min(16, (groupW - 10) / series.length);

    let markup = '<g class="chart-grid">';
    for (let i = 0; i <= yTicks; i++) {
      const y = pad.top + (innerH / yTicks) * i;
      const value = Math.round(max - (max / yTicks) * i);
      markup += `<line x1="${pad.left}" y1="${y}" x2="${W - pad.right}" y2="${y}"></line>`;
      markup += `<text class="chart-axis" x="${pad.left - 8}" y="${y + 3}" text-anchor="end">${this.compactNumber(value)}</text>`;
    }
    markup += '</g>';

    days.forEach((day, dayIndex) => {
      const groupX = pad.left + groupW * dayIndex;
      series.forEach((s, seriesIndex) => {
        const value = Number(day[s.key] ?? 0);
        const height = Math.max(value > 0 ? 3 : 0, (value / max) * innerH);
        const x = groupX + (groupW - barW * series.length) / 2 + seriesIndex * barW;
        const y = pad.top + innerH - height;
        markup += `<rect class="chart-bar" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(barW - 2).toFixed(1)}" height="${height.toFixed(1)}" rx="2.5" fill="${s.color}" opacity="0.88"><title>${this.escapeHtml(day.label)}: ${this.formatNumber(value)}</title></rect>`;
      });
      markup += `<text class="chart-axis" x="${(groupX + groupW / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle">${this.escapeHtml(day.label)}</text>`;
    });

    if (!hasData) {
      markup += `<text class="chart-axis" x="${W / 2}" y="${H / 2 - 4}" text-anchor="middle" style="font-size:12px;fill:#64748b">No activity recorded yet</text>`;
      markup += `<text class="chart-axis" x="${W / 2}" y="${H / 2 + 12}" text-anchor="middle" style="font-size:10px;fill:#475569">Messages and moderation will appear here as they happen</text>`;
    }

    svg.innerHTML = markup;
  },

  renderTopServers(servers) {
    const container = document.getElementById('topServersList');
    if (!container) return;
    if (!servers.length) {
      container.innerHTML = '<div class="empty-state">No servers connected yet.</div>';
      return;
    }
    container.innerHTML = servers.map((server, index) => {
      const icon = this.iconUrl(server.id, server.icon, 64);
      const initials = this.escapeHtml((server.name || '?').slice(0, 2));
      return `
        <div class="list-row">
          <span class="rank-badge ${index === 0 ? 'gold' : index === 1 ? 'silver' : index === 2 ? 'bronze' : ''}">${index + 1}</span>
          <span class="avatar">${icon ? `<img src="${icon}" alt="" loading="lazy">` : initials}</span>
          <span class="list-main">
            <strong>${this.escapeHtml(server.name || 'Unknown server')}</strong>
            <span>${server.memberCount ? `${this.formatNumber(server.memberCount)} members` : 'Members hidden'}</span>
          </span>
          <button class="btn-ghost" onclick="app.viewGuild('${this.escapeHtml(server.id)}')">View</button>
        </div>`;
    }).join('');
  },

  renderTopMembers(members) {
    const container = document.getElementById('topMembersList');
    if (!container) return;
    if (!members.length) {
      container.innerHTML = '<div class="empty-state">No XP recorded yet — members appear after chatting.</div>';
      return;
    }
    container.innerHTML = members.map((member, index) => {
      const avatar = this.avatarUrl(member.id, member.avatar, 64);
      const initials = this.escapeHtml((member.username || '?').slice(0, 2));
      return `
        <div class="list-row">
          <span class="rank-badge ${index === 0 ? 'gold' : index === 1 ? 'silver' : index === 2 ? 'bronze' : ''}">${index + 1}</span>
          <span class="avatar round">${avatar ? `<img src="${avatar}" alt="" loading="lazy">` : initials}</span>
          <span class="list-main">
            <strong>${this.escapeHtml(member.username)}</strong>
            <span>Level ${this.formatNumber(member.level)} · ${this.formatNumber(member.totalXp)} XP</span>
          </span>
          <span class="list-meta">${this.compactNumber(member.balance)}<small>${this.escapeHtml(this._overview?.economy?.currency || 'coins')}</small></span>
        </div>`;
    }).join('');
  },

  renderRecentCases(cases) {
    const container = document.getElementById('recentCasesList');
    if (!container) return;
    if (!cases.length) {
      container.innerHTML = '<div class="empty-state">No moderation cases. A quiet server is a good server.</div>';
      return;
    }
    const badgeClass = (type) => type === 'ban' || type === 'kick' ? 'badge-danger' : type === 'warn' ? 'badge-warning' : 'badge-info';
    container.innerHTML = cases.map(item => `
      <div class="list-row">
        <span class="avatar sm round">${this.escapeHtml((item.username || '?').slice(0, 2))}</span>
        <span class="list-main">
          <strong>${this.escapeHtml(item.username)}</strong>
          <span title="${this.escapeHtml(item.reason)}">${this.escapeHtml(item.reason)}</span>
        </span>
        <span class="list-meta">
          <span class="badge ${badgeClass(item.type)}">${this.escapeHtml(item.type)}</span>
          <small>${this.escapeHtml(this.timeAgo(item.createdAt))}</small>
        </span>
      </div>`).join('');
  },

  formatUptime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${h}h ${m}m ${s}s`;
  },

  async fetchGuilds() {
    try {
      const guilds = await this.request('/guilds');
      const tbody = document.getElementById('guildsTableBody');
      tbody.innerHTML = '';

      if (!guilds || guilds.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="p-8 text-center text-slate-500">No guilds found</td></tr>';
        return;
      }

      guilds.forEach(g => {
        const tr = document.createElement('tr');
        const icon = this.iconUrl(g.id, g.icon, 64);
        const initials = this.escapeHtml((g.name || '?').slice(0, 2));
        tr.innerHTML = `
          <td>
            <div class="flex items-center gap-3">
              <span class="avatar" style="width:2.4rem;height:2.4rem">${icon ? `<img src="${icon}" alt="" loading="lazy">` : initials}</span>
              <div class="min-w-0">
                <div class="font-medium text-slate-200 truncate">${this.escapeHtml(g.name || 'Unknown Server')}</div>
                <div class="text-xs text-slate-500 font-mono">${this.escapeHtml(g.id)}</div>
              </div>
            </div>
          </td>
          <td class="text-center font-mono">${this.formatNumber(g.memberCount ?? 0)}</td>
          <td class="text-center font-mono text-xs text-slate-400">${this.escapeHtml(g.ownerId ?? '—')}</td>
          <td class="text-center"><span class="badge badge-info">Tier ${this.escapeHtml(g.preferredTier ?? 0)}</span></td>
          <td class="text-right">
            <button onclick="app.viewGuild('${this.escapeHtml(g.id)}')" class="btn-ghost text-xs">Details →</button>
          </td>
        `;
        tbody.appendChild(tr);
      });

      // Populate guild selects
      const selects = ['modGuildSelect', 'lvlGuildSelect', 'settingsGuildSelect'];
      selects.forEach(id => {
        const sel = document.getElementById(id);
        if (!sel) return;
        const saved = sel.value;
        sel.innerHTML = id === 'settingsGuildSelect'
          ? '<option value="">Auto (first server)</option>'
          : '<option value="">Select a server</option>';
        guilds.forEach(g => {
          const opt = document.createElement('option');
          opt.value = g.id;
          opt.textContent = g.name;
          sel.appendChild(opt);
        });
        sel.value = saved;
      });
      const settingsGuild = document.getElementById('settingsGuildSelect');
      if (settingsGuild && !settingsGuild.dataset.bound) {
        settingsGuild.dataset.bound = '1';
        settingsGuild.addEventListener('change', () => {
          this._guildCache.delete(settingsGuild.value);
          this.refreshChannelPickers().catch(() => undefined);
        });
      }

      // Populate every per-system server picker (data-guild-select).
      document.querySelectorAll('select[data-guild-select]').forEach((sel) => {
        const saved = sel.value;
        sel.innerHTML = '<option value="">Select a server</option>';
        guilds.forEach((g) => {
          const opt = document.createElement('option');
          opt.value = g.id;
          opt.textContent = g.name;
          sel.appendChild(opt);
        });
        sel.value = saved || (guilds[0] ? guilds[0].id : '');
      });
    } catch (err) {
      console.error('Failed to fetch guilds:', err);
    }
  },

  async viewGuild(guildId) {
    try {
      const guild = await this.request(`/guilds/${guildId}`);
      const channels = guild.channels ?? [];
      const channelTypes = { 0: 'Text', 2: 'Voice', 4: 'Category', 5: 'News', 13: 'Stage', 15: 'Forum' };
      const html = `
        <div class="space-y-3 text-sm">
          <div class="flex justify-between gap-4 border-b border-white/5 pb-2">
            <span class="text-slate-400">Name</span>
            <span class="font-medium text-right">${this.escapeHtml(guild.name)}</span>
          </div>
          <div class="flex justify-between gap-4 border-b border-white/5 pb-2">
            <span class="text-slate-400">Members</span>
            <span class="font-medium font-mono">${this.formatNumber(guild.memberCount)}</span>
          </div>
          <div class="flex justify-between gap-4 border-b border-white/5 pb-2">
            <span class="text-slate-400">Owner ID</span>
            <span class="font-medium font-mono text-xs">${this.escapeHtml(guild.ownerId)}</span>
          </div>
          <div class="flex justify-between gap-4 border-b border-white/5 pb-2">
            <span class="text-slate-400">Verification</span>
            <span class="font-medium">${this.escapeHtml(guild.verificationLevel)}</span>
          </div>
          <div class="flex justify-between gap-4 pb-2">
            <span class="text-slate-400">Boost tier</span>
            <span class="font-medium">${this.escapeHtml(guild.preferredTier)}</span>
          </div>
          <h4 class="font-bold text-slate-300 mb-2 mt-4">Channels (${channels.length})</h4>
          <div class="space-y-1 max-h-72 overflow-y-auto">
            ${channels.map(c => `<div class="flex justify-between gap-3 p-2 rounded-lg bg-white/5 text-xs"><span class="font-mono text-slate-300 truncate"># ${this.escapeHtml(c.name)}</span><span class="badge badge-neutral">${this.escapeHtml(channelTypes[c.type] ?? c.type)}</span></div>`).join('') || '<div class="empty-state">No channels</div>'}
          </div>
        </div>
      `;
      this.showModal('guildModal', html, 'Server Details');
    } catch (err) {
      this.showAlert('Failed to load guild details');
    }
  },

  showModal(id, html, title) {
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement('div');
      el.id = id;
      el.className = 'modal';
      document.body.appendChild(el);
    }
    el.innerHTML = `
      <div class="modal-backdrop" onclick="app.closeModal('${id}')"></div>
      <div class="modal-content p-6">
        <div class="flex items-center justify-between mb-4">
          <h3 class="font-bold text-lg">${title}</h3>
          <button onclick="app.closeModal('${id}')" class="text-slate-400 hover:text-white">✕</button>
        </div>
        ${html}
        <div class="mt-6 flex justify-end">
          <button onclick="app.closeModal('${id}')" class="btn-primary">Close</button>
        </div>
      </div>
    `;
    el.classList.add('active');
  },

  closeModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('active');
  },

  async loadModeration() {
    const guildSel = document.getElementById('modGuildSelect');
    const guildId = guildSel.value;
    if (!guildId) {
      document.getElementById('modTableBody').innerHTML = '<tr><td colspan="6" class="p-8 text-center text-slate-500">Select a server to view moderation cases</td></tr>';
      return;
    }
    try {
      // warm the channel picker cache for the settings page too
      this.fetchGuildChannels(guildId).then(() => {
        const data = this._guildCache.get(guildId);
        if (data) this.populateChannelSelects(data.channels || []);
      });
      const cases = await this.request(`/moderation/cases?guildId=${guildId}`);
      this.renderModTable(cases);
    } catch (err) {
      this.showAlert('Failed to load moderation cases');
    }
  },

  renderModTable(cases) {
    const tbody = document.getElementById('modTableBody');
    tbody.innerHTML = '';

    if (!cases || cases.length === 0) {
      ['modWarns', 'modKicks', 'modBans', 'modMutes'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = '0';
      });
      tbody.innerHTML = '<tr><td colspan="6" class="p-8 text-center text-slate-500">No moderation cases found</td></tr>';
      return;
    }

    const counts = { warn: 0, kick: 0, ban: 0, mute: 0 };
    cases.forEach(c => { if (counts[c.type] !== undefined) counts[c.type]++; });
    document.getElementById('modWarns').textContent = counts.warn;
    document.getElementById('modKicks').textContent = counts.kick;
    document.getElementById('modBans').textContent = counts.ban;
    document.getElementById('modMutes').textContent = counts.mute;

    const sorted = [...cases].sort((a, b) => {
      const at = new Date(a.created_at).getTime() || 0;
      const bt = new Date(b.created_at).getTime() || 0;
      return bt - at;
    });

    sorted.forEach(c => {
      const tr = document.createElement('tr');
      const typeBadge = c.type === 'warn' ? 'badge-warning' : c.type === 'kick' || c.type === 'ban' ? 'badge-danger' : 'badge-info';
      tr.innerHTML = `
        <td>
          <div class="flex items-center gap-2">
            <span class="avatar sm round">${this.escapeHtml(String(c.user_id ?? '?').slice(0, 2))}</span>
            <span class="font-mono text-xs text-slate-400">${this.escapeHtml(c.user_id)}</span>
          </div>
        </td>
        <td><span class="badge ${typeBadge}">${this.escapeHtml(c.type)}</span></td>
        <td class="text-slate-300">${this.escapeHtml(c.reason || '—')}</td>
        <td class="text-center font-mono text-xs text-slate-400">${this.escapeHtml(c.moderator_id)}</td>
        <td class="text-center text-slate-400 text-xs">${this.escapeHtml(new Date(c.created_at).toLocaleDateString())}</td>
        <td class="text-right">
          <button onclick="app.viewCase('${this.escapeHtml(c.id)}')" class="btn-ghost text-xs">View</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  },

  viewCase(id) {
    this.showModal('caseModal', `<div class="text-sm text-slate-300">Case ID: <span class="font-mono">${id}</span></div>`, 'Case Details');
  },

  async handleWarn(e) {
    e.preventDefault();
    const form = e.target;
    const data = {
      guildId: document.getElementById('modGuildSelect').value,
      userId: form.userId.value,
      moderatorId: form.moderatorId.value,
      reason: form.reason.value,
    };
    if (!data.guildId) return this.showAlert('Please select a server first');
    try {
      await this.request('/moderation/warn', { method: 'POST', body: JSON.stringify(data) });
      this.showAlert('User warned successfully', 'success');
      this.closeModal('modalWarn');
      form.reset();
      this.loadModeration();
    } catch (err) {
      this.showAlert(err.message || 'Failed to warn user');
    }
  },

  async loadEconomy() {
    try {
      const data = await this.request('/economy/stats');
      const set = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
      };
      set('econTotal', `${this.formatNumber(data.totalBalance ?? 0)} ${data.currency || 'coins'}`);
      set('econUsers', this.formatNumber(data.fundedUsers ?? 0));
      set('econTxns', this.formatNumber(data.transactions ?? 0));

      const list = document.getElementById('econTxnList');
      if (list) {
        if (!data.recent || !data.recent.length) {
          list.innerHTML = '<div class="empty-state">No transactions recorded yet.</div>';
        } else {
          list.innerHTML = data.recent.map(txn => `
            <div class="list-row">
              <span class="avatar sm round">${this.escapeHtml((txn.username || '?').slice(0, 2))}</span>
              <span class="list-main">
                <strong>${this.escapeHtml(txn.username)}</strong>
                <span>${this.escapeHtml(txn.description || txn.type)}</span>
              </span>
              <span class="list-meta" style="color:${txn.type === 'debit' ? '#fca5a5' : '#6ee7b7'}">
                ${txn.type === 'debit' ? '-' : '+'}${this.formatNumber(txn.amount)}
                <small>${this.escapeHtml(this.timeAgo(txn.createdAt))}</small>
              </span>
            </div>`).join('');
        }
      }
    } catch (err) {
      console.error('Failed to load economy:', err);
      this.showAlert('Failed to load economy stats');
    }
  },

  async handleSetBalance(e) {
    e.preventDefault();
    const form = e.target;
    const data = {
      userId: form.userId.value,
      balance: parseFloat(form.balance.value),
      guildId: this.selectedGuildId() || undefined,
    };
    try {
      await this.request('/economy/set-balance', { method: 'POST', body: JSON.stringify(data) });
      this.showAlert('Balance updated successfully', 'success');
      form.reset();
      this.loadEconomy();
    } catch (err) {
      this.showAlert(err.message || 'Failed to set balance');
    }
  },

  async handleCheckBalance(e) {
    e.preventDefault();
    const form = e.target;
    const userId = form.userId.value;
    const resultEl = document.getElementById('balanceResult');
    try {
      const guildId = this.selectedGuildId();
      const data = await this.request(`/economy/balance/${userId}${guildId ? `?guildId=${guildId}` : ''}`);
      resultEl.className = 'mt-4 p-4 rounded-xl bg-green-500/10 border border-green-500/20';
      resultEl.innerHTML = `<div class="text-slate-300">User ID:</div><div class="font-mono text-lg font-bold">${data.userId}</div><div class="mt-1 text-slate-400 text-sm">Balance:</div><div class="text-green-400 font-bold text-xl">${data.balance} coins</div>`;
      resultEl.classList.remove('hidden');
    } catch (err) {
      resultEl.className = 'mt-4 p-4 rounded-xl bg-red-500/10 border border-red-500/20';
      resultEl.innerHTML = `<div class="text-red-400">Failed to fetch balance</div>`;
      resultEl.classList.remove('hidden');
    }
  },

  async loadLeveling() {
    const guildSel = document.getElementById('lvlGuildSelect');
    const guildId = guildSel.value;
    if (!guildId) {
      document.getElementById('lvlTableBody').innerHTML = '<tr><td colspan="5" class="p-8 text-center text-slate-500">Select a server to view leveling data</td></tr>';
      return;
    }
    try {
      this.fetchGuildChannels(guildId).then(() => {
        const data = this._guildCache.get(guildId);
        if (data) {
          this.populateChannelSelects(data.channels || []);
          this.populateChecklists(data.channels || []);
          this.populateAiPicker(data.channels || []);
          this.populateRoleSelects(data.roles || []);
          if (this._leveling) this.fillLeveling(this._leveling, data.channels || [], data.roles || []);
        }
      });
      const leaderboard = await this.request(`/leveling/leaderboard?guildId=${guildId}&limit=20`);
      this.renderLevelTable(leaderboard);
    } catch (err) {
      this.showAlert('Failed to load leveling data');
    }
  },

  renderLevelTable(users) {
    const tbody = document.getElementById('lvlTableBody');
    tbody.innerHTML = '';

    if (!users || users.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="p-8 text-center text-slate-500">No leveling data found</td></tr>';
      return;
    }

    let maxLevel = 0;
    const sorted = [...users].sort((a, b) => Number(b.total_xp ?? 0) - Number(a.total_xp ?? 0));
    sorted.forEach((u, index) => {
      const lvl = u.level || 1;
      if (lvl > maxLevel) maxLevel = lvl;
      const avatar = this.avatarUrl(u.id, u.avatar, 64);
      const name = u.username || `Member ${String(u.id).slice(0, 6)}`;
      const initials = this.escapeHtml(name.slice(0, 2));

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>
          <div class="flex items-center gap-3">
            <span class="rank-badge ${index === 0 ? 'gold' : index === 1 ? 'silver' : index === 2 ? 'bronze' : ''}">${index + 1}</span>
            <span class="avatar sm round">${avatar ? `<img src="${avatar}" alt="" loading="lazy">` : initials}</span>
            <div class="min-w-0">
              <div class="text-slate-200 truncate">${this.escapeHtml(name)}</div>
              <div class="text-xs text-slate-500 font-mono truncate">${this.escapeHtml(u.id)}</div>
            </div>
          </div>
        </td>
        <td class="text-center font-mono font-bold">${this.formatNumber(lvl)}</td>
        <td class="text-center">${this.formatNumber(u.xp ?? 0)}</td>
        <td class="text-center">${this.formatNumber(u.total_xp ?? 0)}</td>
        <td class="text-right">
          <button onclick="app.setXP('${this.escapeHtml(u.id)}')" class="btn-ghost text-xs">Edit XP</button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    document.getElementById('lvlUsers').textContent = this.formatNumber(users.length);
    document.getElementById('lvlMax').textContent = this.formatNumber(maxLevel);
    document.getElementById('lvlUps').textContent = this.formatNumber(users.filter(u => (u.level || 1) > 1).length);
  },

  setXP(userId) {
    document.getElementById('modalSetXP').querySelector('input[name="userId"]').value = userId;
    document.getElementById('modalSetXP').classList.add('active');
  },

  async handleSetXP(e) {
    e.preventDefault();
    const form = e.target;
    const data = {
      guildId: form.guildId.value,
      userId: form.userId.value,
      xp: parseInt(form.xp.value),
    };
    if (!data.guildId) return this.showAlert('Please enter a Guild ID');
    try {
      await this.request('/leveling/set-xp', { method: 'POST', body: JSON.stringify(data) });
      this.showAlert('XP updated successfully', 'success');
      this.closeModal('modalSetXP');
      form.reset();
      this.loadLeveling();
    } catch (err) {
      this.showAlert(err.message || 'Failed to set XP');
    }
  },

  async fetchSystemInfo() {
    try {
      const data = await this.request('/system/info');
      document.getElementById('sysPlatform').textContent = data.platform;
      document.getElementById('sysArch').textContent = data.arch;
      document.getElementById('sysNode').textContent = data.nodeVersion;
      document.getElementById('sysPid').textContent = data.pid;
      document.getElementById('sysUptime').textContent = this.formatUptime(data.uptime);
      document.getElementById('sysCpu').textContent = data.cpuModel;
      document.getElementById('sysCpuCount').textContent = data.cpuCount;
      const memGB = (data.usedMemory / 1024 / 1024 / 1024).toFixed(2);
      const totalGB = (data.totalMemory / 1024 / 1024 / 1024).toFixed(2);
      document.getElementById('sysMem').textContent = `${memGB} GB / ${totalGB} GB`;
      document.getElementById('sysCwd').textContent = data.cwd;
    } catch (err) {
      console.error('Failed to fetch system info:', err);
    }
  },

  async fetchProcessInfo() {
    try {
      const data = await this.request('/system/processes');
      document.getElementById('sysProcTitle').textContent = data.title;
      const rss = (data.memoryUsage.rss / 1024 / 1024).toFixed(1);
      const heapTotal = (data.memoryUsage.heapTotal / 1024 / 1024).toFixed(1);
      const heapUsed = (data.memoryUsage.heapUsed / 1024 / 1024).toFixed(1);
      const external = (data.memoryUsage.external / 1024 / 1024).toFixed(1);
      document.getElementById('sysRss').textContent = `${rss} MB`;
      document.getElementById('sysHeapTotal').textContent = `${heapTotal} MB`;
      document.getElementById('sysHeapUsed').textContent = `${heapUsed} MB`;
      document.getElementById('sysExternal').textContent = `${external} MB`;
    } catch (err) {
      console.error('Failed to fetch process info:', err);
    }
  },

  startPolling() {
    this.intervalId = setInterval(() => {
      if (document.hidden) return;
      if (this.currentPage === 'dashboard') {
        this.loadOverview();
      } else {
        this.fetchStatus();
      }
      if (this.currentPage === 'system') {
        this.fetchSystemInfo();
        this.fetchProcessInfo();
      }
    }, 8000);
  },

  stopPolling() {
    if (this.intervalId) clearInterval(this.intervalId);
  },

  refreshCurrent(silent = false) {
    if (this.currentPage === 'dashboard') this.loadOverview();
    if (this.currentPage === 'guilds') this.fetchGuilds();
    if (this.currentPage === 'moderation') this.loadModeration();
    if (this.currentPage === 'economy') this.loadEconomy();
    if (this.currentPage === 'leveling') this.loadLeveling();
    if (this.currentPage === 'cards') this.loadCardsConfig();
    if (this.currentPage === 'settings') this.loadSettings();
    if (this.currentPage === 'system') { this.fetchSystemInfo(); this.fetchProcessInfo(); }
    if (this.currentPage === 'tickets') this.loadTickets();
    if (this.currentPage === 'giveaways') this.loadGiveaways();
    if (this.currentPage === 'games') this.loadGames();
    if (this.currentPage === 'staffapps') this.loadStaffApps();
    if (this.currentPage === 'tempvc') this.loadTempVC();
    if (this.currentPage === 'community') this.loadCommunity();
    if (this.currentPage === 'automation') this.loadAutomation();
    if (this.currentPage === 'ai') this.loadAI();
    if (this.currentPage === 'music') this.loadMusic();
    if (this.currentPage === 'analytics') this.loadAnalytics();
    if (!silent) this.showAlert('Dashboard refreshed', 'success');
  },

  refreshData(page) {
    if (page && page !== this.currentPage) return this.openPage(page);
    this.currentPage = page || this.currentPage;
    this.refreshCurrent();
  },

  async savePresence() {
    const status = document.getElementById('presenceStatus')?.value || 'online';
    const activityName = (document.getElementById('presenceActivity')?.value || '').trim();
    const activityType = Number(document.getElementById('presenceType')?.value || 0);
    try {
      await this.request('/control/presence', {
        method: 'POST',
        body: JSON.stringify({ status, activityName, activityType }),
      });
      this.showAlert('Presence updated in Discord', 'success');
    } catch (err) {
      this.showAlert(err.message || 'Failed to update presence');
    }
  },

  setupForms() {
    document.getElementById('warnForm')?.addEventListener('submit', (e) => this.handleWarn(e));
    document.getElementById('setBalanceForm')?.addEventListener('submit', (e) => this.handleSetBalance(e));
    document.getElementById('checkBalanceForm')?.addEventListener('submit', (e) => this.handleCheckBalance(e));
    document.getElementById('setXPForm')?.addEventListener('submit', (e) => this.handleSetXP(e));
  },

  async saveConfig(service) {
    try {
      const config = {};
      if (service === 'web') {
        config.port = parseInt(document.getElementById('webPort').value);
      }
      if (service === 'bot') {
        config.prefix = document.getElementById('cmdPrefix').value;
      }
      await this.request(`/config/${service}`, { method: 'POST', body: JSON.stringify(config) });
      this.showAlert(service === 'web' ? 'Web port saved (applies after restart)' : 'Configuration saved', 'success');
    } catch (err) {
      this.showAlert(err.message || 'Failed to save config');
    }
  },

  // ---------- Settings helpers ----------
  el(id) { return document.getElementById(id); },
  val(id) { const e = this.el(id); return e ? e.value : ''; },
  num(id, fallback = 0) { const n = parseFloat(this.val(id)); return Number.isFinite(n) ? n : fallback; },
  bool(id) { const e = this.el(id); return !!e && e.checked; },
  setVal(id, v) { const e = this.el(id); if (e) e.value = v ?? ''; },
  setBool(id, v) { const e = this.el(id); if (e) e.checked = !!v; },
  setPlaceholder(id, text) { const e = this.el(id); if (e) e.placeholder = text; },
  jsonText(id, fallback) {
    const t = this.val(id).trim();
    if (!t) return fallback;
    try {
      return JSON.parse(t);
    } catch {
      throw new Error(`${id}: invalid JSON`);
    }
  },
  listText(id) {
    return this.val(id).split(',').map(s => s.trim()).filter(Boolean);
  },
  dumpJson(v) {
    if (v === undefined || v === null) return '';
    return JSON.stringify(v);
  },

  async saveServiceConfig(service, label, payload) {
    try {
      await this.request(`/config/${service}`, { method: 'POST', body: JSON.stringify(payload) });
      this.showAlert(`${label} settings saved`, 'success');
    } catch (err) {
      this.showAlert(err.message || `Failed to save ${label} settings`);
    }
  },

  async loadSettings() {
    // Module master toggles
    try {
      const g = await this.request('/config/guild_settings');
      this.setBool('toggleLeveling', g.leveling_enabled);
      this.setBool('toggleAI', g.ai_enabled);
      this.setBool('toggleMusic', g.music_enabled);
      this.setBool('toggleEconomy', g.economy_enabled);
    } catch (err) {
      console.error('Failed to load module settings:', err);
    }
    // Bot + web
    try {
      const b = await this.request('/config/bot');
      this.setVal('cmdPrefix', b.prefix ?? '!');
    } catch (err) { /* settings page still usable */ }
    try {
      const w = await this.request('/config/web');
      this.setVal('webPort', w.port ?? '');
    } catch (err) { /* keep default */ }
    // Per-system cards
    const loaders = [
      ['leveling', (cfg) => this.fillLeveling(cfg)],
      ['ai', (cfg) => this.fillAi(cfg)],
      ['music', (cfg) => this.fillMusic(cfg)],
      ['moderation', (cfg) => this.fillModeration(cfg)],
      ['economy', (cfg) => this.fillEconomy(cfg)],
      ['tempvc', (cfg) => this.fillTempvc(cfg)],
      ['automation', (cfg) => this.fillAutomation(cfg)],
      ['analytics', (cfg) => this.fillAnalytics(cfg)],
      ['community', (cfg) => this.fillCommunity(cfg)],
      ['tickets', (cfg) => this.fillTickets(cfg)],
      ['staffapps', (cfg) => this.fillStaffApps(cfg)],
      ['panels', (cfg) => this.fillPanels(cfg)],
    ];
    for (const [service, fill] of loaders) {
      try {
        fill(await this.request(`/config/${service}`));
      } catch (err) {
        console.error(`Failed to load ${service} config:`, err);
      }
    }
    // preload channels/roles for pickers (best-effort)
    this.refreshChannelPickers().catch(() => undefined);
    this.bindSettingsOverviewInputs();
    this.refreshSettingsOverview();
  },

  bindSettingsOverviewInputs() {
    ['toggleLeveling', 'toggleEconomy', 'toggleAI', 'toggleMusic', 'wel_enabled', 'tvc_enabled',
      'auto_enabled', 'mod_enabled', 'tix_enabled', 'sapp_enabled'].forEach(id => {
      const input = document.getElementById(id);
      if (!input || input.dataset.overviewBound) return;
      input.dataset.overviewBound = '1';
      input.addEventListener('change', () => this.refreshSettingsOverview());
    });
  },

  fillLeveling(cfg, channels, roles) {
    cfg = cfg || {};
    this._leveling = cfg;
    const src = cfg.xpSources || {};
    const mult = cfg.xpMultipliers || {};
    this.setBool('lvl_enabled', cfg.enabled);
    this.setVal('lvl_formula', cfg.xpFormula || 'quadratic');
    this.setVal('lvl_baseXp', cfg.baseXpPerLevel ?? 100);
    this.setVal('lvl_multiplier', cfg.xpMultiplier ?? 1);
    this.setVal('lvl_maxLevel', cfg.maxLevel ?? 100);
    this.setBool('lvl_ignoreBots', cfg.ignoreBots);
    this.setColorPair('lvl_defaultColor', 'lvl_defaultColorPicker', cfg.defaultColor || '#0099ff');
    this.setBool('lvl_msg_enabled', src.message?.enabled);
    this.setVal('lvl_msg_min', src.message?.min ?? 15);
    this.setVal('lvl_msg_max', src.message?.max ?? 25);
    this.setVal('lvl_msg_cooldown', src.message?.cooldownSeconds ?? 60);
    this.setBool('lvl_voice_enabled', src.voice?.enabled);
    this.setVal('lvl_voice_min', src.voice?.perMinuteMin ?? 5);
    this.setVal('lvl_voice_max', src.voice?.perMinuteMax ?? 8);
    this.setVal('lvl_voice_cooldown', src.voice?.cooldownSeconds ?? 60);
    this.setBool('lvl_cmd_enabled', src.command?.enabled);
    this.setVal('lvl_cmd_amount', src.command?.amount ?? 10);
    this.setVal('lvl_cmd_cooldown', src.command?.cooldownSeconds ?? 300);
    this.setVal('lvl_mult_weekend', mult.weekend ?? 1.5);
    this.setVal('lvl_mult_booster', mult.booster ?? 2);

    // Resolve member track (new fields win, legacy falls back)
    const memberRoles = cfg.memberLevelRoles?.length ? cfg.memberLevelRoles : (cfg.levelRoles || []);
    const staffRoles = cfg.staffLevelRoles || [];
    const memberAnn = cfg.memberAnnouncementChannels?.length ? cfg.memberAnnouncementChannels : (cfg.announcementChannels || []);
    const staffAnn = cfg.staffAnnouncementChannels || [];
    const staffRoleIds = cfg.staffRoleIds || [];

    // keep legacy hidden fields in sync for any external save path
    this.setVal('lvl_noXpChannels', this.dumpJson(cfg.noXpChannels) || '[]');
    this.setVal('lvl_xpWhitelist', this.dumpJson(cfg.xpChannelWhitelist) || '[]');
    this.setVal('lvl_customXpTable', this.dumpJson(cfg.customXpTable) || '{}');
    this.setVal('lvl_levelRoles', this.dumpJson(memberRoles) || '[]');
    this.setVal('lvl_announceChannels', this.dumpJson(memberAnn) || '[]');
    this.setVal('lvl_memberLevelRoles', this.dumpJson(memberRoles) || '[]');
    this.setVal('lvl_staffLevelRoles', this.dumpJson(staffRoles) || '[]');
    this.setVal('lvl_memberAnnounce', this.dumpJson(memberAnn) || '[]');
    this.setVal('lvl_staffAnnounce', this.dumpJson(staffAnn) || '[]');
    this.setVal('lvl_staffRoles', this.dumpJson(staffRoleIds) || '[]');

    // friendly editors — two tracks, same XP curve
    this.renderCustomXpTable(cfg.customXpTable || {});
    this.renderLevelRoles(memberRoles, roles || this._cachedRoles || [], 'lvl_memberRolesUI');
    this.renderLevelRoles(staffRoles, roles || this._cachedRoles || [], 'lvl_staffLevelRolesUI');
    this.renderAnnounceChannels(memberAnn, channels || [], roles || this._cachedRoles || [], 'lvl_memberAnnounceUI');
    this.renderAnnounceChannels(staffAnn, channels || [], roles || this._cachedRoles || [], 'lvl_staffAnnounceUI');
    this.renderStaffRolesPicker(staffRoleIds, roles || this._cachedRoles || []);
    this.renderRoleMultipliers(mult.role || {}, roles || this._cachedRoles || []);
    this._pendingNoXp = cfg.noXpChannels || [];
    this._pendingWhitelist = cfg.xpChannelWhitelist || [];
    this._pendingStaffRoles = staffRoleIds || [];
    // if channels are already cached, paint checklists; otherwise refresh will
    if (channels?.length) {
      this.populateChecklists(channels);
      this.populateStaffRolesChecklist(roles || this._cachedRoles || [], staffRoleIds);
    }
  },

  renderStaffRolesPicker(selected, roles) {
    this.populateStaffRolesChecklist(roles || this._cachedRoles || [], selected || []);
  },

  populateStaffRolesChecklist(roles, selected) {
    const wrap = document.getElementById('lvl_staffRolesUI');
    if (!wrap) return;
    if (!roles?.length) {
      wrap.innerHTML = '<span class="hint">No roles loaded yet. Click “Refresh roles” after picking a server.</span>';
      return;
    }
    const selectedSet = new Set(selected || []);
    this._pendingStaffRoles = [...selectedSet];
    wrap.innerHTML = '';
    const search = document.createElement('input');
    search.type = 'text';
    search.className = 'input-field mb-2';
    search.placeholder = 'Search roles…';
    wrap.appendChild(search);
    const list = document.createElement('div');
    list.className = 'flex flex-col gap-0.5';
    wrap.appendChild(list);
    const draw = (filter = '') => {
      list.innerHTML = '';
      roles.filter(r => !filter || r.name.toLowerCase().includes(filter.toLowerCase())).forEach(r => {
        if (r.id === r.guildId) return; // skip @everyone
        const label = document.createElement('label');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = selectedSet.has(r.id);
        cb.onchange = () => {
          if (cb.checked) selectedSet.add(r.id); else selectedSet.delete(r.id);
          this._pendingStaffRoles = [...selectedSet];
          this.setVal('lvl_staffRoles', JSON.stringify(this._pendingStaffRoles));
        };
        const span = document.createElement('span');
        span.textContent = `🛡️ ${r.name}`;
        span.className = 'flex-1';
        label.appendChild(cb);
        label.appendChild(span);
        list.appendChild(label);
      });
      if (!list.children.length) list.innerHTML = '<span class="hint">No matching roles.</span>';
    };
    search.oninput = () => draw(search.value);
    draw();
  },

  // ---- Leveling row editors (no raw JSON) ----
  renderCustomXpTable(table) {
    const wrap = document.getElementById('lvl_customXpTableUI');
    if (!wrap) return;
    wrap.innerHTML = '';
    const entries = Object.entries(table || {}).sort((a, b) => Number(a[0]) - Number(b[0]));
    if (!entries.length) {
      wrap.innerHTML = '<span class="hint">No custom levels. Using the formula above. Add a level to override.</span>';
      return;
    }
    entries.forEach(([level, xp]) => this.appendCustomXpRow(level, xp, wrap));
  },
  appendCustomXpRow(level, xp, wrap) {
    wrap = wrap || document.getElementById('lvl_customXpTableUI');
    const row = document.createElement('div');
    row.className = 'row-item';
    row.innerHTML = `
      <div class="grid grid-cols-2 gap-2">
        <div><label class="field-label">Level</label><input type="number" class="input-field cxp-level" value="${level}" min="1"></div>
        <div><label class="field-label">Total XP to reach it</label><input type="number" class="input-field cxp-xp" value="${xp}" min="0"></div>
      </div>
      <button type="button" class="btn-ghost text-xs w-fit">Remove</button>`;
    row.querySelector('button').onclick = () => row.remove();
    wrap.appendChild(row);
  },
  addCustomXpRow() { this.appendCustomXpRow(2, 100, null); },
  generateMelee6Table() {
    const wrap = document.getElementById('lvl_customXpTableUI');
    wrap.innerHTML = '';
    const xpFor = (l) => Math.floor(5 * l * l + 50 * l + 100);
    const total = (l) => { let t = 0; for (let i = 0; i < l; i++) t += xpFor(i); return t; };
    for (let lvl = 1; lvl <= 20; lvl++) this.appendCustomXpRow(lvl, total(lvl), wrap);
    this.showAlert('MEE6 curve generated (levels 1–20). Edit or save.', 'info');
  },
  clearCustomXpTable() { document.getElementById('lvl_customXpTableUI').innerHTML = ''; },
  collectCustomXpTable() {
    const rows = document.querySelectorAll('#lvl_customXpTableUI .row-item');
    const out = {};
    rows.forEach(r => {
      const lvl = parseInt(r.querySelector('.cxp-level')?.value, 10);
      const xp = parseInt(r.querySelector('.cxp-xp')?.value, 10);
      if (Number.isFinite(lvl) && Number.isFinite(xp) && lvl >= 1 && xp >= 0) out[lvl] = xp;
    });
    return out;
  },

  renderLevelRoles(arr, roles, containerId = 'lvl_levelRolesUI') {
    const wrap = document.getElementById(containerId);
    if (!wrap) return;
    wrap.innerHTML = '';
    if (!arr?.length) {
      const track = containerId.includes('staff') ? 'staff' : 'member';
      wrap.innerHTML = `<span class="hint">No ${track} level roles yet.</span>`;
      return;
    }
    arr.forEach(entry => this.appendLevelRoleRow(entry, roles, wrap));
  },
  roleOptions(selected, roles) {
    const opts = [`<option value="">Select role…</option>`]
      .concat((roles || []).map(r => `<option value="${r.id}" ${r.id === selected ? 'selected' : ''}>${this.escapeHtml(r.name)}</option>`));
    return opts.join('');
  },
  channelOptions(selected, channels) {
    const opts = [`<option value="">Select channel…</option>`]
      .concat((channels || []).filter(c => c.type !== 4).map(c => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}># ${this.escapeHtml(c.name)}</option>`));
    return opts.join('');
  },
  escapeHtml(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); },
  appendLevelRoleRow(entry, roles, wrap) {
    // wrap may be a container id string in legacy callers
    if (typeof wrap === 'string') wrap = document.getElementById(wrap);
    if (!wrap) return;
    if (wrap.querySelector(':scope > .hint')) wrap.innerHTML = '';
    const row = document.createElement('div');
    row.className = 'row-item';
    row.innerHTML = `
      <div class="grid grid-cols-2 gap-2">
        <div><label class="field-label">At level</label><input type="number" class="input-field lr-level" value="${entry?.level ?? 5}" min="1"></div>
        <div><label class="field-label">Role</label><select class="input-field lr-role">${this.roleOptions(entry?.roleId || '', roles || this._cachedRoles || [])}</select></div>
      </div>
      <div class="flex items-center justify-between">
        <span class="text-sm text-slate-300">Replaces lower tiers</span>
        <label class="relative inline-flex items-center cursor-pointer">
          <input type="checkbox" class="sr-only peer lr-replace" ${entry?.replaceLower ? 'checked' : ''}>
          <div class="w-10 h-5 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-red-600"></div>
        </label>
      </div>
      <button type="button" class="btn-ghost text-xs w-fit">Remove</button>`;
    row.querySelector('button').onclick = () => row.remove();
    wrap.appendChild(row);
  },
  addLevelRoleRow(track) {
    const wrapId = track === 'staff' ? 'lvl_staffLevelRolesUI' : 'lvl_memberRolesUI';
    const wrap = document.getElementById(wrapId);
    this.appendLevelRoleRow({ level: 5, roleId: '', replaceLower: false }, this._cachedRoles || [], wrap);
  },
  collectLevelRoles(containerId) {
    const out = [];
    document.querySelectorAll(`#${containerId} .row-item`).forEach(r => {
      const level = parseInt(r.querySelector('.lr-level')?.value, 10);
      const roleId = r.querySelector('.lr-role')?.value || '';
      const replaceLower = !!r.querySelector('.lr-replace')?.checked;
      if (Number.isFinite(level) && roleId) out.push({ level, roleId, replaceLower });
    });
    return out.sort((a, b) => a.level - b.level);
  },

  renderAnnounceChannels(arr, channels, roles, containerId = 'lvl_announceChannelsUI') {
    const wrap = document.getElementById(containerId);
    if (!wrap) return;
    wrap.innerHTML = '';
    if (!arr?.length) {
      const track = containerId.includes('staff') ? 'staff' : 'member';
      wrap.innerHTML = `<span class="hint">No ${track} announcement channels.</span>`;
      return;
    }
    arr.forEach(entry => this.appendAnnounceRow(entry, channels, roles, wrap));
  },
  appendAnnounceRow(entry, channels, roles, wrap) {
    if (typeof wrap === 'string') wrap = document.getElementById(wrap);
    if (!wrap) return;
    if (wrap.querySelector(':scope > .hint')) wrap.innerHTML = '';
    const row = document.createElement('div');
    row.className = 'row-item';
    const colorVal = entry?.color || '#0099ff';
    row.innerHTML = `
      <div>
        <label class="field-label">Channel</label>
        <select class="input-field ac-channel">${this.channelOptions(entry?.channelId || '', channels || [])}</select>
      </div>
      <div class="grid grid-cols-2 gap-2">
        <div><label class="field-label">Min level (optional)</label><input type="number" class="input-field ac-min" value="${entry?.minLevel ?? ''}" placeholder="Any" min="1"></div>
        <div><label class="field-label">Only this role (optional)</label><select class="input-field ac-role">${this.roleOptions(entry?.roleId || '', roles || this._cachedRoles || [])}</select></div>
      </div>
      <div>
        <label class="field-label">Custom message (optional)</label>
        <textarea class="input-field ac-template" rows="2" placeholder="🎉 Congratulations {user}, level {level}!">${this.escapeHtml(entry?.messageTemplate || '')}</textarea>
        <p class="hint">Placeholders: {user} {username} {level} {oldLevel} {xp} {totalXp}</p>
      </div>
      <div>
        <label class="field-label">Card color</label>
        <div class="color-wrap"><input type="color" class="ac-color-picker" value="${colorVal}"><input type="text" class="input-field ac-color" value="${colorVal}"></div>
      </div>
      <button type="button" class="btn-ghost text-xs w-fit">Remove</button>`;
    const picker = row.querySelector('.ac-color-picker');
    const text = row.querySelector('.ac-color');
    picker.addEventListener('input', () => text.value = picker.value);
    text.addEventListener('input', () => { if (/^#[0-9a-fA-F]{6}$/.test(text.value)) picker.value = text.value; });
    row.querySelector('button').onclick = () => row.remove();
    wrap.appendChild(row);
  },
  addAnnounceChannelRow(track) {
    const wrapId = track === 'staff' ? 'lvl_staffAnnounceUI' : 'lvl_memberAnnounceUI';
    const wrap = document.getElementById(wrapId);
    this.appendAnnounceRow({}, [], this._cachedRoles || [], wrap);
  },
  collectAnnounceChannels(containerId) {
    const out = [];
    document.querySelectorAll(`#${containerId} .row-item`).forEach(r => {
      const channelId = r.querySelector('.ac-channel')?.value || '';
      if (!channelId) return;
      const minRaw = r.querySelector('.ac-min')?.value;
      const minLevel = minRaw === '' || minRaw == null ? undefined : parseInt(minRaw, 10);
      const roleId = r.querySelector('.ac-role')?.value || undefined;
      const messageTemplate = r.querySelector('.ac-template')?.value?.trim() || undefined;
      const color = r.querySelector('.ac-color')?.value?.trim() || undefined;
      const entry = { channelId };
      if (Number.isFinite(minLevel)) entry.minLevel = minLevel;
      if (roleId) entry.roleId = roleId;
      if (messageTemplate) entry.messageTemplate = messageTemplate;
      if (color) entry.color = color;
      out.push(entry);
    });
    return out;
  },

  // Legacy wrappers (hidden containers) — keep old callers working
  collectLevelRolesLegacy(containerId) { return this.collectLevelRoles(containerId); },

  renderRoleMultipliers(obj, roles) {
    const wrap = document.getElementById('lvl_roleMultipliersUI');
    if (!wrap) return;
    wrap.innerHTML = '';
    const entries = Object.entries(obj || {});
    if (!entries.length) {
      wrap.innerHTML = '<span class="hint">No role multipliers. Weekend & booster multipliers still apply.</span>';
      return;
    }
    entries.forEach(([roleId, mult]) => this.appendRoleMultiplierRow(roleId, mult, roles, wrap));
  },
  appendRoleMultiplierRow(roleId, mult, roles, wrap) {
    wrap = wrap || document.getElementById('lvl_roleMultipliersUI');
    if (wrap.querySelector(':scope > .hint')) wrap.innerHTML = '';
    const row = document.createElement('div');
    row.className = 'row-item';
    row.innerHTML = `
      <div class="grid grid-cols-2 gap-2">
        <div><label class="field-label">Role</label><select class="input-field rm-role">${this.roleOptions(roleId || '', roles || this._cachedRoles || [])}</select></div>
        <div><label class="field-label">XP multiplier (e.g. 2 = ×2)</label><input type="number" step="any" class="input-field rm-mult" value="${mult ?? 2}" min="1"></div>
      </div>
      <button type="button" class="btn-ghost text-xs w-fit">Remove</button>`;
    row.querySelector('button').onclick = () => row.remove();
    wrap.appendChild(row);
  },
  addRoleMultiplierRow() { this.appendRoleMultiplierRow('', 2, this._cachedRoles || [], null); },
  collectRoleMultipliers() {
    const out = {};
    document.querySelectorAll('#lvl_roleMultipliersUI .row-item').forEach(r => {
      const roleId = r.querySelector('.rm-role')?.value || '';
      const mult = parseFloat(r.querySelector('.rm-mult')?.value);
      if (roleId && Number.isFinite(mult) && mult > 0) out[roleId] = mult;
    });
    return out;
  },

  async saveLevelingConfig() {
    const noXp = this._pendingNoXp ?? this.jsonSafe(() => this.jsonText('lvl_noXpChannels', [])) ?? [];
    const whitelist = this._pendingWhitelist ?? this.jsonSafe(() => this.jsonText('lvl_xpWhitelist', [])) ?? [];
    const memberRoles = this.collectLevelRoles('lvl_memberRolesUI');
    const staffRoles = this.collectLevelRoles('lvl_staffLevelRolesUI');
    const memberAnn = this.collectAnnounceChannels('lvl_memberAnnounceUI');
    const staffAnn = this.collectAnnounceChannels('lvl_staffAnnounceUI');
    const staffRoleIds = this._pendingStaffRoles ?? this.jsonSafe(() => this.jsonText('lvl_staffRoles', [])) ?? [];
    const payload = {
      enabled: this.bool('lvl_enabled'),
      xpFormula: this.val('lvl_formula') || 'quadratic',
      baseXpPerLevel: this.num('lvl_baseXp', 100),
      xpMultiplier: this.num('lvl_multiplier', 1),
      maxLevel: this.num('lvl_maxLevel', 100),
      ignoreBots: this.bool('lvl_ignoreBots'),
      defaultColor: this.val('lvl_defaultColor') || '#0099ff',
      xpSources: {
        message: { enabled: this.bool('lvl_msg_enabled'), min: this.num('lvl_msg_min'), max: this.num('lvl_msg_max'), cooldownSeconds: this.num('lvl_msg_cooldown') },
        voice: { enabled: this.bool('lvl_voice_enabled'), perMinuteMin: this.num('lvl_voice_min'), perMinuteMax: this.num('lvl_voice_max'), cooldownSeconds: this.num('lvl_voice_cooldown') },
        command: { enabled: this.bool('lvl_cmd_enabled'), amount: this.num('lvl_cmd_amount'), cooldownSeconds: this.num('lvl_cmd_cooldown') },
      },
      xpMultipliers: {
        weekend: this.num('lvl_mult_weekend', 1.5),
        booster: this.num('lvl_mult_booster', 2),
        role: this.collectRoleMultipliers(),
      },
      noXpChannels: noXp,
      xpChannelWhitelist: whitelist,
      customXpTable: this.collectCustomXpTable(),
      // member track (also mirrored to legacy keys for compat)
      levelRoles: memberRoles,
      memberLevelRoles: memberRoles,
      announcementChannels: memberAnn,
      memberAnnouncementChannels: memberAnn,
      // staff track
      staffRoleIds,
      staffLevelRoles: staffRoles,
      staffAnnouncementChannels: staffAnn,
    };
    // keep hidden legacy fields in sync (other tooling may read them)
    this.setVal('lvl_noXpChannels', JSON.stringify(noXp));
    this.setVal('lvl_xpWhitelist', JSON.stringify(whitelist));
    this.setVal('lvl_customXpTable', JSON.stringify(payload.customXpTable));
    this.setVal('lvl_levelRoles', JSON.stringify(memberRoles));
    this.setVal('lvl_announceChannels', JSON.stringify(memberAnn));
    this.setVal('lvl_memberLevelRoles', JSON.stringify(memberRoles));
    this.setVal('lvl_staffLevelRoles', JSON.stringify(staffRoles));
    this.setVal('lvl_memberAnnounce', JSON.stringify(memberAnn));
    this.setVal('lvl_staffAnnounce', JSON.stringify(staffAnn));
    this.setVal('lvl_staffRoles', JSON.stringify(staffRoleIds));
    await this.saveServiceConfig('leveling', 'Leveling', payload);
  },

  jsonSafe(fn) { try { return fn(); } catch { return undefined; } },

  fillAi(cfg) {
    cfg = cfg || {};
    this.setBool('ai_enabled', cfg.enabled);
    this.setVal('ai_displayName', cfg.displayName || '');
    this.setVal('ai_model', cfg.model || '');
    this.setVal('ai_systemPrompt', cfg.systemPrompt || '');
    this.setVal('ai_channelIds', (cfg.channelIds || []).join(', '));
    this._pendingAiChannels = cfg.channelIds || [];
    this.setVal('ai_historySize', cfg.historySize ?? 30);
    this.setVal('ai_batchWindowMs', cfg.batchWindowMs ?? 2500);
    this.setVal('ai_replyCooldown', cfg.replyCooldownSeconds ?? 25);
    this.setVal('ai_decisionCooldown', cfg.decisionCooldownSeconds ?? 10);
    this.setVal('ai_maxReplies', cfg.maxRepliesPerHour ?? 40);
    this.setVal('ai_maxMessageLength', cfg.maxMessageLength ?? 500);
    this.setBool('ai_showTyping', cfg.showTyping);
    this.setVal('ai_temperature', cfg.temperature ?? 1);
    this.setVal('ai_requestTimeout', cfg.requestTimeoutMs ?? 20000);
    this.setVal('ai_apiKey', '');
    this.setPlaceholder('ai_apiKey', cfg.hasApiKey ? '•••••••• (set — leave empty to keep)' : 'Paste API key');
    if (cfg.channelIds?.length) this._pendingAiChannels = [...cfg.channelIds];
  },

  async saveAiConfig() {
    const payload = {
      enabled: this.bool('ai_enabled'),
      displayName: this.val('ai_displayName'),
      model: this.val('ai_model'),
      systemPrompt: this.val('ai_systemPrompt'),
      channelIds: this._pendingAiChannels ?? this.listText('ai_channelIds'),
      historySize: this.num('ai_historySize', 30),
      batchWindowMs: this.num('ai_batchWindowMs', 2500),
      replyCooldownSeconds: this.num('ai_replyCooldown', 25),
      decisionCooldownSeconds: this.num('ai_decisionCooldown', 10),
      maxRepliesPerHour: this.num('ai_maxReplies', 40),
      maxMessageLength: this.num('ai_maxMessageLength', 500),
      showTyping: this.bool('ai_showTyping'),
      temperature: this.num('ai_temperature', 1),
      requestTimeoutMs: this.num('ai_requestTimeout', 20000),
    };
    const apiKey = this.val('ai_apiKey').trim();
    if (apiKey) payload.apiKey = apiKey;
    await this.saveServiceConfig('ai', 'AI', payload);
  },

  fillMusic(cfg) {
    cfg = cfg || {};
    this.setBool('mus_enabled', cfg.enabled);
    this.setVal('mus_host', cfg.lavalinkHost || '');
    this.setVal('mus_port', cfg.lavalinkPort ?? 2333);
    this.setVal('mus_volume', cfg.defaultVolume ?? 100);
    this.setVal('mus_maxPlaylist', cfg.maxPlaylistSize ?? 50);
    this.setBool('mus_allowSkip', cfg.allowSkip);
    this.setBool('mus_allowRepeat', cfg.allowRepeat);
    this.setVal('mus_password', '');
    this.setPlaceholder('mus_password', cfg.hasLavalinkPassword ? '•••••••• (set — leave empty to keep)' : 'Lavalink password');
  },

  async saveMusicConfig() {
    const payload = {
      enabled: this.bool('mus_enabled'),
      lavalinkHost: this.val('mus_host'),
      lavalinkPort: this.num('mus_port', 2333),
      defaultVolume: this.num('mus_volume', 100),
      maxPlaylistSize: this.num('mus_maxPlaylist', 50),
      allowSkip: this.bool('mus_allowSkip'),
      allowRepeat: this.bool('mus_allowRepeat'),
    };
    const password = this.val('mus_password').trim();
    if (password) payload.lavalinkPassword = password;
    await this.saveServiceConfig('music', 'Music', payload);
  },

  fillModeration(cfg) {
    cfg = cfg || {};
    this.setBool('mod_enabled', cfg.enabled);
    const ch = cfg.logChannelId || '';
    const sel = document.getElementById('mod_logChannelId');
    if (sel) sel.value = ch;
    this.setVal('mod_logChannelIdManual', ch);
    this.setVal('mod_defaultReason', cfg.defaultReason || '');
  },

  async saveModerationConfig() {
    const manual = document.getElementById('mod_logChannelIdManual')?.value?.trim();
    const picked = document.getElementById('mod_logChannelId')?.value || '';
    await this.saveServiceConfig('moderation', 'Moderation', {
      enabled: this.bool('mod_enabled'),
      logChannelId: manual || picked,
      defaultReason: this.val('mod_defaultReason'),
    });
  },

  fillEconomy(cfg) {
    cfg = cfg || {};
    this.setBool('eco_enabled', cfg.enabled);
    this.setVal('eco_startingBalance', cfg.startingBalance ?? 0);
    this.setVal('eco_currencyName', cfg.currencyName || 'coins');
  },

  async saveEconomyConfig() {
    await this.saveServiceConfig('economy', 'Economy', {
      enabled: this.bool('eco_enabled'),
      startingBalance: this.num('eco_startingBalance', 0),
      currencyName: this.val('eco_currencyName') || 'coins',
    });
  },

  fillTempvc(cfg) {
    cfg = cfg || {};
    this.setBool('tvc_enabled', cfg.enabled);
    const map = [['tvc_createChannelId', 'tvc_createChannelIdManual', cfg.createChannelId], ['tvc_categoryId', 'tvc_categoryIdManual', cfg.categoryId], ['tvc_panelChannelId', 'tvc_panelChannelIdManual', cfg.panelChannelId]];
    for (const [selId, manualId, v] of map) {
      const sel = document.getElementById(selId);
      if (sel) sel.value = v || '';
      this.setVal(manualId, v || '');
    }
    this.setVal('tvc_panelMessageId', cfg.panelMessageId || '');
  },

  async saveTempvcConfig() {
    const get = (selId, manualId) => (document.getElementById(manualId)?.value?.trim() || document.getElementById(selId)?.value || '');
    await this.saveServiceConfig('tempvc', 'TempVC', {
      enabled: this.bool('tvc_enabled'),
      createChannelId: get('tvc_createChannelId', 'tvc_createChannelIdManual'),
      categoryId: get('tvc_categoryId', 'tvc_categoryIdManual'),
      panelChannelId: get('tvc_panelChannelId', 'tvc_panelChannelIdManual'),
      panelMessageId: this.val('tvc_panelMessageId'),
    });
  },

  fillAutomation(cfg) {
    cfg = cfg || {};
    this.setBool('auto_enabled', cfg.enabled);
  },

  async saveAutomationConfig() {
    await this.saveServiceConfig('automation', 'Automation', {
      enabled: this.bool('auto_enabled'),
    });
  },

  fillAnalytics(cfg) {
    cfg = cfg || {};
    this.setBool('ana_enabled', cfg.enabled !== false);
    this.setBool('ana_trackMessages', cfg.trackMessages === true);
  },

  async saveAnalyticsConfig() {
    await this.saveServiceConfig('analytics', 'Analytics', {
      enabled: this.bool('ana_enabled'),
      trackMessages: this.bool('ana_trackMessages'),
    });
  },

  fillCommunity(cfg) {
    if (!cfg) return;
    this._community = cfg;
    const w = cfg.welcome || {};
    const b = cfg.goodbye || {};
    this.setBool('wel_enabled', w.enabled);
    const welSel = document.getElementById('wel_channel');
    if (welSel) welSel.value = w.channel || '';
    this.setVal('wel_channelManual', w.channel || '');
    this.setVal('wel_message', w.message || '');
    this.setVal('wel_imageMessage', w.welcomeImageMessage || 'Welcome {username} to {server}!');
    this.setBool('wel_sendImage', w.sendImage !== false);
    this.setBool('wel_embed', w.embed !== false);
    this.setBool('bye_enabled', b.enabled);
    const byeSel = document.getElementById('bye_channel');
    if (byeSel) byeSel.value = b.channel || '';
    this.setVal('bye_channelManual', b.channel || '');
    this.setVal('bye_message', b.message || '');
  },

  async saveCommunityConfig() {
    const getCh = (selId, manualId) => (document.getElementById(manualId)?.value?.trim() || document.getElementById(selId)?.value || '');
    const payload = {
      welcome: {
        enabled: this.bool('wel_enabled'),
        channel: getCh('wel_channel', 'wel_channelManual'),
        message: this.val('wel_message'),
        embed: this.bool('wel_embed'),
        sendImage: this.bool('wel_sendImage'),
        welcomeImageMessage: this.val('wel_imageMessage'),
      },
      goodbye: {
        enabled: this.bool('bye_enabled'),
        channel: getCh('bye_channel', 'bye_channelManual'),
        message: this.val('bye_message'),
        embed: true,
      },
      autoroles: this._community?.autoroles || { enabled: false, defaultRole: '', configurable: false },
    };
    await this.saveServiceConfig('community', 'Welcome', payload);
  },

  async testWelcome() {
    const channelId = (document.getElementById('wel_channelManual')?.value?.trim()) || document.getElementById('wel_channel')?.value || '';
    try {
      await this.request('/cards/test', { method: 'POST', body: JSON.stringify({ type: 'welcome', channelId, welcomeMessage: this.val('wel_imageMessage') }) });
      this.showAlert('Test welcome sent!', 'success');
    } catch (err) {
      this.showAlert(err.message || 'Failed to send test welcome', 'error');
    }
  },

  // ---------- Cards editor (welcome image + rank cards) ----------
  setupCardEditors() {
    // live preview on any card control change (debounced server render)
    const ids = [
      'card_welcome_bgStart', 'card_welcome_bgEnd', 'card_welcome_accent', 'card_welcome_accent2',
      'card_welcome_bgImage', 'card_welcome_overlay', 'card_welcome_showCount',
      'card_welcome_sampleText', 'card_welcome_sampleName',
      'card_rank_bgStart', 'card_rank_bgEnd', 'card_rank_accent', 'card_rank_accent2',
      'card_rank_rank', 'card_rank_level', 'card_rank_bgImage', 'card_rank_overlay', 'card_rank_showGuild',
    ];
    for (const id of ids) {
      const el = document.getElementById(id);
      if (!el) continue;
      el.addEventListener('input', () => this.onCardInput());
      el.addEventListener('change', () => this.onCardInput());
    }
    const overlayW = document.getElementById('card_welcome_overlay');
    overlayW?.addEventListener('input', () => { const v = document.getElementById('card_welcome_overlayVal'); if (v) v.textContent = overlayW.value; });
    const overlayR = document.getElementById('card_rank_overlay');
    overlayR?.addEventListener('input', () => { const v = document.getElementById('card_rank_overlayVal'); if (v) v.textContent = overlayR.value; });
  },

  onCardInput() {
    clearTimeout(this._cardsPreviewTimers.welcome);
    clearTimeout(this._cardsPreviewTimers.rank);
    this._cardsPreviewTimers.welcome = setTimeout(() => this.previewCard('welcome'), 350);
    this._cardsPreviewTimers.rank = setTimeout(() => this.previewCard('rank'), 350);
  },

  collectCardEditor() {
    return {
      welcome: {
        enabled: true,
        backgroundImage: this.val('card_welcome_bgImage'),
        bgGradientStart: this.val('card_welcome_bgStart') || '#1e1f3a',
        bgGradientEnd: this.val('card_welcome_bgEnd') || '#171831',
        accent: this.val('card_welcome_accent') || '#ef4444',
        accentSecondary: this.val('card_welcome_accent2') || '#f97316',
        textColor: '#ffffff',
        subTextColor: '#b9bbbe',
        overlayOpacity: this.num('card_welcome_overlay', 0.55),
        showMemberCount: this.bool('card_welcome_showCount'),
        avatarRingWidth: 3,
      },
      rank: {
        enabled: true,
        backgroundImage: this.val('card_rank_bgImage'),
        bgGradientStart: this.val('card_rank_bgStart') || '#1e1f3a',
        bgGradientEnd: this.val('card_rank_bgEnd') || '#171831',
        accent: this.val('card_rank_accent') || '#ef4444',
        accentSecondary: this.val('card_rank_accent2') || '#f97316',
        rankColor: this.val('card_rank_rank') || '#f0b232',
        levelColor: this.val('card_rank_level') || '#00b0f4',
        textColor: '#ffffff',
        subTextColor: '#b9bbbe',
        overlayOpacity: this.num('card_rank_overlay', 0.35),
        showGuildName: this.bool('card_rank_showGuild'),
      },
      leaderboard: this._cards?.leaderboard || { bgGradientStart: '#1e1f3a', bgGradientEnd: '#171831', accent: '#ef4444', gold: '#f0b232', silver: '#c0c6cf', bronze: '#cd7f32', textColor: '#ffffff', subTextColor: '#b9bbbe' },
    };
  },

  async loadCardsConfig() {
    try {
      const cfg = await this.request('/cards/config');
      this._cards = cfg;
      this.fillCards(cfg);
      await this.previewCard('welcome');
      await this.previewCard('rank');
    } catch (err) {
      console.error('Failed to load card config:', err);
      this.showAlert('Failed to load card design', 'error');
    }
  },

  fillCards(cfg) {
    if (!cfg) return;
    this._cards = cfg;
    const w = cfg.welcome || {};
    const r = cfg.rank || {};
    this.setColorPair('card_welcome_bgStart', 'card_welcome_bgStartPicker', w.bgGradientStart);
    this.setColorPair('card_welcome_bgEnd', 'card_welcome_bgEndPicker', w.bgGradientEnd);
    this.setColorPair('card_welcome_accent', 'card_welcome_accentPicker', w.accent);
    this.setColorPair('card_welcome_accent2', 'card_welcome_accent2Picker', w.accentSecondary);
    this.setVal('card_welcome_bgImage', w.backgroundImage || '');
    this.setVal('card_welcome_overlay', w.overlayOpacity ?? 0.55);
    const ovW = document.getElementById('card_welcome_overlayVal'); if (ovW) ovW.textContent = w.overlayOpacity ?? 0.55;
    this.setBool('card_welcome_showCount', w.showMemberCount !== false);

    this.setColorPair('card_rank_bgStart', 'card_rank_bgStartPicker', r.bgGradientStart);
    this.setColorPair('card_rank_bgEnd', 'card_rank_bgEndPicker', r.bgGradientEnd);
    this.setColorPair('card_rank_accent', 'card_rank_accentPicker', r.accent);
    this.setColorPair('card_rank_accent2', 'card_rank_accent2Picker', r.accentSecondary);
    this.setColorPair('card_rank_rank', 'card_rank_rankPicker', r.rankColor);
    this.setColorPair('card_rank_level', 'card_rank_levelPicker', r.levelColor);
    this.setVal('card_rank_bgImage', r.backgroundImage || '');
    this.setVal('card_rank_overlay', r.overlayOpacity ?? 0.35);
    const ovR = document.getElementById('card_rank_overlayVal'); if (ovR) ovR.textContent = r.overlayOpacity ?? 0.35;
    this.setBool('card_rank_showGuild', r.showGuildName !== false);
  },

  async previewCard(type) {
    const imgId = type === 'welcome' ? 'cardWelcomePreview' : 'cardRankPreview';
    const img = document.getElementById(imgId);
    if (!img) return;
    try {
      const template = this.collectCardEditor();
      const sample = type === 'welcome'
        ? { displayName: this.val('card_welcome_sampleName') || 'TestUser', guildName: 'Test Server', memberCount: 42, welcomeMessage: this.val('card_welcome_sampleText') || 'Welcome {username} to {server}!' }
        : { username: this.val('card_welcome_sampleName') || 'TestUser', guildName: 'Test Server' };
      const blob = await this.requestBlob('/cards/preview', { method: 'POST', body: JSON.stringify({ type, template, sample }) });
      const url = URL.createObjectURL(blob);
      const prev = img.src;
      img.src = url;
      if (prev && prev.startsWith('blob:')) setTimeout(() => URL.revokeObjectURL(prev), 5000);
    } catch (err) {
      console.error('Preview failed:', err);
    }
  },

  async saveCardsConfig() {
    try {
      const payload = this.collectCardEditor();
      const res = await fetch(`${API}/cards/config`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      this._cards = data.config;
      this.showAlert('Card design saved!', 'success');
    } catch (err) {
      this.showAlert(err.message || 'Failed to save card design', 'error');
    }
  },

  async testCard(type) {
    const channelId = (document.getElementById('wel_channelManual')?.value?.trim()) || document.getElementById('wel_channel')?.value || this.val('mod_logChannelId') || '';
    try {
      await this.request('/cards/test', { method: 'POST', body: JSON.stringify({ type, channelId }) });
      this.showAlert(`Test ${type} card sent to Discord!`, 'success');
    } catch (err) {
      this.showAlert(err.message || 'Failed to send test card', 'error');
    }
  },

  fillTickets(cfg) {
    cfg = cfg || {};
    this._tickets = cfg;
    this.setBool('tix_enabled', cfg.enabled !== false);
    const catSel = document.getElementById('tix_category');
    if (catSel) catSel.value = cfg.category || '';
    this.setVal('tix_categoryManual', cfg.category || '');
    this._pendingTicketRoles = cfg.supportRoles || [];
    this.setVal('tix_categories', this.ticketCategoryLines(cfg.categories));
    if (this._cachedRoles?.length) this.renderRoleChecklist('tix_supportRolesUI', this._cachedRoles, this._pendingTicketRoles, (ids) => { this._pendingTicketRoles = ids; });
  },

  /** `key | Label | emoji | description` lines → category objects. */
  parseTicketCategories(text) {
    const out = [];
    for (const line of String(text || '').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const parts = trimmed.split('|').map(p => p.trim());
      if (parts.length < 2 || !parts[0] || !parts[1]) continue;
      out.push({
        key: parts[0].toLowerCase().replace(/[^a-z0-9_-]/g, ''),
        label: parts[1],
        emoji: parts[2] || 'ticket',
        description: parts[3] || '',
      });
    }
    return out;
  },

  /** Category objects → `key | Label | emoji | description` lines. */
  ticketCategoryLines(categories) {
    return (categories || []).map(c => `${c.key} | ${c.label} | ${c.emoji || ''} | ${c.description || ''}`).join('\n');
  },
  async saveTicketsConfig() {
    const manual = document.getElementById('tix_categoryManual')?.value?.trim();
    const picked = document.getElementById('tix_category')?.value || '';
    await this.saveServiceConfig('tickets', 'Tickets', {
      enabled: this.bool('tix_enabled'),
      category: manual || picked,
      supportRoles: this._pendingTicketRoles || [],
      closeVote: false,
      categories: this.parseTicketCategories(this.val('tix_categories')),
    });
  },

  fillStaffApps(cfg) {
    cfg = cfg || {};
    this._staffapps = cfg;
    this.setBool('sapp_enabled', cfg.enabled !== false);
    const panelSel = document.getElementById('sapp_panelChannel');
    if (panelSel) panelSel.value = cfg.panelChannelId || '';
    this.setVal('sapp_panelChannelManual', cfg.panelChannelId || '');
    const reviewSel = document.getElementById('sapp_reviewChannel');
    if (reviewSel) reviewSel.value = cfg.reviewChannelId || '';
    this.setVal('sapp_reviewChannelManual', cfg.reviewChannelId || '');
    this.setVal('sapp_questions', (cfg.questions || []).join('\n'));
    this.setVal('sapp_roleDescriptions', this.roleDescriptionLines(cfg.roleDescriptions));
    this._pendingAppRoles = cfg.staffRoles || [];
    this._pendingApproverRoles = cfg.approverRoleIds || [];
    if (this._cachedRoles?.length) {
      this.renderRoleChecklist('sapp_staffRolesUI', this._cachedRoles, this._pendingAppRoles, (ids) => { this._pendingAppRoles = ids; });
      this.renderRoleChecklist('sapp_approverRolesUI', this._cachedRoles, this._pendingApproverRoles, (ids) => { this._pendingApproverRoles = ids; });
    }
  },
  fillPanels(cfg) {
    cfg = cfg || {};
    this._panels = cfg;
    this.setBool('panels_banner', cfg.banner !== false);
    this.setVal('panels_emojiGuild', cfg.emojiGuild || '');
    this.setVal('panels_emojiMap', cfg.emojiMap || '');
    this.setVal('panels_accent', cfg.accent || '');
    this.loadPanelEmojis();
    this.loadPanelFonts();
  },

  async loadPanelFonts() {
    const list = document.getElementById('panels_fontList');
    if (!list) return;
    try {
      const data = await this.request('/panels/fonts');
      const fonts = data.fonts || [];
      list.innerHTML = fonts.length
        ? fonts.map((f) => (
          `<span class="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs ${f.available ? 'bg-slate-800/60 text-slate-300' : 'bg-amber-500/10 text-amber-300'}">
            <span>${f.available ? '✓' : '↓'}</span><span>${f.alias}</span>
          </span>`
        )).join('')
        : '<span class="hint">No font information available.</span>';
    } catch (err) {
      list.innerHTML = '<span class="hint">Could not load the font status.</span>';
    }
  },

  async savePanelsConfig() {
    await this.saveServiceConfig('panels', 'Panels', {
      banner: this.bool('panels_banner'),
      emojiGuild: this.val('panels_emojiGuild').trim(),
      emojiMap: this.val('panels_emojiMap'),
      accent: this.val('panels_accent').trim(),
    });
    this.loadPanelEmojis();
  },

  async loadPanelEmojis() {
    const list = document.getElementById('panels_emojiList');
    const picker = document.getElementById('panels_emojiPicker');
    const preview = document.getElementById('panels_emojiPreview');
    const badge = document.getElementById('panelsEmojiBadge');
    try {
      const data = await this.request('/panels/emojis');
      const custom = data.custom || [];
      if (badge) badge.textContent = `${data.count || 0} emoji`;

      if (list) {
        if (!custom.length) {
          list.innerHTML = '<span class="hint">No custom emoji loaded yet. Set the emoji server above and press Refresh.</span>';
        } else {
          list.innerHTML = custom.map((e) => (
            `<span class="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-slate-800/60 text-xs text-slate-300">
              <span>${e.value}</span><span class="text-slate-500">${e.name}</span>
            </span>`
          )).join('');
        }
      }

      // Picker — click a key to map it to the emoji of your choice.
      if (picker) {
        const keys = Object.keys(data.resolved || {});
        picker.innerHTML = keys.length
          ? keys.map((key) => (
            `<button type="button" onclick="app.usePanelEmoji('${key}')" class="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-slate-800/60 hover:bg-slate-700 text-xs text-slate-300">
              <span>${data.resolved[key]}</span><span class="text-slate-500">${key}</span>
            </button>`
          )).join('')
          : '<span class="hint">No emoji keys loaded yet.</span>';
      }

      if (preview) {
        const resolved = data.resolved || {};
        const entries = Object.entries(resolved).slice(0, 60);
        preview.innerHTML = entries.length
          ? entries.map(([key, value]) => (
            `<span class="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-slate-800/60 text-xs text-slate-300">
              <span>${value}</span><span class="text-slate-500">${key}</span>
            </span>`
          )).join('')
          : '<span class="hint">Nothing to preview yet.</span>';
      }
    } catch (err) {
      if (list) list.innerHTML = '<span class="hint">Could not load emoji list.</span>';
    }
  },

  /** Inserts `key = <emoji>` into the emoji map textarea. */
  usePanelEmoji(key) {
    const textarea = document.getElementById('panels_emojiMap');
    if (!textarea) return;
    const value = (this._panelEmojiValues && this._panelEmojiValues[key]) || '';
    if (!value) return;
    const line = `${key} = ${value}`;
    const current = textarea.value.replace(/\s*$/, '');
    textarea.value = current ? `${current}\n${line}` : line;
    textarea.focus();
  },

  async refreshPanelEmojis() {
    try {
      const result = await this.request('/panels/refresh-emojis', { method: 'POST' });
      this.showAlert(`Loaded ${result.count || 0} custom emoji from ${result.guild || 'the emoji server'}`, 'success');
      await this.loadPanelEmojis();
    } catch (err) {
      this.showAlert(err.message || 'Failed to refresh emoji', 'error');
    }
  },

  async saveStaffAppsConfig() {
    const questions = this.val('sapp_questions').split('\n').map(s => s.trim()).filter(Boolean).slice(0, 10);
    if (questions.length === 0) return this.showAlert('Add at least one application question.', 'error');
    const panelManual = document.getElementById('sapp_panelChannelManual')?.value?.trim();
    const panelPicked = document.getElementById('sapp_panelChannel')?.value || '';
    const reviewManual = document.getElementById('sapp_reviewChannelManual')?.value?.trim();
    const reviewPicked = document.getElementById('sapp_reviewChannel')?.value || '';
    if (!panelManual && !panelPicked) return this.showAlert('Pick a panel channel first.', 'error');
    await this.saveServiceConfig('staffapps', 'Staff Applications', {
      enabled: this.bool('sapp_enabled'),
      panelChannelId: panelManual || panelPicked,
      reviewChannelId: reviewManual || reviewPicked || panelManual || panelPicked,
      staffRoles: this._pendingAppRoles || [],
      approverRoleIds: this._pendingApproverRoles || [],
      questions,
      maxQuestionLength: 1000,
      roleDescriptions: this.parseRoleDescriptionLines(this.val('sapp_roleDescriptions')),
    });
  },

  /** `Role Name = pitch` lines → { roleId: pitch }. */
  parseRoleDescriptionLines(text) {
    const out = {};
    const roles = this._cachedRoles || [];
    for (const line of String(text || '').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx <= 0) continue;
      const key = trimmed.slice(0, idx).trim();
      const value = trimmed.slice(idx + 1).trim();
      if (!key || !value) continue;
      const role = roles.find(r => r.name.toLowerCase() === key.toLowerCase() || r.id === key);
      const roleId = role?.id || (/^\d+$/.test(key) ? key : '');
      if (roleId) out[roleId] = value;
    }
    return out;
  },

  /** { roleId: pitch } → `Role Name = pitch` lines. */
  roleDescriptionLines(map) {
    const roles = this._cachedRoles || [];
    return Object.entries(map || {}).map(([roleId, description]) => {
      const role = roles.find(r => r.id === roleId);
      return `${role ? role.name : roleId} = ${description}`;
    }).join('\n');
  },

  async saveModuleConfig() {
    const config = {
      leveling_enabled: document.getElementById('toggleLeveling').checked,
      ai_enabled: document.getElementById('toggleAI').checked,
      music_enabled: document.getElementById('toggleMusic').checked,
      economy_enabled: document.getElementById('toggleEconomy').checked,
    };
    try {
      await this.request('/config/guild_settings', { method: 'POST', body: JSON.stringify(config) });
      this.showAlert('Module settings saved', 'success');
    } catch (err) {
      this.showAlert(err.message || 'Failed to save module settings');
    }
  },

  async reloadConfig() {
    try {
      await this.request('/control/reload-commands', { method: 'POST' });
      this.showAlert('Commands reloaded', 'success');
    } catch (err) {
      this.showAlert(err.message || 'Failed to reload commands');
    }
  },

  async clearLogs() {
    try {
      await this.request('/logs', { method: 'DELETE' });
      this.showAlert('Logs cleared', 'success');
    } catch (err) {
      this.showAlert(err.message || 'Failed to clear logs');
    }
  },

  async confirmShutdown() {
    if (!confirm('Are you sure you want to shutdown the bot?')) return;
    try {
      await this.request('/control/shutdown', { method: 'POST' });
      this.showAlert('Shutting down...', 'info');
    } catch (err) {
      this.showAlert(err.message || 'Failed to shutdown');
    }
  },

  async confirmRestart() {
    if (!confirm('Are you sure you want to restart the bot?')) return;
    try {
      await this.request('/control/restart', { method: 'POST' });
      this.showAlert('Restarting...', 'info');
    } catch (err) {
      this.showAlert(err.message || 'Failed to restart');
    }
  },

  // ---------- Shared renderers for the system pages ----------

  sysGuild(selectId) {
    return document.getElementById(selectId)?.value || '';
  },

  sysMetrics(cards) {
    const list = (cards || []).filter(Boolean);
    if (!list.length) return '';
    return `<div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">${list.map((c) => `
      <div class="stat-card">
        <p class="text-slate-400 text-xs uppercase tracking-wider">${c.label}</p>
        <h3 class="text-2xl font-bold stat-number">${c.value}</h3>
        ${c.sub ? `<p class="text-xs text-slate-500 mt-1">${c.sub}</p>` : ''}
      </div>`).join('')}</div>`;
  },

  sysTable(columns, rows, emptyText = 'Nothing to show yet.') {
    if (!rows || rows.length === 0) {
      return `<div class="empty-state p-8 text-center text-slate-500">${emptyText}</div>`;
    }
    return `<div class="table-container"><table class="w-full text-left border-collapse">
      <thead><tr class="border-b border-white/5 text-slate-400 text-sm uppercase tracking-wider">
        ${columns.map((c) => `<th class="pb-4 font-medium ${c.align || ''}">${c.label}</th>`).join('')}
      </tr></thead>
      <tbody class="text-sm divide-y divide-white/5">
        ${rows.map((row) => `<tr class="hover:bg-white/5">${row.map((cell, i) => `<td class="py-3 px-2 ${columns[i]?.align || ''}">${cell}</td>`).join('')}</tr>`).join('')}
      </tbody>
    </table></div>`;
  },

  sysBadge(text, tone = 'neutral') {
    return `<span class="badge badge-${tone}">${this.escapeHtml(text)}</span>`;
  },

  sysDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString();
  },

  sysPerson(id, name) {
    const label = name || (id ? `Member ${String(id).slice(0, 6)}` : 'Unknown');
    return `<div class="font-medium text-slate-200">${this.escapeHtml(label)}</div><div class="text-xs text-slate-500 font-mono">${this.escapeHtml(id || '')}</div>`;
  },

  sysError(err) {
    return `<div class="empty-state p-8 text-center text-red-400">${this.escapeHtml(err?.message || 'Failed to load data.')}</div>`;
  },

  sysEmpty(message) {
    return `<div class="empty-state p-8 text-center text-slate-500">${this.escapeHtml(message)}</div>`;
  },

  async sysChannelOptions(guildId, selected, { textOnly = true } = {}) {
    let channels = [];
    try {
      const entry = await this.fetchGuildChannels(guildId);
      channels = entry?.channels ?? [];
    } catch { /* ignore */ }
    const usable = textOnly ? channels.filter((c) => c.type === 0 || c.type === 5) : channels;
    const options = usable.map((c) => {
      const name = c.type === 0 ? `#${c.name}` : c.name;
      const sel = String(selected) === String(c.id) ? ' selected' : '';
      return `<option value="${this.escapeHtml(c.id)}"${sel}>${this.escapeHtml(name)}</option>`;
    }).join('');
    return `<option value="">Not set</option>${options}`;
  },

  // ---------- Tickets ----------

  async loadTickets() {
    const el = document.getElementById('ticketContent');
    if (!el) return;
    const guildId = this.sysGuild('ticketGuildSelect');
    if (!guildId) { el.innerHTML = this.sysEmpty('Select a server to view tickets.'); return; }
    const status = document.getElementById('ticketStatus')?.value || 'all';
    try {
      const tickets = await this.request(`/tickets?guildId=${guildId}&status=${status}`);
      const open = tickets.filter((t) => t.status === 'open').length;
      const claimed = tickets.filter((t) => t.assignedTo).length;
      const rows = tickets.map((t) => {
        const actions = [];
        if (t.status === 'open') {
          if (!t.assignedTo) actions.push(`<button onclick="app.ticketAction('${t.id}','claim')" class="btn-ghost text-xs">Claim</button>`);
          actions.push(`<button onclick="app.ticketAction('${t.id}','close')" class="btn-ghost text-xs">Close</button>`);
        } else {
          actions.push(`<button onclick="app.ticketAction('${t.id}','reopen')" class="btn-ghost text-xs">Reopen</button>`);
        }
        actions.push(`<button onclick="app.ticketAction('${t.id}','delete')" class="btn-ghost text-xs text-red-400">Delete</button>`);
        return [
          this.sysPerson(t.userId, t.username),
          this.sysBadge(t.status, t.status === 'open' ? 'success' : 'neutral'),
          this.escapeHtml(t.category || '—'),
          t.assignedTo ? this.sysPerson(t.assignedTo, t.assigneeName) : '<span class="text-slate-500">Unclaimed</span>',
          `<span class="text-xs text-slate-400">${this.sysDate(t.createdAt)}</span>`,
          `<div class="flex gap-1 justify-end">${actions.join('')}</div>`,
        ];
      });
      el.innerHTML = this.sysMetrics([
        { label: 'Tickets', value: this.formatNumber(tickets.length), sub: `filter: ${status}` },
        { label: 'Open', value: this.formatNumber(open) },
        { label: 'Claimed', value: this.formatNumber(claimed) },
        { label: 'Server', value: this.escapeHtml(guildId) },
      ]) + this.sysTable([
        { label: 'Member' }, { label: 'Status' }, { label: 'Category' }, { label: 'Assigned to' }, { label: 'Opened' }, { label: 'Actions', align: 'text-right' },
      ], rows, 'No tickets match this filter.');
    } catch (err) {
      el.innerHTML = this.sysError(err);
    }
  },

  async ticketAction(id, action) {
    if (action === 'delete' && !confirm('Delete this ticket and its channel?')) return;
    try {
      await this.request(`/tickets/${id}/${action}`, {
        method: 'POST',
        body: JSON.stringify({ reason: `Handled from the dashboard (${action})` }),
      });
      this.showAlert(`Ticket ${action} succeeded`, 'success');
      this.loadTickets();
    } catch (err) {
      this.showAlert(err.message || 'Ticket action failed', 'error');
    }
  },

  // ---------- Giveaways ----------

  async loadGiveaways() {
    const el = document.getElementById('giveawayContent');
    if (!el) return;
    const guildId = this.sysGuild('giveawayGuildSelect');
    if (!guildId) { el.innerHTML = this.sysEmpty('Select a server to view giveaways.'); return; }
    try {
      const list = await this.request(`/giveaways?guildId=${guildId}`);
      const active = list.filter((g) => g.status === 'active');
      const escrow = active.filter((g) => g.funded).reduce((sum, g) => sum + Number(g.prizeAmount || 0), 0);
      const entries = active.reduce((sum, g) => sum + Number(g.entryCount || 0), 0);
      const rows = list.map((g) => {
        const actions = [];
        if (g.status === 'active') {
          actions.push(`<button onclick="app.giveawayAction('${g.id}','end')" class="btn-ghost text-xs">End now</button>`);
          actions.push(`<button onclick="app.giveawayAction('${g.id}','cancel')" class="btn-ghost text-xs text-red-400">Cancel</button>`);
        } else if (g.status === 'ended' && !g.funded) {
          actions.push(`<button onclick="app.giveawayAction('${g.id}','reroll')" class="btn-ghost text-xs">Reroll</button>`);
        }
        const winners = (g.winnerIds || []).map((w) => `<span class="badge badge-info mr-1">${this.escapeHtml(String(w).slice(0, 8))}</span>`).join('');
        return [
          `<div class="font-medium text-slate-200">${this.escapeHtml(g.prize)}</div><div class="text-xs text-slate-500 font-mono">${this.escapeHtml(g.id)}</div>`,
          this.sysBadge(g.status, g.status === 'active' ? 'success' : 'neutral'),
          `${this.formatNumber(g.entryCount)} entries`,
          g.funded ? `${this.formatNumber(g.prizeAmount)} escrowed` : '<span class="text-slate-500">No prize pool</span>',
          `<span class="text-xs text-slate-400">${this.sysDate(g.endsAt)}</span>`,
          winners ? `<div class="text-xs">${winners}</div>` : '<span class="text-xs text-slate-500">—</span>',
          `<div class="flex gap-1 justify-end">${actions.join('')}</div>`,
        ];
      });
      el.innerHTML = this.sysMetrics([
        { label: 'Giveaways', value: this.formatNumber(list.length) },
        { label: 'Running', value: this.formatNumber(active.length) },
        { label: 'Entries', value: this.formatNumber(entries) },
        { label: 'In escrow', value: this.formatNumber(escrow) },
      ]) + this.sysTable([
        { label: 'Prize' }, { label: 'Status' }, { label: 'Entries' }, { label: 'Pool' }, { label: 'Ends' }, { label: 'Winners' }, { label: 'Actions', align: 'text-right' },
      ], rows, 'No giveaways yet — create one with /giveaway create.');
    } catch (err) {
      el.innerHTML = this.sysError(err);
    }
  },

  async giveawayAction(id, action) {
    if (action === 'cancel' && !confirm('Cancel this giveaway and refund the escrow?')) return;
    try {
      const result = await this.request(`/giveaways/${id}/${action}`, { method: 'POST', body: JSON.stringify({}) });
      this.showAlert(action === 'reroll' ? `New winners: ${(result.winners || []).join(', ') || 'none'}` : `Giveaway ${action} succeeded`, 'success');
      this.loadGiveaways();
    } catch (err) {
      this.showAlert(err.message || 'Giveaway action failed', 'error');
    }
  },

  // ---------- Economy games ----------

  async loadGames() {
    const el = document.getElementById('gameContent');
    if (!el) return;
    const guildId = this.sysGuild('gameGuildSelect');
    if (!guildId) { el.innerHTML = this.sysEmpty('Select a server to view games.'); return; }
    try {
      const games = await this.request(`/games?guildId=${guildId}`);
      const active = games.filter((g) => g.status !== 'finished');
      const pool = active.reduce((sum, g) => sum + Number(g.prizePool || 0), 0);
      const rows = games.map((g) => {
        const actions = [];
        if (g.status !== 'finished') {
          actions.push(`<button onclick="app.gameAction('${g.id}')" class="btn-ghost text-xs">End now</button>`);
        }
        return [
          `<div class="font-medium text-slate-200">${this.escapeHtml(String(g.type || 'game').replace(/_/g, ' '))}</div><div class="text-xs text-slate-500 font-mono">${this.escapeHtml(g.id)}</div>`,
          this.sysBadge(g.status, g.status === 'finished' ? 'neutral' : 'success'),
          `${this.formatNumber(g.prizePool)} pool`,
          `${this.formatNumber(g.entryFee)} fee`,
          `${g.playerCount} players`,
          `<span class="text-xs text-slate-400">${this.sysDate(g.endsAt)}</span>`,
          `<div class="flex gap-1 justify-end">${actions.join('')}</div>`,
        ];
      });
      el.innerHTML = this.sysMetrics([
        { label: 'Games', value: this.formatNumber(games.length) },
        { label: 'Running', value: this.formatNumber(active.length) },
        { label: 'Players', value: this.formatNumber(games.reduce((s, g) => s + Number(g.playerCount || 0), 0)) },
        { label: 'Prize pool', value: this.formatNumber(pool) },
      ]) + this.sysTable([
        { label: 'Game' }, { label: 'Status' }, { label: 'Pool' }, { label: 'Fee' }, { label: 'Players' }, { label: 'Ends' }, { label: 'Actions', align: 'text-right' },
      ], rows, 'No games running. Start one with /dice, /coinflip or /giveaway_game.');
    } catch (err) {
      el.innerHTML = this.sysError(err);
    }
  },

  async gameAction(id) {
    if (!confirm('End this game now? The winner is picked and the pool is paid out.')) return;
    try {
      const result = await this.request(`/games/${id}/end`, { method: 'POST', body: JSON.stringify({}) });
      this.showAlert(result.winnerId ? `Winner: ${result.winnerUsername || result.winnerId}` : 'No winner — the pool was refunded', 'success');
      this.loadGames();
    } catch (err) {
      this.showAlert(err.message || 'Could not end the game', 'error');
    }
  },

  // ---------- Staff applications ----------

  async loadStaffApps() {
    const el = document.getElementById('staffContent');
    if (!el) return;
    const guildId = this.sysGuild('staffGuildSelect');
    if (!guildId) { el.innerHTML = this.sysEmpty('Select a server to view applications.'); return; }
    const status = document.getElementById('staffStatus')?.value || 'pending';
    try {
      const apps = await this.request(`/staffapps?guildId=${guildId}&status=${status}`);
      this._staffApps = apps;
      const rows = apps.map((app) => {
        const actions = [`<button onclick="app.viewStaffApp('${app.id}')" class="btn-ghost text-xs">Answers</button>`];
        if (app.status === 'pending') {
          actions.push(`<button onclick="app.staffAction('${app.id}','approve')" class="btn-ghost text-xs text-green-400">Approve</button>`);
          actions.push(`<button onclick="app.staffAction('${app.id}','deny')" class="btn-ghost text-xs text-red-400">Deny</button>`);
        }
        return [
          this.sysPerson(app.userId, app.username),
          `<span class="font-mono text-xs text-slate-300">${this.escapeHtml(app.roleId)}</span>`,
          this.sysBadge(app.status, app.status === 'approved' ? 'success' : app.status === 'denied' ? 'danger' : 'warning'),
          `<span class="text-xs text-slate-400">${this.sysDate(app.createdAt)}</span>`,
          app.reviewerId ? `<span class="text-xs text-slate-400 font-mono">${this.escapeHtml(app.reviewerId)}</span>` : '<span class="text-slate-500">—</span>',
          `<div class="flex gap-1 justify-end">${actions.join('')}</div>`,
        ];
      });
      el.innerHTML = this.sysMetrics([
        { label: 'Applications', value: this.formatNumber(apps.length), sub: `filter: ${status}` },
        { label: 'Pending', value: this.formatNumber(apps.filter((a) => a.status === 'pending').length) },
        { label: 'Approved', value: this.formatNumber(apps.filter((a) => a.status === 'approved').length) },
        { label: 'Denied', value: this.formatNumber(apps.filter((a) => a.status === 'denied').length) },
      ]) + this.sysTable([
        { label: 'Applicant' }, { label: 'Role' }, { label: 'Status' }, { label: 'Submitted' }, { label: 'Reviewer' }, { label: 'Actions', align: 'text-right' },
      ], rows, 'No applications with this status.');
    } catch (err) {
      el.innerHTML = this.sysError(err);
    }
  },

  viewStaffApp(id) {
    const app = (this._staffApps || []).find((a) => a.id === id);
    if (!app) return;
    const answers = (app.answers || []).map((a) => `
      <div class="border-b border-white/5 py-2">
        <div class="text-xs uppercase tracking-wider text-slate-400">${this.escapeHtml(a.question || 'Question')}</div>
        <div class="text-sm text-slate-200 mt-1">${this.escapeHtml(a.answer || '—')}</div>
      </div>`).join('');
    this.showModal('staffAppModal', `
      <div class="space-y-2 text-sm">
        <div class="flex justify-between"><span class="text-slate-400">Applicant</span><span class="font-mono">${this.escapeHtml(app.userId)}</span></div>
        <div class="flex justify-between"><span class="text-slate-400">Role</span><span class="font-mono">${this.escapeHtml(app.roleId)}</span></div>
        <div class="flex justify-between"><span class="text-slate-400">Status</span><span>${this.sysBadge(app.status)}</span></div>
        <div class="mt-3">${answers || '<div class="empty-state">No answers stored</div>'}</div>
      </div>`, 'Staff application');
  },

  async staffAction(id, action) {
    if (action === 'deny' && !confirm('Deny this application? The applicant is notified by DM.')) return;
    try {
      await this.request(`/staffapps/${id}/${action}`, { method: 'POST', body: JSON.stringify({}) });
      this.showAlert(`Application ${action}d`, 'success');
      this.loadStaffApps();
    } catch (err) {
      this.showAlert(err.message || 'Application review failed', 'error');
    }
  },

  // ---------- Temporary voice ----------

  async loadTempVC() {
    const el = document.getElementById('tempvcContent');
    if (!el) return;
    const guildId = this.sysGuild('tempvcGuildSelect');
    if (!guildId) { el.innerHTML = this.sysEmpty('Select a server to view temporary voice channels.'); return; }
    try {
      const data = await this.request(`/tempvc?guildId=${guildId}`);
      const instances = data.instances || [];
      const cfg = data.config;
      const rows = instances.map((i) => [
        `<div class="font-medium text-slate-200">${this.escapeHtml(i.channelName || i.channelId)}</div><div class="text-xs text-slate-500 font-mono">${this.escapeHtml(i.channelId)}</div>`,
        this.sysPerson(i.ownerId),
        i.memberCount === null ? '<span class="text-slate-500">—</span>' : `${i.memberCount} in room`,
        `<span class="text-xs text-slate-400">${this.sysDate(i.createdAt)}</span>`,
        `<div class="flex gap-1 justify-end"><button onclick="app.deleteTempVC('${i.channelId}')" class="btn-ghost text-xs text-red-400">Delete</button></div>`,
      ]);
      el.innerHTML = this.sysMetrics([
        { label: 'Status', value: cfg ? (cfg.enabled ? 'Enabled' : 'Disabled') : 'Not set up', sub: 'join-to-create' },
        { label: 'Live rooms', value: this.formatNumber(instances.length) },
        { label: 'Hub channel', value: cfg?.createChannelId ? this.escapeHtml(String(cfg.createChannelId).slice(0, 8)) : '—' },
        { label: 'Category', value: cfg?.categoryId ? this.escapeHtml(String(cfg.categoryId).slice(0, 8)) : '—' },
      ]) + this.sysTable([
        { label: 'Channel' }, { label: 'Owner' }, { label: 'Members' }, { label: 'Created' }, { label: 'Actions', align: 'text-right' },
      ], rows, 'No temporary voice channels are live right now.');
    } catch (err) {
      el.innerHTML = this.sysError(err);
    }
  },

  async deleteTempVC(channelId) {
    if (!confirm('Delete this temporary voice channel?')) return;
    try {
      await this.request(`/tempvc/${channelId}`, { method: 'DELETE' });
      this.showAlert('Temporary voice channel deleted', 'success');
      this.loadTempVC();
    } catch (err) {
      this.showAlert(err.message || 'Could not delete the channel', 'error');
    }
  },

  // ---------- Community (welcome / goodbye / autoroles) ----------

  async loadCommunity() {
    const el = document.getElementById('communityContent');
    if (!el) return;
    const guildId = this.sysGuild('communityGuildSelect');
    if (!guildId) { el.innerHTML = this.sysEmpty('Select a server to configure community messages.'); return; }
    try {
      const data = await this.request(`/community?guildId=${guildId}`);
      const welcomeOptions = await this.sysChannelOptions(guildId, data.welcome.channel);
      const goodbyeOptions = await this.sysChannelOptions(guildId, data.goodbye.channel);
      el.innerHTML = `
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div class="stat-card">
            <h3 class="font-bold text-lg mb-4">Welcome message</h3>
            <div class="space-y-4">
              <label class="flex items-center gap-2 text-sm text-slate-300">
                <input type="checkbox" id="cmWelcomeEnabled" ${data.welcome.enabled ? 'checked' : ''}> Enable welcome messages
              </label>
              <div>
                <label class="field-label">Channel</label>
                <select id="cmWelcomeChannel" class="input-field">${welcomeOptions}</select>
              </div>
              <div>
                <label class="field-label">Message</label>
                <textarea id="cmWelcomeMessage" class="input-field" rows="3">${this.escapeHtml(data.welcome.message || '')}</textarea>
                <p class="hint">Placeholders: {user}, {username}, {server}, {count}</p>
              </div>
            </div>
          </div>
          <div class="stat-card">
            <h3 class="font-bold text-lg mb-4">Goodbye message</h3>
            <div class="space-y-4">
              <label class="flex items-center gap-2 text-sm text-slate-300">
                <input type="checkbox" id="cmGoodbyeEnabled" ${data.goodbye.enabled ? 'checked' : ''}> Enable goodbye messages
              </label>
              <div>
                <label class="field-label">Channel</label>
                <select id="cmGoodbyeChannel" class="input-field">${goodbyeOptions}</select>
              </div>
              <div>
                <label class="field-label">Message</label>
                <textarea id="cmGoodbyeMessage" class="input-field" rows="3">${this.escapeHtml(data.goodbye.message || '')}</textarea>
              </div>
            </div>
          </div>
        </div>
        <div class="stat-card mt-6">
          <h3 class="font-bold text-lg mb-4">Autoroles</h3>
          <div class="space-y-4">
            <label class="flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" id="cmAutorolesEnabled" ${data.autoroles.enabled ? 'checked' : ''}> Grant roles automatically on join
            </label>
            <div>
              <label class="field-label">Role IDs (comma separated)</label>
              <input type="text" id="cmAutoroleIds" class="input-field" value="${this.escapeHtml((data.autoroles.roleIds || []).join(', '))}" placeholder="123456789012345678, 987654321098765432">
            </div>
            <button onclick="app.saveCommunitySettings()" class="btn-primary">Save community settings</button>
            <p class="hint">Values are stored per server in <code>guild_settings</code> and override the global defaults.</p>
          </div>
        </div>`;
    } catch (err) {
      el.innerHTML = this.sysError(err);
    }
  },

  async saveCommunitySettings() {
    const guildId = this.sysGuild('communityGuildSelect');
    if (!guildId) return;
    const roleIds = (document.getElementById('cmAutoroleIds')?.value || '')
      .split(',').map((v) => v.trim()).filter(Boolean);
    const payload = {
      guildId,
      welcome: {
        enabled: document.getElementById('cmWelcomeEnabled')?.checked,
        channel: document.getElementById('cmWelcomeChannel')?.value || '',
        message: document.getElementById('cmWelcomeMessage')?.value || '',
      },
      goodbye: {
        enabled: document.getElementById('cmGoodbyeEnabled')?.checked,
        channel: document.getElementById('cmGoodbyeChannel')?.value || '',
        message: document.getElementById('cmGoodbyeMessage')?.value || '',
      },
      autoroles: {
        enabled: document.getElementById('cmAutorolesEnabled')?.checked,
        roleIds,
      },
    };
    try {
      await this.request('/community', { method: 'POST', body: JSON.stringify(payload) });
      this.showAlert('Community settings saved', 'success');
      this.loadCommunity();
    } catch (err) {
      this.showAlert(err.message || 'Failed to save community settings', 'error');
    }
  },

  // ---------- Automation ----------

  async loadAutomation() {
    const el = document.getElementById('automationContent');
    if (!el) return;
    const guildId = this.sysGuild('automationGuildSelect');
    if (!guildId) { el.innerHTML = this.sysEmpty('Select a server to manage automation jobs.'); return; }
    try {
      const jobs = await this.request(`/automation?guildId=${guildId}`);
      const channelOptions = await this.sysChannelOptions(guildId, '', { textOnly: false });
      const rows = jobs.map((job) => {
        const actions = [
          `<button onclick="app.automationAction('${job.id}','run')" class="btn-ghost text-xs">Run</button>`,
          `<button onclick="app.automationAction('${job.id}','toggle')" class="btn-ghost text-xs">${job.enabled ? 'Pause' : 'Enable'}</button>`,
          `<button onclick="app.automationAction('${job.id}','delete')" class="btn-ghost text-xs text-red-400">Delete</button>`,
        ];
        return [
          `<div class="font-medium text-slate-200">${this.escapeHtml(job.type)}</div><div class="text-xs text-slate-500 font-mono">${this.escapeHtml(job.id)}</div>`,
          `<span class="font-mono text-xs">${this.escapeHtml(job.cronExpression)}</span>`,
          this.sysBadge(job.enabled ? 'enabled' : 'paused', job.enabled ? 'success' : 'warning'),
          `<span class="text-xs text-slate-400">${this.sysDate(job.nextRun)}</span>`,
          `<span class="text-xs text-slate-400">${this.sysDate(job.lastRun)}</span>`,
          `<div class="flex gap-1 justify-end">${actions.join('')}</div>`,
        ];
      });
      el.innerHTML = `
        <div class="stat-card mb-6">
          <h3 class="font-bold text-lg mb-4">Schedule a new job</h3>
          <div class="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label class="field-label">Type</label>
              <select id="autoType" class="input-field">
                <option value="message">Message</option>
                <option value="embed">Embed</option>
                <option value="log">Log only</option>
              </select>
            </div>
            <div>
              <label class="field-label">Cron</label>
              <input type="text" id="autoCron" class="input-field" value="0 9 * * *" placeholder="0 9 * * *">
            </div>
            <div>
              <label class="field-label">Channel</label>
              <select id="autoChannel" class="input-field">${channelOptions}</select>
            </div>
            <div>
              <label class="field-label">Message</label>
              <input type="text" id="autoMessage" class="input-field" placeholder="Scheduled message">
            </div>
          </div>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
            <div>
              <label class="field-label">Embed title (embed jobs)</label>
              <input type="text" id="autoTitle" class="input-field" placeholder="Daily reminder">
            </div>
            <div>
              <label class="field-label">Embed description</label>
              <input type="text" id="autoDescription" class="input-field" placeholder="Optional description">
            </div>
          </div>
          <button onclick="app.createAutomationJob()" class="btn-primary mt-4">Create job</button>
          <p class="hint">5-field cron (minute hour day month weekday). The scheduler checks every 30 seconds.</p>
        </div>` + this.sysMetrics([
          { label: 'Jobs', value: this.formatNumber(jobs.length) },
          { label: 'Enabled', value: this.formatNumber(jobs.filter((j) => j.enabled).length) },
          { label: 'Paused', value: this.formatNumber(jobs.filter((j) => !j.enabled).length) },
          { label: 'Next run', value: jobs.length ? this.sysDate(jobs.map((j) => j.nextRun).sort()[0]) : '—' },
        ]) + this.sysTable([
          { label: 'Job' }, { label: 'Schedule' }, { label: 'State' }, { label: 'Next run' }, { label: 'Last run' }, { label: 'Actions', align: 'text-right' },
        ], rows, 'No automation jobs yet.');
    } catch (err) {
      el.innerHTML = this.sysError(err);
    }
  },

  async createAutomationJob() {
    const guildId = this.sysGuild('automationGuildSelect');
    if (!guildId) return;
    const payload = {
      guildId,
      type: document.getElementById('autoType')?.value || 'message',
      cron: document.getElementById('autoCron')?.value || '',
      channelId: document.getElementById('autoChannel')?.value || '',
      message: document.getElementById('autoMessage')?.value || '',
      title: document.getElementById('autoTitle')?.value || '',
      description: document.getElementById('autoDescription')?.value || '',
    };
    try {
      await this.request('/automation', { method: 'POST', body: JSON.stringify(payload) });
      this.showAlert('Automation job created', 'success');
      this.loadAutomation();
    } catch (err) {
      this.showAlert(err.message || 'Could not create the job', 'error');
    }
  },

  async automationAction(id, action) {
    if (action === 'delete' && !confirm('Delete this automation job?')) return;
    try {
      await this.request(`/automation/${id}/${action}`, { method: 'POST', body: JSON.stringify({}) });
      this.showAlert(`Job ${action} succeeded`, 'success');
      this.loadAutomation();
    } catch (err) {
      this.showAlert(err.message || 'Automation action failed', 'error');
    }
  },

  // ---------- AI ----------

  async loadAI() {
    const el = document.getElementById('aiContent');
    if (!el) return;
    const guildId = this.sysGuild('aiGuildSelect');
    if (!guildId) { el.innerHTML = this.sysEmpty('Select a server to view AI activity.'); return; }
    let status = null;
    let statusError = null;
    try {
      status = await this.request('/ai/status');
    } catch (err) {
      statusError = err.message;
    }
    let conversations = [];
    try {
      conversations = await this.request(`/ai/conversations?guildId=${guildId}`);
    } catch (err) {
      conversations = [];
    }
    const rows = conversations.map((c) => [
      this.sysPerson(c.userId),
      `<span class="font-mono text-xs text-slate-300">${this.escapeHtml(c.channelId)}</span>`,
      `${this.escapeHtml(c.provider)} · ${this.escapeHtml(c.model)}`,
      `${c.messageCount} messages`,
      `<span class="text-xs text-slate-400">${this.sysDate(c.updatedAt)}</span>`,
    ]);
    const tester = status ? `
      <div class="stat-card mt-6">
        <h3 class="font-bold text-lg mb-4">Test the assistant</h3>
        <div class="flex flex-col sm:flex-row gap-3">
          <input type="text" id="aiTestPrompt" class="input-field flex-1" placeholder="Ask something…">
          <button onclick="app.testAI()" class="btn-primary">Send</button>
        </div>
        <div id="aiTestResult" class="mt-4 text-sm text-slate-300"></div>
      </div>` : '';
    el.innerHTML = (statusError
      ? `<div class="stat-card mb-6 text-sm text-slate-400">AI status is restricted to the bot owner (${this.escapeHtml(statusError)}).</div>`
      : this.sysMetrics([
        { label: 'Provider', value: this.escapeHtml(status?.provider || '—'), sub: status?.model },
        { label: 'State', value: status?.enabled ? 'Enabled' : 'Disabled' },
        { label: 'API key', value: status?.hasApiKey ? 'Configured' : 'Missing' },
        { label: 'Conversations', value: this.formatNumber(conversations.length), sub: 'this server' },
      ])) + this.sysTable([
        { label: 'User' }, { label: 'Channel' }, { label: 'Model' }, { label: 'Messages' }, { label: 'Updated' },
      ], rows, 'No AI conversations recorded for this server yet.') + tester;
  },

  async testAI() {
    const prompt = (document.getElementById('aiTestPrompt')?.value || '').trim();
    if (!prompt) { this.showAlert('Type a prompt first', 'info'); return; }
    const result = document.getElementById('aiTestResult');
    if (result) result.textContent = 'Asking…';
    try {
      const guildId = this.sysGuild('aiGuildSelect');
      const response = await this.request('/ai/test', { method: 'POST', body: JSON.stringify({ prompt, guildId }) });
      if (result) result.textContent = response.message || 'No response';
    } catch (err) {
      if (result) result.textContent = '';
      this.showAlert(err.message || 'AI request failed', 'error');
    }
  },

  // ---------- Music ----------

  async loadMusic() {
    const el = document.getElementById('musicContent');
    if (!el) return;
    const guildId = this.sysGuild('musicGuildSelect');
    if (!guildId) { el.innerHTML = this.sysEmpty('Select a server to view playback.'); return; }
    let status = null;
    let statusError = null;
    try {
      status = await this.request('/music/status');
    } catch (err) {
      statusError = err.message;
    }
    let queue = { nowPlaying: null, queue: [], ready: false };
    try {
      queue = await this.request(`/music/queue?guildId=${guildId}`);
    } catch { /* node down */ }
    const rows = (queue.queue || []).map((track, index) => [
      `${index + 1}`,
      `<div class="font-medium text-slate-200">${this.escapeHtml(track.title || track.info?.title || 'Unknown')}</div><div class="text-xs text-slate-500">${this.escapeHtml(track.author || track.info?.author || '')}</div>`,
      `<span class="text-xs text-slate-400">${this.sysDate(track.duration || track.info?.length)}</span>`,
    ]);
    const nowPlaying = queue.nowPlaying?.track
      ? `<div class="stat-card mb-6"><p class="text-slate-400 text-xs uppercase tracking-wider">Now playing</p><h3 class="text-xl font-bold">${this.escapeHtml(queue.nowPlaying.track.title || queue.nowPlaying.track.info?.title || 'Unknown')}</h3><p class="text-sm text-slate-400">${queue.nowPlaying.paused ? 'Paused' : 'Playing'}</p>
          <div class="flex gap-2 mt-4">
            <button onclick="app.musicControl('skip')" class="btn-ghost text-xs">Skip</button>
            <button onclick="app.musicControl('pause')" class="btn-ghost text-xs">Pause</button>
            <button onclick="app.musicControl('resume')" class="btn-ghost text-xs">Resume</button>
            <button onclick="app.musicControl('stop')" class="btn-ghost text-xs text-red-400">Stop</button>
          </div></div>`
      : '';
    el.innerHTML = (statusError
      ? `<div class="stat-card mb-6 text-sm text-slate-400">Music status is restricted to the bot owner (${this.escapeHtml(statusError)}).</div>`
      : this.sysMetrics([
        { label: 'Node', value: status?.ready ? 'Connected' : 'Offline', sub: `${status?.host || 'localhost'}:${status?.port || 2333}` },
        { label: 'Enabled', value: status?.enabled ? 'Yes' : 'No' },
        { label: 'Players', value: this.formatNumber((status?.players || []).length) },
        { label: 'Queued', value: this.formatNumber((queue.queue || []).length) },
      ])) + nowPlaying + this.sysTable([
        { label: '#' }, { label: 'Track' }, { label: 'Length' },
      ], rows, 'The queue is empty.');
  },

  async musicControl(action) {
    const guildId = this.sysGuild('musicGuildSelect');
    if (!guildId) return;
    try {
      await this.request('/music/controls', { method: 'POST', body: JSON.stringify({ guildId, action }) });
      this.showAlert(`Music ${action} sent`, 'success');
      this.loadMusic();
    } catch (err) {
      this.showAlert(err.message || 'Music action failed', 'error');
    }
  },

  // ---------- Analytics ----------

  async loadAnalytics() {
    const el = document.getElementById('analyticsContent');
    if (!el) return;
    const guildId = this.sysGuild('analyticsGuildSelect');
    const days = document.getElementById('analyticsDays')?.value || '14';
    try {
      const data = await this.request(`/analytics?guildId=${guildId}&days=${days}`);
      const stats = data.stats || {};
      const series = data.series || [];
      const max = Math.max(1, ...series.map((p) => Number(p.messages || 0)));
      const chart = series.map((point) => {
        const height = Math.round((Number(point.messages || 0) / max) * 100);
        return `<div class="flex-1 flex flex-col items-center gap-1" title="${this.escapeHtml(point.date)}: ${point.messages || 0} messages, ${point.moderationCases || 0} moderation">
          <div class="w-full bg-white/5 rounded-t" style="height:120px;display:flex;align-items:flex-end">
            <div style="height:${Math.max(2, height)}%;width:100%;background:linear-gradient(180deg,#60a5fa,#2563eb);border-radius:4px 4px 0 0"></div>
          </div>
          <span class="text-[10px] text-slate-500">${this.escapeHtml(String(point.date).slice(5))}</span>
        </div>`;
      }).join('');
      el.innerHTML = this.sysMetrics([
        { label: 'Messages', value: this.formatNumber(stats.messages ?? stats.totalMessages ?? 0) },
        { label: 'Members', value: this.formatNumber(stats.trackedMembers ?? stats.totalUsers ?? 0) },
        { label: 'Moderation', value: this.formatNumber(stats.moderationCases ?? stats.totalModerationCases ?? 0) },
        { label: 'Economy', value: this.formatNumber(stats.economyTotalBalance ?? 0), sub: `${stats.economyAccounts ?? 0} wallets` },
      ]) + `<div class="stat-card mb-6"><h3 class="font-bold text-lg mb-4">Messages per day</h3><div class="flex items-end gap-1">${chart || '<div class="empty-state">No activity recorded</div>'}</div></div>`;
    } catch (err) {
      el.innerHTML = this.sysError(err);
    }
  },

  // ---------- System tiles on the dashboard ----------

  async loadSystemTiles() {
    const el = document.getElementById('systemTiles');
    if (!el) return;
    try {
      const data = await this.request('/systems/overview');
      const c = data.counts || {};
      const tiles = [
        { page: 'tickets', label: 'Tickets', value: c.tickets?.open ?? 0, sub: 'open now', tone: '#60a5fa' },
        { page: 'giveaways', label: 'Giveaways', value: c.giveaways?.active ?? 0, sub: 'running', tone: '#f472b6' },
        { page: 'games', label: 'Games', value: c.games?.active ?? 0, sub: 'in progress', tone: '#34d399' },
        { page: 'staffapps', label: 'Staff apps', value: c.staffapps?.pending ?? 0, sub: 'pending', tone: '#facc15' },
        { page: 'tempvc', label: 'Temp voice', value: c.tempvc?.instances ?? 0, sub: 'live rooms', tone: '#a78bfa' },
        { page: 'automation', label: 'Automation', value: c.automation?.enabled ?? 0, sub: 'jobs enabled', tone: '#22d3ee' },
        { page: 'ai', label: 'AI', value: c.ai?.conversations ?? 0, sub: 'conversations', tone: '#fb923c' },
        { page: 'music', label: 'Music', value: c.music?.sessions ?? 0, sub: 'sessions', tone: '#c084fc' },
        { page: 'moderation', label: 'Moderation', value: c.moderation?.cases ?? 0, sub: `${c.moderation?.warnings ?? 0} warnings`, tone: '#ef4444' },
        { page: 'economy', label: 'Economy', value: this.formatNumber(c.economy?.totalBalance ?? 0), sub: `${c.economy?.accounts ?? 0} wallets`, tone: '#fbbf24' },
        { page: 'leveling', label: 'Leveling', value: this.formatNumber(c.leveling?.profiles ?? 0), sub: 'ranked members', tone: '#38bdf8' },
        { page: 'analytics', label: 'Analytics', value: '↗', sub: 'open analytics', tone: '#94a3b8' },
      ];
      el.innerHTML = tiles.map((t) => `
        <button type="button" onclick="app.openPage('${t.page}')" class="stat-card text-left w-full">
          <p class="text-slate-400 text-xs uppercase tracking-wider">${t.label}</p>
          <h3 class="text-2xl font-bold stat-number" style="color:${t.tone}">${t.value}</h3>
          <p class="text-xs text-slate-500">${t.sub}</p>
        </button>`).join('');
    } catch (err) {
      el.innerHTML = `<div class="empty-state">${this.escapeHtml(err.message || 'Unable to load system state.')}</div>`;
    }
  },

  showUserMenu() {
    this.showModal('userModal', '<div class="text-sm text-slate-300">Signed in as dashboard admin.<br><br>Use the dashboard to configure every system — no JSON editing required.</div>', 'Account');
  },
};

document.addEventListener('DOMContentLoaded', () => app.init());
