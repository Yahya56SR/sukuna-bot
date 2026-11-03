// Sukuna Dashboard JavaScript - Handles frontend interactions

const API_BASE = '/api';

let config = {};
let initialConfig = {};

// Form references
const enabledCheckbox = document.getElementById('enabled');
const displayNameInput = document.getElementById('displayName');
const modelSelect = document.getElementById('model');
const temperatureInput = document.getElementById('temperature');
const tempValueSpan = document.getElementById('temp-value');
const thinkingLevelSelect = document.getElementById('thinkingLevel');
const batchWindowInput = document.getElementById('batchWindow');
const batchValueSpan = document.getElementById('batch-value');
const historySizeInput = document.getElementById('historySize');
const historyValueSpan = document.getElementById('history-value');
const showTypingCheckbox = document.getElementById('showTyping');
const memoryEnabledCheckbox = document.getElementById('memoryEnabled');
const knowledgeEnabledCheckbox = document.getElementById('knowledgeEnabled');
const islamicEnabledCheckbox = document.getElementById('islamicEnabled');
const webEnabledCheckbox = document.getElementById('webEnabled');
const attachmentsEnabledCheckbox = document.getElementById('attachmentsEnabled');
const decisionCooldownInput = document.getElementById('decisionCooldown');
const decisionCooldownVal = document.getElementById('decision-cooldown-val');
const replyCooldownInput = document.getElementById('replyCooldown');
const replyCooldownVal = document.getElementById('reply-cooldown-val');
const maxRepliesInput = document.getElementById('maxReplies');
const maxRepliesVal = document.getElementById('max-replies-val');
const channelList = document.getElementById('channel-list');
const refreshChannelsBtn = document.getElementById('refresh-channels');
const testPrompt = document.getElementById('test-prompt');
const testBtn = document.getElementById('test-btn');
const testResult = document.getElementById('test-result');
const saveBtn = document.getElementById('save-btn');
const lastSaved = document.getElementById('last-saved');

// Helper functions
function formatValue(val) {
  if (val === 0) return '0s';
  if (val < 1 && val >= 0.1) return Math.round(val * 10) / 10 + 's';
  if (val < 1) return (val * 1000).toFixed(0) + 'ms';
  if (val < 60) return val + 's';
  return Math.round(val / 60) + 'm';
}

function updateValueDisplay(elementId, value, formatter = null) {
  const el = document.getElementById(elementId);
  if (el) el.textContent = formatter ? formatter(value) : value;
}

// Range input handlers
function bindRangeSlider(inputId, valueId, formatter = null) {
  const input = document.getElementById(inputId);
  const value = document.getElementById(valueId);
  input.addEventListener('input', () => {
    if (value) value.textContent = formatter ? formatter(input.value) : input.value;
  });
}

// Initialize range sliders
bindRangeSlider('temperature', 'temp-value', (v) => parseFloat(v).toFixed(1));
bindRangeSlider('batchWindow', 'batch-value', (v) => v + 'ms');
bindRangeSlider('historySize', 'history-value', (v) => v);
bindRangeSlider('decisionCooldown', 'decision-cooldown-val', formatValue);
bindRangeSlider('replyCooldown', 'reply-cooldown-val', formatValue);
bindRangeSlider('maxReplies', 'max-replies-val', (v) => v);

// Load config from API
async function loadConfig() {
  try {
    const response = await fetch(`${API_BASE}/config`);
    const data = await response.json();
    config = data;
    initialConfig = { ...data };
    updateUI();
    getStatus();
  } catch (err) {
    console.error('Failed to load config:', err);
  }
}

// Update UI with config values
function updateUI() {
  const s = config.sukuna || config;

  enabledCheckbox.checked = s.enabled ?? false;
  displayNameInput.value = s.displayName || 'Sukuna';
  modelSelect.value = s.model || 'gemini-3.1-flash';
  temperatureInput.value = s.temperature ?? 1;
  tempValueSpan.textContent = (s.temperature ?? 1).toFixed(1);
  thinkingLevelSelect.value = s.thinkingLevel || '';

  batchWindowInput.value = s.batchWindowMs ?? 500;
  batchValueSpan.textContent = (s.batchWindowMs ?? 500) + 'ms';
  historySizeInput.value = s.historySize ?? 50;
  historyValueSpan.textContent = s.historySize ?? 50;

  showTypingCheckbox.checked = s.showTyping ?? true;
  memoryEnabledCheckbox.checked = s.memoryEnabled ?? true;
  knowledgeEnabledCheckbox.checked = s.knowledgeEnabled ?? true;
  islamicEnabledCheckbox.checked = s.islamicEnabled ?? true;
  webEnabledCheckbox.checked = s.webEnabled ?? true;
  attachmentsEnabledCheckbox.checked = s.attachmentsEnabled ?? true;

  decisionCooldownInput.value = s.decisionCooldownSeconds ?? 2;
  decisionCooldownVal.textContent = formatValue(s.decisionCooldownSeconds ?? 2);
  replyCooldownInput.value = s.replyCooldownSeconds ?? 2;
  replyCooldownVal.textContent = formatValue(s.replyCooldownSeconds ?? 2);
  maxRepliesInput.value = s.maxRepliesPerHour ?? 10;
  maxRepliesVal.textContent = s.maxRepliesPerHour ?? 10;
}

