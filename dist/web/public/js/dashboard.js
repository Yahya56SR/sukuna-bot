const API = '/api';

const PAGE_META = {
  dashboard: { title: 'Dashboard', subtitle: 'Live telemetry from your Discord community' },
  guilds: { title: 'Servers', subtitle: 'Every guild Sukuna is connected to' },
  moderation: { title: 'Moderation', subtitle: 'Warnings, kicks, bans and mutes' },
  economy: { title: 'Economy', subtitle: 'Balances, transactions and currency settings' },
  leveling: { title: 'Leveling', subtitle: 'Leaderboards, XP and rewards' },
  cards: { title: 'Cards', subtitle: 'Design welcome and rank cards' },
  settings: { title: 'Settings', subtitle: 'Configure every module of the bot' },
  system: { title: 'System', subtitle: 'Runtime, process and host diagnostics' },
};

const app = {
  currentPage: 'dashboard',
  intervalId: null,
  // caches for friendly pickers
  _guildCache: new Map(),
  _cards: null,
  _cardsPreviewTimers: {},
  _leveling: null,
  _community: null,
  _overview: null,

  init() {
    const hashPage = (window.location.hash || '').replace('#', '');
    const initialPage = PAGE_META[hashPage] ? hashPage : 'dashboard';

    this.setupNav();
    this.fetchStatus();
    this.fetchGuilds();
    this.loadOverview();
    this.startPolling();
    this.setupForms();
    this.setupColorPairs();
    this.setupCardEditors();

    if (initialPage !== 'dashboard') this.openPage(initialPage, false);
    this.setActiveNav(initialPage);
    window.addEventListener('hashchange', () => {
      const page = (window.location.hash || '').replace('#', '');
      if (PAGE_META[page] && page !== this.currentPage) this.openPage(page, false);
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
        this.openPage(page);
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
    this.currentPage = page;

    document.querySelectorAll('.page').forEach(el => el.classList.remove('active'));
    this.setActiveNav(page);

    // On phones the navigation is a collapsible menu; close it after choosing
    // a page so the content is visible immediately.
    this.toggleMobileNav(false);

    const target = document.getElementById(`page-${page}`);
    if (target) target.classList.add('active');

    const meta = PAGE_META[page];
    const title = document.getElementById('pageTitle');
    const subtitle = document.getElementById('pageSubtitle');
    if (title) title.textContent = meta.title;
    if (subtitle) subtitle.textContent = meta.subtitle;
    document.title = `Sukuna Bot — ${meta.title}`;

    if (updateHash && window.location.hash !== `#${page}`) {
      history.replaceState(null, '', `#${page}`);
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });

    if (page === 'dashboard') this.loadOverview();
    if (page === 'guilds') this.fetchGuilds();
    if (page === 'moderation') this.loadModeration();
    if (page === 'economy') this.loadEconomy();
    if (page === 'leveling') this.loadLeveling();
    if (page === 'cards') this.loadCardsConfig();
    if (page === 'system') this.fetchSystemInfo();
    if (page === 'settings') this.loadSettings();
  },

  async request(endpoint, options = {}) {
    try {
      const res = await fetch(`${API}${endpoint}`, {
        headers: { 'Content-Type': 'application/json', ...options.headers },
        ...options,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      console.error('API error:', err);
      throw err;
    }
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
    const lvl = document.getElementById('lvlGuildSelect')?.value;
    const mod = document.getElementById('modGuildSelect')?.value;
    return lvl || mod || '';
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
      const selects = ['modGuildSelect', 'lvlGuildSelect'];
      selects.forEach(id => {
        const sel = document.getElementById(id);
        if (!sel) return;
        const saved = sel.value;
        sel.innerHTML = '<option value="">Select a server</option>';
        guilds.forEach(g => {
          const opt = document.createElement('option');
          opt.value = g.id;
          opt.textContent = g.name;
          sel.appendChild(opt);
        });
        sel.value = saved;
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
      ['community', (cfg) => this.fillCommunity(cfg)],
      ['tickets', (cfg) => this.fillTickets(cfg)],
      ['staffapps', (cfg) => this.fillStaffApps(cfg)],
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
    if (this._cachedRoles?.length) this.renderRoleChecklist('tix_supportRolesUI', this._cachedRoles, this._pendingTicketRoles, (ids) => { this._pendingTicketRoles = ids; });
  },
  async saveTicketsConfig() {
    const manual = document.getElementById('tix_categoryManual')?.value?.trim();
    const picked = document.getElementById('tix_category')?.value || '';
    await this.saveServiceConfig('tickets', 'Tickets', {
      enabled: this.bool('tix_enabled'),
      category: manual || picked,
      supportRoles: this._pendingTicketRoles || [],
      closeVote: false,
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
    this._pendingAppRoles = cfg.staffRoles || [];
    this._pendingApproverRoles = cfg.approverRoleIds || [];
    if (this._cachedRoles?.length) {
      this.renderRoleChecklist('sapp_staffRolesUI', this._cachedRoles, this._pendingAppRoles, (ids) => { this._pendingAppRoles = ids; });
      this.renderRoleChecklist('sapp_approverRolesUI', this._cachedRoles, this._pendingApproverRoles, (ids) => { this._pendingApproverRoles = ids; });
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
    });
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

  showUserMenu() {
    this.showModal('userModal', '<div class="text-sm text-slate-300">Signed in as dashboard admin.<br><br>Use the dashboard to configure every system — no JSON editing required.</div>', 'Account');
  },
};

document.addEventListener('DOMContentLoaded', () => app.init());
