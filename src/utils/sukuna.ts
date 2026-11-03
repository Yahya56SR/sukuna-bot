/**
 * Sukuna — community persona driven by the Gemini Live API.
 *
 * Live models (e.g. `gemini-3.8-live`) only support real-time bidirectional
 * streaming (`bidiGenerateContent` over WebSocket), so every turn goes through
 * `GeminiLiveSukuna`. `generateContent` is never used.
 *
 * One Discord message = one Live turn that must end in a decision:
 * `send_message`, `send_sticker` or `stay_silent`. Messages arrive from the
 * enabled channels and from private DMs (when `dmEnabled` is on).
 */

import { ChannelType } from 'discord.js';
import type { Client, DMChannel, Guild, GuildMember, Message, TextChannel } from 'discord.js';
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

/** A channel the persona can post in. */
type PersonaChannel = TextChannel | DMChannel;

/**
 * Where a turn comes from. DMs get their own Live client so a private
 * conversation can never share server-side session context with a channel.
 */
type PersonaSurface = 'channel' | 'dm';

/** Flatten and shorten text for console logging. */
function preview(text: string, max = 600): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (!flat) return '(empty)';
  return flat.length <= max ? flat : `${flat.slice(0, max)}… (${flat.length} chars)`;
}

function logPersona(event: string, data?: Record<string, unknown>): void {
  if (data) console.log(`[Sukuna] ${event}`, data);
  else console.log(`[Sukuna] ${event}`);
}

// In-memory channel history (context only)
const channelHistory = new Map<string, HistoryEntry[]>();
const channelHistoryIds = new Map<string, Set<string>>();

interface RateState {
  lastDecisionAt: number;
  lastReplyAt: number;
  replyTimestamps: number[];
}

// Rate limiting is tracked per surface so a busy channel cannot mute the DMs.
const channelRate: RateState = { lastDecisionAt: 0, lastReplyAt: 0, replyTimestamps: [] };
const dmRate: RateState = { lastDecisionAt: 0, lastReplyAt: 0, replyTimestamps: [] };

let apiKeyCache = '';

/**
 * Live clients are scoped to one conversation — `text:<guildId>:<channelId>` or
 * `dm:<userId>`. One channel can never share a queue, a socket or a quota
 * backoff with another channel, a DM or a different guild.
 */
interface LiveSlot {
  client: GeminiLiveSukuna;
  signature: string;
  lastUsedAt: number;
}

const liveClients = new Map<string, LiveSlot>();
/** Conversations kept alive at once; least recently used are closed first. */
const MAX_LIVE_CLIENTS = 32;

/** Stable id of the conversation a Discord event belongs to. */
function conversationKey(message: Message): string {
  if (message.channel.isDMBased()) return `dm:${message.channelId}`;
  return `text:${message.guildId ?? 'unknown'}:${message.channelId}`;
}

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

  // Private DMs: everything the member sends to the bot directly. Group DMs are
  // skipped — they are not a private conversation with the persona.
  if (message.channel.isDMBased()) {
    if (!cfg.dmEnabled) return;
    if (message.channel.type !== ChannelType.DM) return;
    if (message.author.bot) return;
    if (!message.content?.trim() && message.attachments.size === 0) return;

    addToHistory(message, cfg);
    void processMessage(message, cfg);
    return;
  }

  if (!message.guild) return;
  if (!message.channel.isTextBased()) return;

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
  logPersona('closing Live sessions', { conversations: liveClients.size });
  for (const slot of liveClients.values()) slot.client.close();
  liveClients.clear();
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
 * One Live client per conversation, reused while the persona configuration is
 * unchanged. A client never serves two channels, so their conversations cannot
 * be mixed.
 */
