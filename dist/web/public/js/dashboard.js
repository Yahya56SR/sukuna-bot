const API = '/api';

const app = {
  currentPage: 'dashboard',
  intervalId: null,
  // caches for friendly pickers
  _guildCache: new Map(),
  _cards: null,
  _cardsPreviewTimers: {},
  _leveling: null,
  _community: null,

  init() {
    this.setupNav();
    this.fetchStatus();
    this.fetchGuilds();
    this.startPolling();
    this.setupForms();
    this.setupColorPairs();
    this.setupCardEditors();
  },

  setupNav() {
    document.querySelectorAll('[data-page]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const page = e.currentTarget.getAttribute('data-page');
        this.openPage(page);
      });
    });
  },

  openPage(page) {
    this.currentPage = page;

    document.querySelectorAll('.page').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.classList.toggle('text-white', btn.getAttribute('data-page') === page);
      btn.classList.toggle('text-slate-300', btn.getAttribute('data-page') !== page);
    });

    const target = document.getElementById(`page-${page}`);
    if (target) target.classList.add('active');

    if (page === 'dashboard') this.fetchStats();
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
    const div = document.createElement('div');
    div.className = `alert alert-${type}`;
    div.textContent = message;
    container.appendChild(div);
    setTimeout(() => div.remove(), 5000);
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
      document.getElementById('navStatus').textContent = data.ready ? 'Online' : 'Offline';
      document.getElementById('navStatus').className = data.ready ? 'text-green-400' : 'text-red-400';
      document.getElementById('statStatus').textContent = data.ready ? 'Online' : 'Offline';
      document.getElementById('statStatus').className = `text-3xl font-bold mt-1 stat-number ${data.ready ? 'text-green-400' : 'text-red-400'}`;
      document.getElementById('statGuilds').textContent = data.guilds ?? 0;
      document.getElementById('statUsers').textContent = data.users ?? 0;
      document.getElementById('statPing').textContent = data.ping ? `${data.ping}ms` : '--';
      if (data.memory) {
        const mb = (data.memory.heapUsed / 1024 / 1024).toFixed(1);
        document.getElementById('statMemory').textContent = `${mb} MB`;
      }
    } catch (err) {
      console.error('Failed to fetch status:', err);
      document.getElementById('navStatus').textContent = 'Offline';
      document.getElementById('navStatus').className = 'text-red-400';
      document.getElementById('statStatus').textContent = 'Offline';
    }
  },

  async fetchStats() {
    try {
      const data = await this.request('/stats');
      document.getElementById('statUptime').textContent = this.formatUptime(data.uptime ?? 0);
    } catch (err) {
      console.error('Failed to fetch stats:', err);
    }
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
        tr.className = 'group hover:bg-white/5 transition-colors';
        tr.innerHTML = `
          <td class="p-4">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center text-slate-400 text-xl">${g.icon ? `<img src="https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png" class="w-full h-full rounded-xl">` : '🏠'}</div>
              <div>
                <div class="font-medium text-slate-200">${g.name || 'Unknown Server'}</div>
                <div class="text-xs text-slate-500 font-mono">${g.id}</div>
              </div>
            </div>
          </td>
          <td class="p-4 text-center">${g.memberCount ?? 0}</td>
          <td class="p-4 text-center font-mono text-xs text-slate-400">${g.ownerId ?? '—'}</td>
          <td class="p-4 text-center">
            <span class="badge badge-info">${g.preferredTier ?? 0}</span>
          </td>
          <td class="p-4 text-right">
            <button onclick="app.viewGuild('${g.id}')" class="btn-ghost text-xs">View</button>
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
      const html = `
        <div class="space-y-4 text-sm">
          <div class="flex justify-between border-b border-white/5 pb-2">
            <span class="text-slate-400">Name</span>
            <span class="font-medium">${guild.name}</span>
          </div>
          <div class="flex justify-between border-b border-white/5 pb-2">
            <span class="text-slate-400">Member Count</span>
            <span class="font-medium font-mono">${guild.memberCount}</span>
          </div>
          <div class="flex justify-between border-b border-white/5 pb-2">
            <span class="text-slate-400">Owner ID</span>
            <span class="font-medium font-mono">${guild.ownerId}</span>
          </div>
          <div class="flex justify-between border-b border-white/5 pb-2">
            <span class="text-slate-400">Verification Level</span>
            <span class="font-medium">${guild.verificationLevel}</span>
          </div>
          <div class="flex justify-between pb-2">
            <span class="text-slate-400">Premium Tier</span>
            <span class="font-medium">${guild.preferredTier}</span>
          </div>
          <h4 class="font-bold text-slate-300 mb-2 mt-4">Channels (${guild.channels?.length ?? 0})</h4>
          <div class="space-y-1">
            ${(guild.channels ?? []).map(c => `<div class="flex justify-between p-2 rounded-lg bg-white/5 text-xs"><span class="font-mono text-slate-400"># ${c.name}</span><span class="badge badge-neutral">${c.type}</span></div>`).join('')}
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
      tbody.innerHTML = '<tr><td colspan="6" class="p-8 text-center text-slate-500">No moderation cases found</td></tr>';
      return;
    }

    const counts = { warn: 0, kick: 0, ban: 0, mute: 0 };
    cases.forEach(c => { if (counts[c.type] !== undefined) counts[c.type]++; });
    document.getElementById('modWarns').textContent = counts.warn;
    document.getElementById('modKicks').textContent = counts.kick;
    document.getElementById('modBans').textContent = counts.ban;
    document.getElementById('modMutes').textContent = counts.mute;

    cases.forEach(c => {
      const tr = document.createElement('tr');
      tr.className = 'group hover:bg-white/5 transition-colors';
      const typeBadge = c.type === 'warn' ? 'badge-warning' : c.type === 'kick' ? 'badge-danger' : c.type === 'ban' ? 'badge-danger' : 'badge-info';
      tr.innerHTML = `
        <td class="p-4">
          <div class="flex items-center gap-2">
            <div class="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-xs">👤</div>
            <span class="font-mono text-xs text-slate-400">${c.user_id}</span>
          </div>
        </td>
        <td class="p-4"><span class="badge ${typeBadge}">${c.type}</span></td>
        <td class="p-4 text-slate-300">${c.reason || '—'}</td>
        <td class="p-4 text-center font-mono text-xs text-slate-400">${c.moderator_id}</td>
        <td class="p-4 text-center text-slate-400 text-xs">${new Date(c.created_at).toLocaleDateString()}</td>
        <td class="p-4 text-right">
          <button onclick="app.viewCase('${c.id}')" class="btn-ghost text-xs">View</button>
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
      const balance = await this.request('/economy/balance/0');
      document.getElementById('econTotal').textContent = balance.balance ?? 0;
      document.getElementById('econUsers').textContent = '1';
      document.getElementById('econTxns').textContent = '0';
    } catch (err) {
      console.error('Failed to load economy:', err);
    }
  },

  async handleSetBalance(e) {
    e.preventDefault();
    const form = e.target;
    const data = { userId: form.userId.value, balance: parseFloat(form.balance.value) };
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
      const data = await this.request(`/economy/balance/${userId}`);
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
    users.forEach(u => {
      const lvl = u.level || 1;
      if (lvl > maxLevel) maxLevel = lvl;

      const tr = document.createElement('tr');
      tr.className = 'group hover:bg-white/5 transition-colors';
      tr.innerHTML = `
        <td class="p-4">
          <div class="flex items-center gap-3">
            <div class="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-xs">👤</div>
            <span class="font-mono text-xs text-slate-400">${u.id}</span>
          </div>
        </td>
        <td class="p-4 text-center font-mono font-bold">${lvl}</td>
        <td class="p-4 text-center">${(u.xp ?? 0).toLocaleString()}</td>
        <td class="p-4 text-center">${(u.total_xp ?? 0).toLocaleString()}</td>
        <td class="p-4 text-right">
          <button onclick="app.setXP('${u.id}')" class="btn-ghost text-xs">Edit</button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    document.getElementById('lvlUsers').textContent = users.length;
    document.getElementById('lvlMax').textContent = maxLevel;
    document.getElementById('lvlUps').textContent = users.filter(u => (u.level || 1) > 1).length;
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
      this.fetchStatus();
      if (this.currentPage === 'dashboard') this.fetchStats();
      if (this.currentPage === 'system') {
        this.fetchSystemInfo();
        this.fetchProcessInfo();
      }
    }, 5000);
  },

  stopPolling() {
    if (this.intervalId) clearInterval(this.intervalId);
  },

  refreshData(page) {
    if (page === 'guilds') this.fetchGuilds();
    if (page === 'moderation') this.loadModeration();
    if (page === 'economy') this.loadEconomy();
    if (page === 'leveling') this.loadLeveling();
    if (page === 'dashboard') this.fetchStats();
    this.showAlert('Data refreshed', 'success');
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
