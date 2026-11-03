/**
 * Sukuna — community persona driven by the Gemini Live API.
 *
 * Live models (e.g. `gemini-3.8-live`) only support real-time bidirectional
 * streaming (`bidiGenerateContent` over WebSocket), so every turn goes through
 * `GeminiLiveSukuna`. `generateContent` is never used.
 *
 * One Discord message = one Live turn that must end in a decision:
 * `send_message`, `send_sticker` or `stay_silent`.
 */

import type { Client, Guild, Message, TextChannel } from 'discord.js';
import {
  DEFAULT_DISPLAY_NAME,
  getSukunaConfig as readSukunaConfig,
  type SukunaConfig,
} from '../config/index.js';
import { buildSukunaRuntimePrompt, SUKUNA_DEFAULT_PROMPT } from '../prompts/sukuna.js';
import {
  GeminiLiveSukuna,
  type SukunaDecision,
  type SukunaMedia,
} from '../core/gemini-live.js';
import { buildSukunaToolDeclarations, createSukunaToolExecutor } from './sukuna-tools.js';
import { bumpCounter, recordActivity } from '../core/metrics.js';
import { collectSukunaMedia } from './sukuna-media.js';

const MAX_REPLY_LENGTH = 2000;

// In-memory channel history (context only)
const channelHistory = new Map<string, HistoryEntry[]>();
const channelHistoryIds = new Map<string, Set<string>>();

// Rate limiting state
let lastReplyAt = 0;
let lastDecisionAt = 0;
const replyTimestamps: number[] = [];
let apiKeyCache = '';

// One persistent Live session per configuration; recreated when config changes.
let liveClient: GeminiLiveSukuna | null = null;
let liveSignature = '';

interface HistoryEntry {
  id: string;
  authorId: string;
  authorName: string;
  content: string;
  timestamp: number;
  bot: boolean;
}

/**
 * Feed one Discord message to Sukuna.
 */
function handleMessage(message: Message): void {
  const cfg = getSukunaConfig();
  if (!cfg.enabled) return;
  if (!message.guild) return;
  if (!message.channel.isTextBased() || message.channel.isDMBased()) return;

  const channelId = message.channelId;
  if (!cfg.channelIds.includes(channelId)) return;

  // Bot messages only go to history
  if (message.author.bot) {
    addToHistory(message, cfg);
    return;
  }

  // Skip empty messages
  if (!message.content?.trim() && message.attachments.size === 0) return;

  addToHistory(message, cfg);
  void processMessage(message, cfg);
}

/**
 * Close Sukuna (for shutdown).
 */
function closeSukuna(): void {
  liveClient?.close();
  liveClient = null;
  liveSignature = '';
  channelHistory.clear();
  channelHistoryIds.clear();
}

/**
 * Check if Sukuna is active.
 */
function isSukunaActive(): boolean {
  return readSukunaConfig().enabled;
}

/**
 * Set API key.
 */
function setApiKey(key: string): void {
  apiKeyCache = key;
}

/**
 * Prime history from existing channels.
 */
function primeSukunaHistory(client: Client): void {
  // Placeholder
}

function addToHistory(message: Message, cfg: SukunaConfig): void {
  const content = describeMessage(message);
  if (!content) return;

  const entry: HistoryEntry = {
    id: message.id,
    authorId: message.author.id,
    authorName: message.member?.displayName || message.author.username,
    content,
    timestamp: message.createdTimestamp,
    bot: message.author.bot,
  };

  const channelId = message.channelId;
  let ids = channelHistoryIds.get(channelId);
  if (!ids) {
    ids = new Set<string>();
    channelHistoryIds.set(channelId, ids);
  }
  if (ids.has(entry.id)) return;
  ids.add(entry.id);

  let entries = channelHistory.get(channelId);
  if (!entries) {
    entries = [];
    channelHistory.set(channelId, entries);
  }
  entries.push(entry);
  if (entries.length > 100) {
    entries.splice(0, entries.length - 100);
  }
}

function describeMessage(message: Message): string {
  return message.content?.replace(/\s+/g, ' ').trim() || '';
}

function getSukunaConfig(): SukunaConfig {
  return readSukunaConfig();
}

/**
 * Reuse one Live session while the persona configuration is unchanged.
 */
