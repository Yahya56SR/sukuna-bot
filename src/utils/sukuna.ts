/**
 * Sukuna — community persona that lives in Discord channels.
 */

import type { TextChannel, Guild, Message, Client } from 'discord.js';
import { Type as GenAIType, type FunctionDeclaration } from '@google/genai';
import { normalizeSukunaConfig, type SukunaConfig, defaultSukunaConfig } from '../config/index.js';
import { buildSukunaRuntimePrompt, SUKUNA_DEFAULT_PROMPT } from '../prompts/sukuna.js';
import {
  GeminiLiveSukuna,
  type SukunaDecision,
  type SukunaMedia,
  type SukunaToolCall,
} from '../core/gemini-live.js';
import { addMemory, countMemories, recallMemories, type ISukunaMemory } from './sukuna-memory.js';
import { collectSukunaMedia } from './sukuna-media.js';

const MAX_HISTORY_ENTRIES = 100;
const MAX_MESSAGE_CHARS = 500;
const MAX_BATCH_MESSAGES = 8;
const MAX_REPLY_LENGTH = 2000;
const MAX_REPLY_AGE_MS = 60_000;

// In-memory buffers
const channelHistory = new Map<string, HistoryEntry[]>();
const channelHistoryIds = new Map<string, Set<string>>();
const pendingBatches = new Map<string, PendingBatch>();
const replyTimestamps: number[] = [];

// Persona state
let personaInstance: GeminiLiveSukuna | null = null;
let lastReplyAt = 0;
let lastDecisionAt = 0;
let apiKeyCache = '';

interface HistoryEntry {
  id: string;
  authorId: string;
  authorName: string;
  content: string;
  timestamp: number;
  bot: boolean;
  replyTo?: string;
}

