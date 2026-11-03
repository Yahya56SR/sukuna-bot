/**
 * Sukuna — community persona with real-time streaming to/from Gemini.
 *
 * Each Discord message triggers ONE streaming Gemini call.
 * Chunks flow back to Discord immediately (edited into one message).
 * No persistent WebSocket, no batching.
 */

import type { TextChannel, Guild, Message, Client } from 'discord.js';
import { getSukunaConfig as readSukunaConfig, type SukunaConfig } from '../config/index.js';
import { buildSukunaRuntimePrompt, SUKUNA_DEFAULT_PROMPT } from '../prompts/sukuna.js';
import { GeminiStreamSukuna } from '../core/gemini-stream.js';
import { bumpCounter, recordActivity } from '../core/metrics.js';
import { addMemory, countMemories, recallMemories } from './sukuna-memory.js';
import { collectSukunaMedia } from './sukuna-media.js';

const MAX_REPLY_LENGTH = 2000;

// In-memory channel history (for context only, not batching)
const channelHistory = new Map<string, HistoryEntry[]>();
const channelHistoryIds = new Map<string, Set<string>>();

// Rate limiting state
let lastReplyAt = 0;
let lastDecisionAt = 0;
const replyTimestamps: number[] = [];
let apiKeyCache = '';

interface HistoryEntry {
  id: string;
  authorId: string;
  authorName: string;
  content: string;
  timestamp: number;
  bot: boolean;
}

/**
 * Feed one Discord message to Sukuna — starts a streaming response immediately.
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

  const channel = message.channel as TextChannel;
  const entries = channelHistory.get(message.channelId) ?? [];

  const guild = message.guild;
  if (!guild) return;

  const payload = buildPayload(guild, channel, entries, message);

  if (cfg.showTyping) {
    channel.sendTyping().catch(() => {});
  }

  let fullResponse = '';
  const state: { msg: Message | null } = { msg: null };
  let editLock = false;
  let lastEditAt = 0;

  try {
    const streamer = new GeminiStreamSukuna({
      apiKey,
      model: cfg.model || 'gemini-3.1-flash',
      systemPrompt: buildSystemPrompt(cfg, message.client.user?.id || ''),
      temperature: cfg.temperature,
      requestTimeoutMs: cfg.requestTimeoutMs,
    });

    // Stream chunks to Discord in real time
    await streamer.stream(payload, async (chunk) => {
      fullResponse += chunk;
      const now = Date.now();

      // Throttle: max one edit per second, serialize edits
      if (now - lastEditAt < 1000 || editLock) return;
      lastEditAt = now;
      editLock = true;

      try {
        const text = fullResponse.slice(0, MAX_REPLY_LENGTH).trim();
        if (!text) return;

        if (state.msg) {
          await state.msg.edit({ content: text }).catch(() => {});
        } else {
          state.msg = await message.reply({ content: text, failIfNotExists: false }).catch(() => {
            return channel.send({ content: text });
          }) as Message | null;
        }
      } catch (err) {
        console.error('[Sukuna] Stream edit/send failed:', err);
      } finally {
        editLock = false;
      }
    });

    lastDecisionAt = Date.now();
  } catch (err) {
    console.error('[Sukuna] Stream failed:', err);
    bumpCounter('errors');
    recordActivity('error', 'AI reply failed', {
      level: 'error',
      meta: { guildId: message.guildId, channelId: message.channelId },
    });
    return;
  }

  // Final edit to ensure complete message
  if (fullResponse.trim() && state.msg) {
    try {
      const finalText = fullResponse.slice(0, MAX_REPLY_LENGTH).trim();
      await state.msg.edit({ content: finalText }).catch(() => {});
    } catch (err) {
      console.error('[Sukuna] Final edit failed:', err);
    }
  }

  if (!state.msg) return;

  // Rate limit + history
  const now = Date.now();
  lastReplyAt = now;
  replyTimestamps.push(now);
  bumpCounter('aiReplies');

  recordActivity('ai', 'Replied in #' + ((message.channel as TextChannel).name || 'channel'), {
    level: 'success',
    meta: {
      guildId: message.guildId,
      channelId: message.channelId,
      chars: fullResponse.length,
      model: cfg.model,
    },
  });

  addHistoryEntry(message.channelId, {
    id: state.msg.id,
    authorId: message.client.user?.id || 'unknown',
    authorName: cfg.displayName || 'Sukuna',
    content: fullResponse.slice(0, MAX_REPLY_LENGTH).trim(),
    timestamp: now,
    bot: true,
  });
}

function buildSystemPrompt(cfg: SukunaConfig, botId: string): string {
  const runtime = buildSukunaRuntimePrompt({
    displayName: cfg.displayName || 'Sukuna',
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