function getLiveClient(cfg: SukunaConfig, apiKey: string, botId: string): GeminiLiveSukuna | null {
  const systemPrompt = buildSystemPrompt(cfg, botId);
  const tools = cfg.toolsEnabled === false ? [] : buildSukunaToolDeclarations(cfg);
  const signature = [
    apiKey,
    cfg.model,
    String(cfg.temperature),
    String(cfg.requestTimeoutMs),
    cfg.thinkingLevel ?? '',
    tools.map((tool) => tool.name).join(','),
    systemPrompt,
  ].join('|');

  if (liveClient && liveSignature === signature) return liveClient;

  liveClient?.close();
  liveClient = null;
  liveSignature = '';

  try {
    liveClient = new GeminiLiveSukuna({
      apiKey,
      model: cfg.model,
      systemPrompt,
      tools,
      thinkingLevel: cfg.thinkingLevel,
      temperature: cfg.temperature,
      requestTimeoutMs: cfg.requestTimeoutMs,
    });
    liveSignature = signature;
  } catch (error) {
    console.error('[Sukuna] Could not create the Live client:', error);
    return null;
  }

  return liveClient;
}

async function processMessage(message: Message, cfg: SukunaConfig): Promise<void> {
  if (isRateLimited(cfg)) return;
  if (cfg.decisionCooldownSeconds > 0 && Date.now() - lastDecisionAt < cfg.decisionCooldownSeconds * 1000) {
    return;
  }

  const apiKey = apiKeyCache || process.env.GEMINI_API_KEY || '';
  if (!apiKey) {
    console.warn('[Sukuna] Enabled but no Gemini API key');
    return;
  }

  const guild = message.guild;
  if (!guild) return;
  const channel = message.channel as TextChannel;

  const live = getLiveClient(cfg, apiKey, message.client.user?.id || '');
  if (!live) return;

  const executeTool = createSukunaToolExecutor({
    client: message.client,
    guild,
    channel,
    trigger: message,
  });

  let media: SukunaMedia[] = [];
  if (cfg.attachmentsEnabled) {
    media = await collectSukunaMedia([message]).catch(() => []);
  }

  const payload = buildPayload(guild, channel, channelHistory.get(message.channelId) ?? [], message);

  if (cfg.showTyping) {
    channel.sendTyping().catch(() => {});
  }

  let decision: SukunaDecision | null = null;
  try {
    decision = await live.ask(payload, executeTool, cfg.requestTimeoutMs, media);
  } catch (error) {
    console.error('[Sukuna] Live request failed:', error);
    bumpCounter('errors');
    recordActivity('error', 'AI reply failed', {
      level: 'error',
      meta: { guildId: message.guildId, channelId: message.channelId },
    });
    return;
  }

  lastDecisionAt = Date.now();

  if (!decision || decision.action !== 'reply') return;

  const sent = await deliverDecision(message, channel, decision, cfg);
  if (!sent) return;

  const now = Date.now();
  lastReplyAt = now;
  replyTimestamps.push(now);
  bumpCounter('aiReplies');

  recordActivity('ai', 'Replied in #' + (channel.name || 'channel'), {
    level: 'success',
    meta: {
      guildId: message.guildId,
      channelId: message.channelId,
      chars: decision.message.length,
      model: cfg.model,
    },
  });

  const sticker = decision.stickerId
    ? message.guild?.stickers.cache.get(decision.stickerId) ?? null
    : null;
  const historyContent =
    [
      decision.message.slice(0, MAX_REPLY_LENGTH).trim(),
      sticker ? `[sticker: ${sticker.name} (id: ${sticker.id})]` : '',
    ]
      .filter(Boolean)
      .join(' ')
      .trim() || '[reply]';

  addHistoryEntry(message.channelId, {
    id: sent.id,
    authorId: message.client.user?.id || 'unknown',
    authorName: cfg.displayName || DEFAULT_DISPLAY_NAME,
    content: historyContent,
    timestamp: now,
    bot: true,
  });

  // Voice is opt-in and only speaks in `tts` mode; when the guild runs a live
  // duplex conversation the model already answers out loud, so the text reply
  // would be spoken twice.
  if (message.guildId) {
    void speakReplyInVoice(message.guildId, decision.message.slice(0, MAX_REPLY_LENGTH), apiKey, cfg);
  }
}

/**
 * Loaded on demand on purpose: `@discordjs/voice` pulls in the native DAVE addon,
 * and a broken optional dependency there must not take the whole bot down.
 */
async function speakReplyInVoice(
  guildId: string,
  text: string,
  apiKey: string,
  cfg: SukunaConfig,
): Promise<void> {
  try {
    const [{ speakInVoice }, { resolveVoiceName }] = await Promise.all([
      import('../voice/manager.js'),
      import('../voice/speech.js'),
    ]);

    speakInVoice(guildId, text, {
      apiKey,
      model: cfg.model,
      voiceName: resolveVoiceName(),
      timeoutMs: cfg.requestTimeoutMs,
    });
  } catch (error) {
    console.warn('[Sukuna] Voice unavailable:', error instanceof Error ? error.message : error);
  }
}