function getLiveClient(
  cfg: SukunaConfig,
  apiKey: string,
  botId: string,
  conversation: string,
): GeminiLiveSukuna | null {
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

  const existing = liveClients.get(conversation);
  if (existing && existing.signature === signature) {
    existing.lastUsedAt = Date.now();
    return existing.client;
  }

  if (existing) {
    existing.client.close();
    liveClients.delete(conversation);
  }

  // Sessions are closed after every turn, so an idle client costs almost
  // nothing; still bound the map so a busy bot cannot grow it forever.
  if (liveClients.size >= MAX_LIVE_CLIENTS) {
    let oldestKey: string | null = null;
    let oldestAt = Number.POSITIVE_INFINITY;
    for (const [key, slot] of liveClients) {
      if (slot.lastUsedAt < oldestAt) {
        oldestAt = slot.lastUsedAt;
        oldestKey = key;
      }
    }
    if (oldestKey) {
      liveClients.get(oldestKey)?.client.close();
      liveClients.delete(oldestKey);
      logPersona('live client evicted', { conversation: oldestKey });
    }
  }

  try {
    const client = new GeminiLiveSukuna({
      apiKey,
      model: cfg.model,
      systemPrompt,
      tools,
      thinkingLevel: cfg.thinkingLevel,
      temperature: cfg.temperature,
      requestTimeoutMs: cfg.requestTimeoutMs,
      label: conversation,
    });
    liveClients.set(conversation, { client, signature, lastUsedAt: Date.now() });
    logPersona('live client created', {
      conversation,
      model: cfg.model,
      tools: tools.length,
      thinkingLevel: cfg.thinkingLevel ?? '(model default)',
      temperature: cfg.temperature,
      promptChars: systemPrompt.length,
    });
    return client;
  } catch (error) {
    console.error('[Sukuna] Could not create the Live client:', error);
    return null;
  }
}

