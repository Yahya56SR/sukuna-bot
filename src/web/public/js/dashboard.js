const API = '/api';

const app = {
  currentPage: 'dashboard',
  intervalId: null,

  init() {
    this.setupNav();
    this.fetchStatus();
    this.fetchGuilds();
    this.startPolling();
    this.setupForms();
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
    if (page === 'system') this.fetchSystemInfo();
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

  showAlert(message, type = 'error') {
    const container = document.getElementById('alertContainer');
    const div = document.createElement('div');
    div.className = `alert alert-${type}`;
    div.textContent = message;
    container.appendChild(div);
    setTimeout(() => div.remove(), 5000);
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
      await this.request(`/config/${service}`, { method: 'POST', body: JSON.stringify(config) });
      this.showAlert('Configuration saved', 'success');
    } catch (err) {
      this.showAlert(err.message || 'Failed to save config');
    }
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
};

document.addEventListener('DOMContentLoaded', () => app.init());