/**
 * Send the decision's message/sticker and return the Discord message we created.
 */
async function deliverDecision(
  message: Message,
  channel: TextChannel,
  decision: SukunaDecision,
  cfg: SukunaConfig,
): Promise<Message | null> {
  const maxLength = Math.min(cfg.maxMessageLength || MAX_REPLY_LENGTH, MAX_REPLY_LENGTH);
  const content = decision.message.slice(0, maxLength).trim();

  const requestedSticker = decision.stickerId?.trim() ?? '';
  const sticker =
    requestedSticker && /^\d{15,25}$/.test(requestedSticker)
      ? message.guild?.stickers.cache.get(requestedSticker) ?? null
      : null;

  if (requestedSticker && !sticker) {
    console.warn('[Sukuna] Ignoring unknown sticker id:', requestedSticker);
  }

  if (!content && !sticker) return null;

  // Users may be pinged through <@ID> markup, but roles, @everyone and @here
  // stay silent. A native reply notifies the trigger author when chosen.
  const allowedMentions = {
    parse: ['users'] as const,
    repliedUser: Boolean(decision.replyToTrigger),
  };

  const payload = {
    content: content || undefined,
    allowedMentions,
    ...(sticker ? { stickers: [sticker.id] } : {}),
  };

  try {
    return decision.replyToTrigger
      ? await message.reply({ ...payload, failIfNotExists: false })
      : await channel.send(payload);
  } catch (error) {
    console.error('[Sukuna] Send failed:', error);
    return null;
  }
}

function buildSystemPrompt(cfg: SukunaConfig, botId: string): string {
  const runtime = buildSukunaRuntimePrompt({
    displayName: cfg.displayName || DEFAULT_DISPLAY_NAME,
    botId,
    toolsEnabled: cfg.toolsEnabled ?? true,
    memoryEnabled: cfg.memoryEnabled ?? true,
    maxMessageLength: MAX_REPLY_LENGTH,
  });
  const character = cfg.systemPrompt?.trim() || SUKUNA_DEFAULT_PROMPT;
  return character + '\n\n' + runtime;
}

function buildPayload(guild: Guild, channel: TextChannel, history: HistoryEntry[], trigger: Message): string {
  const recent = history.slice(-50);
  return [
    '<current_time>' + new Date().toISOString() + '</current_time>',
    '<server>' + guild.name + ' — ' + guild.memberCount + ' members</server>',
    '<channel>' + (channel.name || 'this channel') + '</channel>',
    '<recent_messages>' + (recent.length ? recent.map((e) => '[' + new Date(e.timestamp).toISOString().slice(11, 16) + '] ' + e.authorName + ': ' + e.content).join('\n') : '(no earlier messages)') + '</recent_messages>',
    '<latest_message>' + (trigger.author.displayName + ': ' + (trigger.content || '(empty)')) + '</latest_message>',
    '',
    'Respond naturally. Silence is acceptable if nothing needs saying.',
  ].join('\n');
}

function isRateLimited(cfg: SukunaConfig): boolean {
  const now = Date.now();
  if (cfg.replyCooldownSeconds > 0 && now - lastReplyAt < cfg.replyCooldownSeconds * 1000) {
    return true;
  }
  pruneTimestamps(now);
  return cfg.maxRepliesPerHour > 0 && replyTimestamps.length >= cfg.maxRepliesPerHour;
}

function pruneTimestamps(now: number): void {
  const cutoff = now - 60 * 60 * 1000;
  while (replyTimestamps.length > 0 && replyTimestamps[0] < cutoff) {
    replyTimestamps.shift();
  }
}

function addHistoryEntry(channelId: string, entry: HistoryEntry): void {
  let entries = channelHistory.get(channelId);
  if (!entries) {
    entries = [];
    channelHistory.set(channelId, entries);
  }
  let ids = channelHistoryIds.get(channelId);
  if (!ids) {
    ids = new Set<string>();
    channelHistoryIds.set(channelId, ids);
  }
  if (ids.has(entry.id)) return;
  ids.add(entry.id);
  entries.push(entry);
  if (entries.length > 100) {
    entries.splice(0, entries.length - 100);
  }
}

// Export handlers
export { handleMessage as handleSukunaMessage };
export { closeSukuna, isSukunaActive, primeSukunaHistory, setApiKey };