async function processMessage(message: Message, cfg: SukunaConfig): Promise<void> {
  const isDm = message.channel.isDMBased();
  const surface: PersonaSurface = isDm ? 'dm' : 'channel';
  const rate = isDm ? dmRate : channelRate;
  const channel = message.channel as PersonaChannel;
  const channelName = isDm ? 'DM' : (channel as TextChannel).name || message.channelId;

  if (isRateLimited(cfg, rate)) {
    logPersona('skipped — reply rate limit', {
      surface,
      channel: channelName,
      replyCooldownSeconds: cfg.replyCooldownSeconds,
      maxRepliesPerHour: cfg.maxRepliesPerHour,
      repliesLastHour: rate.replyTimestamps.length,
    });
    return;
  }
  if (cfg.decisionCooldownSeconds > 0 && Date.now() - rate.lastDecisionAt < cfg.decisionCooldownSeconds * 1000) {
    logPersona('skipped — decision cooldown', {
      surface,
      channel: channelName,
      decisionCooldownSeconds: cfg.decisionCooldownSeconds,
    });
    return;
  }

  const apiKey = apiKeyCache || process.env.GEMINI_API_KEY || '';
  if (!apiKey) {
    console.warn('[Sukuna] Enabled but no Gemini API key');
    return;
  }

  // In a DM there is no guild: fall back to a server the member shares with the
  // bot (memory scope and guild tools), or to none at all.
  const guild = message.guild ?? (isDm ? resolveHomeGuild(message) : null);
  const conversation = conversationKey(message);

  const live = getLiveClient(cfg, apiKey, message.client.user?.id || '', conversation);
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

  const history = channelHistory.get(message.channelId) ?? [];
  let payload: string;
  if (isDm) {
    payload = buildDmPayload(message, history, guild);
  } else {
    if (!guild) return;
    payload = buildPayload(guild, channel as TextChannel, history, message);
  }

  logPersona('incoming', {
    surface,
    conversation,
    guild: guild?.name ?? null,
    channel: channelName,
    author: message.author.tag,
    attachments: message.attachments.size,
    media: media.length,
    model: cfg.model,
    message: preview(message.content || '(empty)', 500),
  });

  if (cfg.showTyping) {
    channel.sendTyping().catch(() => {});
  }

  const startedAt = Date.now();
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

  const elapsedMs = Date.now() - startedAt;
  rate.lastDecisionAt = Date.now();

  if (!decision) {
    logPersona('stayed silent — no decision', {
      channel: channelName,
      author: message.author.tag,
      elapsedMs,
      hint: 'timeout, dropped connection or exhausted Gemini quota (see [Sukuna:Live] logs)',
    });
    return;
  }

  if (decision.action !== 'reply') {
    logPersona('stayed silent — stay_silent', {
      channel: channelName,
      author: message.author.tag,
      elapsedMs,
      toolCalls: decision.toolCalls.join(',') || '(none)',
    });
    return;
  }

  logPersona('decision', {
    channel: channelName,
    author: message.author.tag,
    elapsedMs,
    chars: decision.message.length,
    stickerId: decision.stickerId ?? null,
    nativeReply: Boolean(decision.replyToTrigger),
    toolCalls: decision.toolCalls.join(',') || '(none)',
  });
  logPersona('reply text', {
    text: preview(decision.message, MAX_REPLY_LENGTH) || '(no text — sticker only)',
  });

  const sent = await deliverDecision(message, channel, decision, cfg);
  if (!sent) {
    console.warn('[Sukuna] Decision produced nothing sendable — dropped');
    return;
  }

  const now = Date.now();
  rate.lastReplyAt = now;
  rate.replyTimestamps.push(now);
  bumpCounter('aiReplies');

  recordActivity('ai', isDm ? 'Replied in DMs' : 'Replied in #' + channelName, {
    level: 'success',
    meta: {
      guildId: message.guildId,
      channelId: message.channelId,
      chars: decision.message.length,
      model: cfg.model,
    },
  });

  const sticker =
    !isDm && decision.stickerId && guild
      ? guild.stickers.cache.get(decision.stickerId) ?? null
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

  logPersona('posted', {
    channel: channelName,
    messageId: sent.id,
    nativeReply: Boolean(decision.replyToTrigger),
    stickerId: sticker?.id ?? null,
    text: preview(decision.message, MAX_REPLY_LENGTH) || '(sticker only)',
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
  channel: PersonaChannel,
  decision: SukunaDecision,
  cfg: SukunaConfig,
): Promise<Message | null> {
  const isDm = channel.isDMBased();
  const maxLength = Math.min(cfg.maxMessageLength || MAX_REPLY_LENGTH, MAX_REPLY_LENGTH);
  const content = decision.message.slice(0, maxLength).trim();

  const requestedSticker = decision.stickerId?.trim() ?? '';
  if (requestedSticker && isDm) {
    console.warn('[Sukuna] Stickers are unavailable in DMs — sending the text only');
  }

  const sticker =
    !isDm && requestedSticker && /^\d{15,25}$/.test(requestedSticker)
      ? message.guild?.stickers.cache.get(requestedSticker) ?? null
      : null;

  if (!isDm && requestedSticker && !sticker) {
    console.warn('[Sukuna] Ignoring unknown sticker id:', requestedSticker);
  }

  if (!content && !sticker) return null;

  try {
    if (isDm) {
      // Only one member can read this, so nothing needs mention parsing.
      return await (channel as DMChannel).send({
        content: content || undefined,
        allowedMentions: { parse: [] },
      });
    }

    // Users may be pinged through <@ID> markup, but roles, @everyone and @here
    // stay silent. A native reply notifies the trigger author when chosen.
    const payload = {
      content: content || undefined,
      allowedMentions: {
        parse: ['users'] as const,
        repliedUser: Boolean(decision.replyToTrigger),
      },
      ...(sticker ? { stickers: [sticker.id] } : {}),
    };

    return decision.replyToTrigger
      ? await message.reply({ ...payload, failIfNotExists: false })
      : await (channel as TextChannel).send(payload);
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

/**
 * DM turns carry no server/channel context: just the member and the private
 * conversation. The shared server is only a hint (memory scope + guild tools).
 */
function buildDmPayload(trigger: Message, history: HistoryEntry[], guild: Guild | null): string {
  const recent = history.slice(-50);
  return [
    '<current_time>' + new Date().toISOString() + '</current_time>',
    '<dm_with>' +
      trigger.author.displayName +
      ' (@' +
      trigger.author.username +
      ', id ' +
      trigger.author.id +
      ')</dm_with>',
    '<shared_server>' + (guild ? guild.name : 'none') + '</shared_server>',
    '<recent_messages>' + (recent.length ? recent.map((e) => '[' + new Date(e.timestamp).toISOString().slice(11, 16) + '] ' + e.authorName + ': ' + e.content).join('\n') : '(no earlier messages)') + '</recent_messages>',
    '<latest_message>' + (trigger.author.displayName + ': ' + (trigger.content || '(empty)')) + '</latest_message>',
    '',
    'This is a private direct message, not a channel: only this member will read your answer.',
    'Respond naturally in the DM. Silence is acceptable if nothing needs saying.',
  ].join('\n');
}

/**
 * First server the DM author shares with the bot, used to scope memory and the
 * guild tools. Never used to reveal that server's private context.
 */
function resolveHomeGuild(message: Message): Guild | null {
  for (const guild of message.client.guilds.cache.values()) {
    if (guild.members.cache.has(message.author.id)) return guild;
  }
  return null;
}

function isRateLimited(cfg: SukunaConfig, state: RateState): boolean {
  const now = Date.now();
  if (cfg.replyCooldownSeconds > 0 && now - state.lastReplyAt < cfg.replyCooldownSeconds * 1000) {
    return true;
  }
  pruneTimestamps(state, now);
  return cfg.maxRepliesPerHour > 0 && state.replyTimestamps.length >= cfg.maxRepliesPerHour;
}

function pruneTimestamps(state: RateState, now: number): void {
  const cutoff = now - 60 * 60 * 1000;
  while (state.replyTimestamps.length > 0 && state.replyTimestamps[0] < cutoff) {
    state.replyTimestamps.shift();
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