interface PendingBatch {
  messages: Message[];
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Feed one Discord message to Sukuna.
 */
export function handleMessage(message: Message | { guild?: any; author: any; channel: any; content: any; createdTimestamp: number; system?: boolean; channelId?: string }): void {
  const cfg = getSukunaConfig();
  if (!cfg.enabled) return;

  const msg = message as any;
  if (!msg.guild) return;
  
  const channelId = msg.channelId || msg.channel?.id;
  if (!channelId || !cfg.channelIds.includes(channelId)) return;

  // Handle bot messages for history
  if (msg.author?.bot) {
    addToHistory(msg, cfg);
    return;
  }

  // Skip empty messages
  if (!msg.content?.trim() && (!msg.attachments?.size || msg.attachments.size === 0)) return;

  addToHistory(msg, cfg);

  // Batch processing
  const existing = pendingBatches.get(channelId);
  if (existing) {
    existing.messages.push(msg);
    if (existing.messages.length >= MAX_BATCH_MESSAGES) {
      clearTimeout(existing.timer);
      pendingBatches.delete(channelId);
      void processBatch(channelId, existing.messages, cfg);
    }
    return;
  }

  const batch: PendingBatch = {
    messages: [msg],
    timer: setTimeout(() => {
      pendingBatches.delete(channelId);
      void processBatch(channelId, batch.messages, cfg);
    }, Math.max(cfg.batchWindowMs, 250)),
  };
  pendingBatches.set(channelId, batch);
}

/**
 * Close the Live session (for shutdown).
 */
function closeSukuna(): void {
  personaInstance?.close();
  personaInstance = null;
  
  for (const batch of pendingBatches.values()) clearTimeout(batch.timer);
  pendingBatches.clear();
  channelHistory.clear();
  channelHistoryIds.clear();
}

/**
 * Check if Sukuna is active.
 */
function isSukunaActive(): boolean {
  return personaInstance !== null;
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
  // Placeholder - would load history from Discord
}

function addToHistory(message: any, cfg: SukunaConfig): void {
  const content = describeMessage(message);
  if (!content) return;

  const entry: HistoryEntry = {
    id: message.id,
    authorId: message.author?.id || 'unknown',
    authorName: message.member?.displayName || message.author?.username || 'Unknown',
    content,
    timestamp: message.createdTimestamp,
    bot: message.author?.bot ?? false,
    replyTo: describeReply(message),
  };

  const channelId = message.channelId || message.channel?.id;
  if (!channelId) return;

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
  if (entries.length > MAX_HISTORY_ENTRIES) {
    entries.splice(0, entries.length - MAX_HISTORY_ENTRIES);
  }
}

function describeMessage(message: any): string {
  return message.content?.replace(/\s+/g, ' ').trim() || '';
}

function describeReply(message: any): string {
  const ref = message.reference?.messageId;
  if (!ref) return '';
  return '[reply to earlier message]';
}

type SukunaToolExecutor = (call: SukunaToolCall) => Promise<Record<string, unknown>>;

async function processBatch(channelId: string, messages: any[], cfg: SukunaConfig): Promise<void> {
  if (!cfg.enabled || !cfg.channelIds.includes(channelId)) return;

  const trigger = messages[messages.length - 1];
  if (!trigger || !trigger.guild) return;

  if (isRateLimited(cfg)) return;
  if (cfg.decisionCooldownSeconds > 0 && Date.now() - lastDecisionAt < cfg.decisionCooldownSeconds * 1000) {
    return;
  }

  const apiKey = apiKeyCache || process.env.GEMINI_API_KEY || '';
  if (!apiKey) {
    console.warn('[Sukuna] Enabled but no Gemini API key');
    return;
  }

  const channel = trigger.channel as TextChannel;
  if (!channel?.isTextBased?.()) return;

  const entries = channelHistory.get(channelId) ?? [];
  const batchIds = new Set(messages.map((m: any) => m.id));
  const previous = entries.filter((e: any) => !batchIds.has(e.id));

  const payload = buildPayload(trigger.guild, channel, previous, messages, cfg);
  const media = await collectSukunaMedia(messages).catch(() => [] as SukunaMedia[]);

  if (cfg.showTyping) {
    channel.sendTyping().catch(() => {});
  }

  let decision: SukunaDecision | null = null;
  try {
    personaInstance = new GeminiLiveSukuna({
      apiKey,
      model: cfg.model || 'gemini-3.1-flash',
      systemPrompt: buildSystemPrompt(cfg, trigger.client?.user?.id || ''),
      tools: buildDecisionsAndTools(cfg, channel),
      thinkingLevel: cfg.thinkingLevel,
      temperature: cfg.temperature,
      requestTimeoutMs: cfg.requestTimeoutMs,
    });

    const executor = createToolExecutor(trigger);
    decision = await personaInstance.ask(payload, executor, cfg.requestTimeoutMs, media);
  } catch (err) {
    console.error('[Sukuna] Failed:', err);
    return;
  } finally {
    lastDecisionAt = Date.now();
  }

  if (!decision || decision.action !== 'reply' || (!decision.message.trim() && !decision.stickerId)) {
    return;
  }

  if (isRateLimited(cfg)) return;
  if (Date.now() - trigger.createdTimestamp > MAX_REPLY_AGE_MS) return;

  await sendDecision(trigger, decision, cfg);
}

function createToolExecutor(trigger: Message | any): SukunaToolExecutor {
  return async (call: SukunaToolCall): Promise<Record<string, unknown>> => {
    const name = call.name ?? '';
    const args = call.args ?? {};

    try {
      return await handleTool(name, args, trigger.guild!, trigger.channel as TextChannel, trigger);
    } catch (error) {
      console.error('[Sukuna Tool] Failed: ' + String(error));
      return { ok: false, error: String(error) };
    }
  };
}

async function handleTool(
  name: string,
  args: Record<string, unknown>,
  guild: Guild,
  channel: TextChannel,
  trigger: Message,
): Promise<Record<string, unknown>> {
  switch (name) {
    case 'get_recent_messages': {
      const limit = Math.min(Math.max(Math.floor(Number(args.limit ?? 10)), 1), 25);
      const messages = await channel.messages.fetch({ limit }).catch(() => new Map());
      return { ok: true, messages: [...messages.values()].map((m) => ({ id: m.id, authorId: m.author.id, content: m.content })) };
    }

    case 'send_message': {
      const content = args.content as string;
      if (!content) return { ok: false, error: 'Content is required' };
      await channel.send({ content });
      return { ok: true, sent: true };
    }

    case 'stay_silent':
      return { ok: true, silent: true };

    case 'remember_information': {
      const fact = args.fact as string;
      if (!fact) return { ok: false, error: 'Fact is required' };
      const about = args.about as string | undefined;
      const note = await addMemory(guild.id, { fact, aboutUserId: about, aboutName: about });
      return { ok: true, id: (note as any)._id?.toString() ?? String(Date.now()), fact: note.fact };
    }

    case 'search_memory': {
      const query = args.query as string | undefined;
      const limit = Math.min(Math.max(Math.floor(Number(args.limit ?? 10)), 1), 100);
      const memories = await (query ? recallMemories(guild.id, { about: query, limit }) : recallMemories(guild.id, { limit }));
      return { ok: true, notes: memories.map((n) => ({ fact: n.fact, createdAt: new Date(n.createdAt).toISOString() })), total: await countMemories(guild.id) };
    }

    default:
      return { ok: false, error: 'Unknown tool: ' + name };
  }
}

function buildDecisionsAndTools(cfg: SukunaConfig, channel: TextChannel): FunctionDeclaration[] {
  const tools: FunctionDeclaration[] = [];

  tools.push({
    name: 'send_message',
    description: 'Send a Discord message.',
    parameters: {
      type: GenAIType.OBJECT,
      properties: {
        content: { type: GenAIType.STRING },
      },
      required: ['content'],
    },
  });

  tools.push({
    name: 'send_sticker',
    description: 'Send a server sticker.',
    parameters: {
      type: GenAIType.OBJECT,
      properties: {
        sticker_id: { type: GenAIType.STRING },
      },
      required: ['sticker_id'],
    },
  });

  tools.push({
    name: 'stay_silent',
    description: 'Choose not to respond.',
    parameters: { type: GenAIType.OBJECT, properties: {} },
  });

  tools.push({
    name: 'get_recent_messages',
    description: 'Get recent messages in channel.',
    parameters: {
      type: GenAIType.OBJECT,
      properties: { limit: { type: GenAIType.INTEGER } },
    },
  });

  if (cfg.memoryEnabled) {
    tools.push({
      name: 'remember_information',
      description: 'Store information.',
      parameters: {
        type: GenAIType.OBJECT,
        properties: { fact: { type: GenAIType.STRING }, about: { type: GenAIType.STRING } },
        required: ['fact'],
      },
    });

    tools.push({
      name: 'search_memory',
      description: 'Search memories.',
      parameters: {
        type: GenAIType.OBJECT,
        properties: { query: { type: GenAIType.STRING }, limit: { type: GenAIType.INTEGER } },
      },
    });
  }

  return tools;
}

function getSukunaConfig(): SukunaConfig {
  return normalizeSukunaConfig(defaultSukunaConfig);
}

function buildSystemPrompt(cfg: SukunaConfig, botId: string): string {
  const runtime = buildSukunaRuntimePrompt({
    displayName: cfg.displayName || 'Sukuna',
    botId,
    toolsEnabled: cfg.toolsEnabled ?? true,
    memoryEnabled: cfg.memoryEnabled ?? true,
    maxMessageLength: Math.min(Math.max(cfg.maxMessageLength, 1), MAX_REPLY_LENGTH),
  });
  const character = cfg.systemPrompt?.trim() || SUKUNA_DEFAULT_PROMPT;
  return character + '\n\n' + runtime;
}

function buildPayload(guild: Guild, channel: TextChannel, previous: any[], batch: any[], cfg: SukunaConfig): string {
  const recent = previous.slice(-Math.max(cfg.historySize, 1));
  const incoming = batch.map((m: any) => ({
    author: m.author?.displayName || m.author?.username || 'Unknown',
    content: m.content?.slice(0, 200) || '',
  }));

  return [
    '<current_time>' + new Date().toISOString() + '</current_time>',
    '<server>' + guild.name + ' - ' + guild.memberCount + ' members</server>',
    '<channel>' + (channel.name || 'this channel') + '</channel>',
    '<recent_messages>' + (recent.length ? recent.map((e: any) => '[' + new Date(e.timestamp).toISOString().slice(11, 16) + '] ' + e.authorName + ': ' + e.content).join('\n') : '(no earlier messages)') + '</recent_messages>',
    '<new_messages>' + (incoming.length ? incoming.map((i: any) => i.author + ': ' + i.content).join('\n') : '(no new messages)') + '</new_messages>',
    '<latest_message>' + (incoming[incoming.length - 1]?.author + ': ' + (incoming[incoming.length - 1]?.content || '')) + '</latest_message>',
    '',
    'Decide whether Sukuna should respond. Silence is the default.',
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

async function sendDecision(trigger: Message, decision: SukunaDecision, cfg: SukunaConfig): Promise<void> {
  const channel = trigger.channel as TextChannel;
  if (!trigger.guild || !channel?.isTextBased?.() || channel.isDMBased?.()) return;

  const limit = Math.min(Math.max(cfg.maxMessageLength, 1), MAX_REPLY_LENGTH);
  const content = decision.message.slice(0, limit).trim();

  if (!content && !decision.stickerId) return;

  try {
    if (decision.replyToTrigger) {
      await trigger.reply({ content, failIfNotExists: false });
    } else {
      await channel.send({ content });
    }

    const now = Date.now();
    lastReplyAt = now;
    replyTimestamps.push(now);
  } catch (err) {
    console.error('[Sukuna] Failed to send reply:', err);
  }
}

// Export handlers
export { closeSukuna, isSukunaActive, primeSukunaHistory, setApiKey };
export { handleMessage as handleSukunaMessage };