// Save config
async function saveConfig() {
  const changes = {};
  const s = config.sukuna || config;

  if (enabledCheckbox.checked !== s.enabled) changes.enabled = enabledCheckbox.checked;
  if (displayNameInput.value !== s.displayName) changes.displayName = displayNameInput.value;
  if (modelSelect.value !== s.model) changes.model = modelSelect.value;
  if (temperatureInput.value !== String(s.temperature ?? 1)) changes.temperature = parseFloat(temperatureInput.value);
  if (thinkingLevelSelect.value !== (s.thinkingLevel || '')) {
    changes.thinkingLevel = thinkingLevelSelect.value || undefined;
  }
  if (batchWindowInput.value !== String(s.batchWindowMs ?? 500)) changes.batchWindowMs = parseInt(batchWindowInput.value);
  if (historySizeInput.value !== String(s.historySize ?? 50)) changes.historySize = parseInt(historySizeInput.value);
  if (showTypingCheckbox.checked !== s.showTyping) changes.showTyping = showTypingCheckbox.checked;
  if (memoryEnabledCheckbox.checked !== s.memoryEnabled) changes.memoryEnabled = memoryEnabledCheckbox.checked;
  if (knowledgeEnabledCheckbox.checked !== s.knowledgeEnabled) changes.knowledgeEnabled = knowledgeEnabledCheckbox.checked;
  if (islamicEnabledCheckbox.checked !== s.islamicEnabled) changes.islamicEnabled = islamicEnabledCheckbox.checked;
  if (webEnabledCheckbox.checked !== s.webEnabled) changes.webEnabled = webEnabledCheckbox.checked;
  if (attachmentsEnabledCheckbox.checked !== s.attachmentsEnabled) changes.attachmentsEnabled = attachmentsEnabledCheckbox.checked;
  if (decisionCooldownInput.value !== String(s.decisionCooldownSeconds ?? 2)) changes.decisionCooldownSeconds = parseFloat(decisionCooldownInput.value);
  if (replyCooldownInput.value !== String(s.replyCooldownSeconds ?? 2)) changes.replyCooldownSeconds = parseFloat(replyCooldownInput.value);
  if (maxRepliesInput.value !== String(s.maxRepliesPerHour ?? 10)) changes.maxRepliesPerHour = parseInt(maxRepliesInput.value);

  if (Object.keys(changes).length === 0) {
    alert('No changes to save!');
    return;
  }

  try {
    const newConfig = {
      sukuna: { ...s, ...changes }
    };
    const response = await fetch(`${API_BASE}/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newConfig),
    });

    if (response.ok) {
      config.sukuna = newConfig.sukuna;
      initialConfig = { ...config };
      lastSaved.textContent = 'Saved at ' + new Date().toLocaleTimeString();
      lastSaved.classList.add('saved');
      setTimeout(() => lastSaved.classList.remove('saved'), 3000);
    } else {
      throw new Error('Save failed');
    }
  } catch (err) {
    console.error(err);
    alert('Failed to save: ' + err.message);
  }
}

// Get bot status
async function getStatus() {
  try {
    const response = await fetch(`${API_BASE}/status`);
    const data = await response.json();
    document.getElementById('status').textContent = `Status: ${data.sukuna ? 'Active 🤖' : 'Inactive'} | Uptime: ${Math.floor(data.uptime)}s`;
  } catch (err) {
    document.getElementById('status').textContent = 'Status: Unable to connect';
  }
}

// Test persona
async function testPersona() {
  const prompt = testPrompt.value.trim();
  if (!prompt) {
    alert('Please enter a test prompt');
    return;
  }

  testResult.textContent = 'Testing...';
  testResult.className = '';

  try {
    // This would call the backend test endpoint
    // For now, just simulate a response
    await new Promise(resolve => setTimeout(resolve, 500));
    testResult.textContent = 'Persona test simulated. Check console for actual response.';
    testResult.classList.add('success');
  } catch (err) {
    testResult.textContent = 'Test failed: ' + err.message;
    testResult.classList.add('error');
  }
}

// Refresh channel list (placeholder)
async function refreshChannels() {
  // In a real implementation, this would fetch from the bot
  channelList.innerHTML = '<div class="channel-item">#general (configured)</div><div class="channel-item">#random</div>';
}

// Event listeners
saveBtn.addEventListener('click', saveConfig);
testBtn.addEventListener('click', testPersona);
refreshChannelsBtn.addEventListener('click', refreshChannels);

// Auto-save indicator
let lastSaveTimer = null;
function markDirty() {
  if (lastSaveTimer) clearTimeout(lastSaveTimer);
  lastSaveTimer = setTimeout(() => {
    lastSaved.textContent = 'Unsaved changes...';
    lastSaved.classList.remove('saved');
  }, 500);
}

// Bind dirty checking
[enabledCheckbox, displayNameInput, modelSelect, temperatureInput, thinkingLevelSelect,
 batchWindowInput, historySizeInput, showTypingCheckbox, memoryEnabledCheckbox,
 knowledgeEnabledCheckbox, islamicEnabledCheckbox, webEnabledCheckbox, attachmentsEnabledCheckbox,
 decisionCooldownInput, replyCooldownInput, maxRepliesInput].forEach(el => {
  el.addEventListener('input', markDirty);
  el.addEventListener('change', markDirty);
});

// Initial load
loadConfig();