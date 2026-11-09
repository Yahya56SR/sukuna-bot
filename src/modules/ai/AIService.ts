import { Client, Message, Channel, Guild } from 'discord.js';
import { Logger } from '../../infrastructure/Logger';
import { SUKUNA_DEFAULT_PROMPT, buildSukunaRuntimePrompt } from './prompt';
import { recallMemories } from './memory';

export interface AIConfig {
  enabled: boolean;
  displayName: string;
  model: string;
  systemPrompt: string;
  channelIds: string[];
  historySize: number;
  batchWindowMs: number;
  replyCooldownSeconds: number;
  decisionCooldownSeconds: number;
  maxRepliesPerHour: number;
  maxMessageLength: number;
  showTyping: boolean;
  temperature: number;
  requestTimeoutMs: number;
  apiKey: string;
}

interface HistoryEntry {
  id: string;
  authorId: string;
  authorName: string;
  content: string;
  timestamp: number;
  bot: boolean;
  replyTo?: string | undefined;
}

interface PendingBatch {
  messages: Message[];
  timer: ReturnType<typeof setTimeout>;
}

const MAX_HISTORY_ENTRIES = 200;
const MAX_MESSAGE_CHARS = 500;
const MAX_BATCH_MESSAGES = 12;
const MAX_REPLY_LENGTH = 2000;
const MAX_REPLY_AGE_MS = 60_000;

export class AIService {
  private logger: Logger;
  private client: Client | null = null;
  public config: AIConfig;
  private history = new Map<string, HistoryEntry[]>();
  private historyIds = new Map<string, Set<string>>();
  private priming = new Set<string>();
  private batches = new Map<string, PendingBatch>();
  private replyTimestamps: number[] = [];
  private lastReplyAt = 0;
  private lastDecisionAt = 0;
  /** Reserved for future tool wiring (leveling-aware replies). */
  private _db: any | null = null;
  /** Reserved for future tool wiring. */
  private _leveling: any | null = null;

  public getDb(): any | null { return this._db; }
  public getLeveling(): any | null { return this._leveling; }

  constructor(logger: Logger, config: AIConfig) {
    this.logger = logger;
    this.config = { ...config };
  }

  public setDb(db: any): void {
    this._db = db;
  }

  public setLeveling(leveling: any): void {
    this._leveling = leveling;
  }

  public setClient(client: Client): void {
    this.client = client;
  }

  public getConfig(): AIConfig {
    return this.config;
  }

  public async initialize(): Promise<void> {
    this.logger.info('AI Service', 'Sukuna persona initialized (L7aj-style: batching + memory + fail-silent)');
    if (this.client) {
      await this.primeHistory(this.client).catch(() => undefined);
    }
  }

  /** Pre-load recent messages so the persona has context after restart. */
  public async primeHistory(client: Client): Promise<void> {
    if (!this.config.enabled || this.config.channelIds.length === 0) return;
    for (const channelId of this.config.channelIds) {
      const channel = client.channels.cache.get(channelId);
      if (!channel?.isTextBased()) continue;
      const entries = await this.fetchHistory(channel as any).catch(() => [] as HistoryEntry[]);
      for (const e of entries) this.addHistoryEntry(channelId, e);
    }
  }

  public handleMessage(message: Message): void {
    if (!message.guild || (message as any).system) return;
    if (!this.config.enabled) return;
    if (!this.config.channelIds.includes(message.channelId)) return;

    // Bots are context, never triggers
    if (message.author.bot) {
      if (!this.history.has(message.channelId)) this.schedulePrime(message.channel as any);
      this.addHistory(message);
      return;
    }

    if (!message.content.trim() && message.attachments.size === 0) return;

    this.logMemberMessage(message);

    if (!this.history.has(message.channelId)) this.schedulePrime(message.channel as any);

    this.addHistory(message);

    const existing = this.batches.get(message.channelId);
    if (existing) {
      existing.messages.push(message);
      if (existing.messages.length >= MAX_BATCH_MESSAGES) {
        clearTimeout(existing.timer);
        this.batches.delete(message.channelId);
        void this.flushBatch(message.channelId, existing.messages);
      }
      return;
    }

    const batch: PendingBatch = {
      messages: [message],
      timer: setTimeout(() => {
        this.batches.delete(message.channelId);
        void this.flushBatch(message.channelId, batch.messages);
      }, Math.max(this.config.batchWindowMs, 250)),
    };
    this.batches.set(message.channelId, batch);
  }

  private async flushBatch(channelId: string, messages: Message[]): Promise<void> {
    if (!this.config.enabled || !this.config.channelIds.includes(channelId)) return;
    const trigger = messages[messages.length - 1];
    if (!trigger || !trigger.guild) return;

    if (this.isRateLimited()) {
      this.logger.info('AI Service', 'Rate limited — staying silent');
      return;
    }

    if (
      this.config.decisionCooldownSeconds > 0 &&
      Date.now() - this.lastDecisionAt < this.config.decisionCooldownSeconds * 1000
    ) {
      this.logger.info('AI Service', 'Decision cooldown — staying silent');
      return;
    }

    if (!this.config.apiKey) {
      this.logger.warn('AI Service', 'Enabled but no API key configured.');
      return;
    }

    const entries = this.history.get(channelId) ?? [];
    const batchIds = new Set(messages.map((m) => m.id));
    const previous = entries.filter((e) => !batchIds.has(e.id));

    const payload = this.buildEventPayload(trigger.guild, trigger.channel as any, previous, messages);

    // Typing indicator while the model thinks (cosmetic)
    if (this.config.showTyping && (trigger.channel as any).sendTyping) {
      try { await (trigger.channel as any).sendTyping(); } catch { /* cosmetic */ }
    }

    let decision: { action: string; message: string; replyToTrigger?: boolean } | null = null;
    try {
      decision = await this.askAI(payload);
    } catch (err) {
      this.logger.error('AI Service', 'Failed to evaluate batch', err as Error);
      return;
    } finally {
      this.lastDecisionAt = Date.now();
    }

    if (!decision || decision.action !== 'reply' || !decision.message.trim()) return;
    if (this.isRateLimited()) return;
    if (Date.now() - trigger.createdTimestamp > MAX_REPLY_AGE_MS) return;

    await this.sendDecision(trigger, decision as any);
  }

  /** Direct Q&A test (dashboard + slash commands): always replies, never silent. */
  public async testAsk(text: string, guild?: Guild, channel?: Channel): Promise<{ action: string; message: string }> {
    const synthetic = {
      guild,
      channel,
      previous: [] as HistoryEntry[],
      batch: [] as Message[],
      synthetic: { authorName: 'dashboard test', content: text.trim(), timestamp: Date.now() },
    };
    let payload: string;
    if (guild && channel) {
      payload = this.buildEventPayload(guild as any, channel as any, [], [], synthetic.synthetic);
      // Append forced-reply instruction so the model doesn't go silent
      payload += '\n\n[forced reply: answer the question directly, do not stay silent]';
    } else {
      payload = `<user_message>${text.trim()}</user_message>\n\nYou must reply with helpful text. Respond with JSON only: {"action":"reply","message":"..."}`;
    }
    const decision = await this.askAI(payload);
    if (decision?.action === 'reply' && decision.message.trim()) return decision;
    // Fallback: try raw generation without silent instruction
    const raw = await this.askRaw(payload);
    return { action: 'reply', message: raw || 'I could not generate a reply.' };
  }

  private isRateLimited(): boolean {
    const now = Date.now();
    if (this.config.replyCooldownSeconds > 0 && now - this.lastReplyAt < this.config.replyCooldownSeconds * 1000) {
      return true;
    }
    this.pruneReplyTimestamps(now);
    return this.config.maxRepliesPerHour > 0 && this.replyTimestamps.length >= this.config.maxRepliesPerHour;
  }

  private pruneReplyTimestamps(now: number): void {
    const cutoff = now - 60 * 60 * 1000;
    while (this.replyTimestamps.length > 0 && (this.replyTimestamps[0] ?? 0) < cutoff) {
      this.replyTimestamps.shift();
    }
  }

  private addHistory(message: Message): void {
    const content = this.describeMessage(message);
    if (!content) return;
    const entry: HistoryEntry = {
      id: message.id,
      authorId: message.author.id,
      authorName: message.member?.displayName ?? message.author.username,
      content,
      timestamp: message.createdTimestamp,
      bot: message.author.bot,
      replyTo: this.describeReply(message),
    };
    this.addHistoryEntry(message.channelId, entry);
  }

  private addHistoryEntry(channelId: string, entry: HistoryEntry): void {
    let ids = this.historyIds.get(channelId);
    if (!ids) {
      ids = new Set();
      this.historyIds.set(channelId, ids);
    }
    if (ids.has(entry.id)) return;
    ids.add(entry.id);
    const entries = this.history.get(channelId) ?? [];
    entries.push(entry);
    if (entries.length > MAX_HISTORY_ENTRIES) {
      const removed = entries.splice(0, entries.length - MAX_HISTORY_ENTRIES);
      for (const old of removed) ids.delete(old.id);
    }
    this.history.set(channelId, entries);
  }

  private schedulePrime(channel: Channel): void {
    if (!channel || this.priming.has(channel.id)) return;
    this.priming.add(channel.id);
    this.fetchHistory(channel as any)
      .then((entries) => {
        for (const e of entries) this.addHistoryEntry(channel.id, e);
      })
      .catch(() => undefined)
      .finally(() => this.priming.delete(channel.id));
  }

  private async fetchHistory(channel: any): Promise<HistoryEntry[]> {
    if (!channel?.isTextBased?.()) return [];
    try {
      const fetched = await channel.messages.fetch({
        limit: Math.min(Math.max(this.config.historySize, 1), 50),
      });
      return [...fetched.values()]
        .reverse()
        .filter((m: Message) => !(m as any).system)
        .map((m: Message) => ({
          id: m.id,
          authorId: m.author.id,
          authorName: m.member?.displayName ?? m.author.username,
          content: this.describeMessage(m),
          timestamp: m.createdTimestamp,
          bot: m.author.bot,
          replyTo: this.describeReply(m, fetched),
        }))
        .filter((e: HistoryEntry) => e.content !== '');
    } catch {
      return [];
    }
  }

  private describeMessage(message: Message): string {
    const content = this.cleanMessageContent(message).replace(/\s+/g, ' ').trim();
    const attachments = [...message.attachments.values()].slice(0, 3).map((a) => {
      const type = (a.contentType ?? '').toLowerCase();
      const name = a.name ?? 'attachment';
      const kind =
        type === 'image/gif' || name.toLowerCase().endsWith('.gif')
          ? 'gif'
          : type.startsWith('image/') ? 'image'
          : type.startsWith('video/') ? 'video'
          : type.startsWith('audio/') ? 'audio'
          : 'file';
      return `[${kind}: ${name}]`;
    });
    if (message.attachments.size > 3) {
      const extra = message.attachments.size - 3;
      attachments.push(`[+${extra} more attachment${extra === 1 ? '' : 's'}]`);
    }
    const stickers = [...(message.stickers?.values?.() ?? [])].map((s: any) => `[sticker: ${s.name} (id: ${s.id})]`);
    const extras = [...attachments, ...stickers].join(' ');
    if (!content && !extras) return '';
    const trimmed = content.length > MAX_MESSAGE_CHARS ? `${content.slice(0, MAX_MESSAGE_CHARS)}…` : content;
    return `${trimmed}${trimmed && extras ? ' ' : ''}${extras}`.trim();
  }

  private describeReply(message: Message, known?: { get(id: string): Message | undefined }): string {
    const refId = (message as any).reference?.messageId;
    if (!refId) return '';
    const knownMsg =
      known?.get(refId) ??
      (message.channel.isTextBased()
        ? (message.channel.messages.cache.get(refId) as Message | undefined) ?? null
        : null);
    const historical = this.history
      .get(message.channelId)
      ?.find((e) => e.id === refId);
    const authorId =
      (knownMsg as any)?.author.id ?? (message as any).mentions?.repliedUser?.id ?? historical?.authorId ?? '';
    // @ts-ignore
    const authorName =
      (knownMsg as any)?.author.username ?? (message as any).mentions?.repliedUser?.username ?? historical?.authorName ?? '';
    const member = authorId ? (message.guild as any)?.members.cache.get(authorId) : null;
    const displayName = member?.displayName ?? authorName;
    const isBotAuthor = Boolean(authorId && this.client?.user?.id && authorId === this.client.user.id);
    const label = isBotAuthor
      ? 'your message'
      : authorId
        ? `${this.sanitizeTag(displayName || 'someone')} (${authorId})`
        : 'an earlier message';
    const excerpt = (knownMsg ? this.describeMessage(knownMsg) : historical?.content ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);
    return `[reply to ${label}${excerpt ? `: "${excerpt}"` : ''}]`;
  }

  private cleanMessageContent(message: Message): string {
    const raw = message.content ?? '';
    if (!raw) return '';
    return raw
      .replace(/<@!?(\d+)>/g, (match, id: string) => {
        const member = (message.guild as any)?.members.cache.get(id);
        if (member) return `@${member.displayName} (<@${id}>)`;
        const user = (message.client as any).users.cache.get(id);
        return user ? `@${user.username} (<@${id}>)` : match;
      })
      .replace(/<@&(\d+)>/g, (match, id: string) => {
        const role = (message.guild as any)?.roles.cache.get(id);
        return role ? `@${role.name}` : match;
      })
      .replace(/<#(\d+)>/g, (match, id: string) => {
        const ch = (message.client as any).channels.cache.get(id) as any;
        return ch?.name ? `#${ch.name} (<#${id}>)` : match;
      });
  }

  private logMemberMessage(message: Message): void {
    const author = message.member?.displayName ?? message.author.username;
    const ch: any = message.channel as any;
    const where = ch.name ? `#${ch.name}` : message.channelId;
    this.logger.info('AI Service', `${where} | ${author} (${message.author.id}): ${this.describeMessage(message).slice(0, 200)}`);
  }

  private buildEventPayload(
    guild: any,
    channel: any,
    previous: HistoryEntry[],
    batch: Message[],
    synthetic?: { authorName: string; content: string; timestamp: number },
  ): string {
    const recent = previous
      .slice(-Math.max(this.config.historySize, 1))
      .map((e) => this.formatEntry(e.authorName, e.authorId, e.content, e.timestamp, e.bot, e.replyTo ?? ''));

    const incoming = batch.map((m) =>
      this.formatEntry(
        m.member?.displayName ?? m.author.username,
        m.author.id,
        this.describeMessage(m),
        m.createdTimestamp,
        m.author.bot,
        this.describeReply(m),
      ),
    );

    if (synthetic) {
      incoming.push(this.formatEntry(synthetic.authorName, '', synthetic.content, synthetic.timestamp, false, ''));
    }

    const latest = incoming.length ? incoming[incoming.length - 1] : '(none)';
    const channelName = channel.name ? `#${channel.name}` : 'this channel';

    // Durable memory injection (L7aj-style): most recent notes for this guild
    let memoryBlock = '';
    try {
      const notes = recallMemories(guild.id, { limit: 8 });
      if (notes.length) {
        memoryBlock = [
          '<remembered_facts>',
          ...notes.map((n) => `- ${n.aboutName ? `[${n.aboutName}] ` : ''}${n.fact}`),
          '</remembered_facts>',
        ].join('\n');
      }
    } catch { memoryBlock = ''; }

    return [
      `<current_time>${new Date().toISOString()} (Morocco: ${this.moroccoTime()})</current_time>`,
      `<server>${this.sanitizeTag(guild.name)} — ${guild.memberCount} members</server>`,
      `<channel id="${channel.id}">${this.sanitizeTag(channelName)}</channel>`,
      ...(memoryBlock ? [memoryBlock] : []),
      '<recent_messages>',
      recent.length ? recent.join('\n') : '(no earlier messages)',
      '</recent_messages>',
      '<new_messages>',
      incoming.length ? incoming.join('\n') : '(no new messages)',
      '</new_messages>',
      '<latest_message>',
      latest,
      '</latest_message>',
      '',
      'Decide whether to speak now. Silence is the default.',
    ].join('\n');
  }

  private formatEntry(author: string, authorId: string, content: string, timestamp: number, bot: boolean, replyTo = ''): string {
    const time = this.moroccoClock(timestamp);
    const safe = content.replace(/<\/?(?:recent_messages|new_messages|latest_message|current_time|server|channel|remembered_facts)>/gi, ' ');
    const id = authorId ? ` (${authorId})` : '';
    const reply = replyTo ? ` ${replyTo}` : '';
    return `[${time}] ${bot ? '🤖 ' : ''}${author}${id}:${reply} ${safe || '(empty)'}`;
  }

  private sanitizeTag(v: string): string {
    return String(v ?? '').replace(/[<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  }

  private async askAI(payload: string): Promise<{ action: string; message: string; replyToTrigger?: boolean } | null> {
    const systemPrompt = this.buildSystemPrompt();
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${this.config.model}:generateContent?key=${this.config.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: `${systemPrompt}\n\n${payload}\n\nRespond with JSON only: {"action":"reply"|"silent","message":"...","reply_to_trigger":true|false}` }] }],
            generationConfig: {
              temperature: this.config.temperature,
              maxOutputTokens: Math.min(Math.max(this.config.maxMessageLength * 2, 500), 2000),
            },
          }),
          signal: AbortSignal.timeout(this.config.requestTimeoutMs),
        },
      );

      if (!response.ok) {
        this.logger.error('AI Service', `API error: ${response.status}`);
        return null;
      }

      const data = await response.json() as any;
      const text: string = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      const parsed = this.parseDecision(text);
      if (parsed) return parsed as any;
      return { action: 'silent', message: '' };
    } catch (err) {
      this.logger.error('AI Service', 'AI request failed', err as Error);
      return null;
    }
  }

  private async askRaw(payload: string): Promise<string> {
    const systemPrompt = this.buildSystemPrompt();
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${this.config.model}:generateContent?key=${this.config.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: `${systemPrompt}\n\n${payload}\n\nReply with a single Discord message as plain text (no JSON, no labels).` }] }],
            generationConfig: { temperature: this.config.temperature, maxOutputTokens: Math.min(this.config.maxMessageLength, 2000) },
          }),
          signal: AbortSignal.timeout(this.config.requestTimeoutMs),
        },
      );
      if (!response.ok) return '';
      const data = await response.json() as any;
      return String(data.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim().replace(/^```[\s\S]*?```$/, '').trim();
    } catch {
      return '';
    }
  }

  private buildSystemPrompt(): string {
    const character = (this.config.systemPrompt || '').trim() || SUKUNA_DEFAULT_PROMPT;
    const runtime = buildSukunaRuntimePrompt({
      displayName: this.config.displayName || 'Sukuna',
      botId: this.client?.user?.id,
      maxMessageLength: Math.min(Math.max(this.config.maxMessageLength, 1), MAX_REPLY_LENGTH),
    });
    return `${character}\n\n${runtime}`;
  }

  private parseDecision(raw: string): { action: string; message: string; replyToTrigger?: boolean } | null {
    const json = this.extractJsonObject(raw);
    if (!json) return null;
    try {
      const parsed = JSON.parse(json) as any;
      const action = typeof parsed.action === 'string' ? parsed.action.trim().toLowerCase() : '';
      if (action === 'silent') return { action: 'silent', message: '' };
      if (action === 'reply') {
        const message = this.sanitizeReply(typeof parsed.message === 'string' ? parsed.message : '');
        if (!message) return null;
        return { action: 'reply', message, replyToTrigger: parsed.reply_to_trigger === true || parsed.replyToTrigger === true };
      }
      // Some models emit send_message / stay_silent tool-style names
      if (action === 'send_message') {
        const message = this.sanitizeReply(typeof parsed.message === 'string' ? parsed.message : '');
        return message ? { action: 'reply', message } : null;
      }
      if (action === 'stay_silent') return { action: 'silent', message: '' };
    } catch { /* fall through */ }
    return null;
  }

  private extractJsonObject(text: string): string | null {
    const cleaned = text.replace(/```(?:json)?/gi, '');
    const start = cleaned.indexOf('{');
    if (start === -1) return null;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < cleaned.length; i += 1) {
      const char = cleaned[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === '{') depth += 1;
      else if (char === '}') {
        depth -= 1;
        if (depth === 0) return cleaned.slice(start, i + 1);
      }
    }
    return null;
  }

  private sanitizeReply(v: string): string {
    return v
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ')
      .replace(/\r\n?/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }

  private async sendDecision(trigger: Message, decision: { action: string; message: string; replyToTrigger?: boolean }): Promise<void> {
    const channel: any = trigger.channel;
    if (!trigger.guild || !channel.isTextBased() || channel.isDMBased()) return;

    const limit = Math.min(Math.max(this.config.maxMessageLength, 1), MAX_REPLY_LENGTH);
    const sanitized = this.sanitizeOutgoing(decision.message).slice(0, limit).trim();
    const content = sanitized ? await this.validateMentions(sanitized, trigger.guild as any) : '';
    if (!content) return;

    const allowedMentions = { parse: ['users'] as const, repliedUser: Boolean(decision.replyToTrigger) };
    let sent: Message | null = null;
    try {
      if (decision.replyToTrigger) {
        sent = await trigger.reply({ content, allowedMentions, failIfNotExists: false } as any);
      } else {
        sent = await channel.send({ content, allowedMentions } as any);
      }
    } catch (err) {
      this.logger.error('AI Service', 'Failed to send AI reply', err as Error);
      return;
    }

    const now = Date.now();
    this.lastReplyAt = now;
    this.replyTimestamps.push(now);
    this.pruneReplyTimestamps(now);

    if (sent) {
      this.addHistoryEntry(trigger.channelId, {
        id: sent.id,
        authorId: sent.author.id,
        authorName: this.config.displayName,
        content,
        timestamp: sent.createdTimestamp,
        bot: true,
        replyTo: decision.replyToTrigger
          ? `[reply to ${this.sanitizeTag(trigger.member?.displayName ?? trigger.author.username)} (${trigger.author.id})]`
          : undefined,
      });
    }
  }

  private sanitizeOutgoing(value: string): string {
    return value
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ')
      .replace(/\r\n?/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/@everyone/g, '@\u200Beveryone')
      .replace(/@here/g, '@\u200Bhere')
      .trim();
  }

  private async validateMentions(content: string, guild: Guild): Promise<string> {
    const ids = new Set([...content.matchAll(/<@!?(\d{15,25})>/g)].map((m) => m[1]!));
    if (ids.size === 0) return content;
    let result = content;
    for (const id of ids) {
      if ((guild as any).members.cache.has(id)) continue;
      const member = await (guild as any).members.fetch(id).catch(() => null);
      if (!member) result = result.replace(new RegExp(`<@!?${id}>`, 'g'), `@${id}`);
    }
    return result;
  }

  private moroccoClock(timestamp: number): string {
    try {
      return new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'Africa/Casablanca',
      }).format(new Date(timestamp));
    } catch {
      return new Date(timestamp).toISOString().slice(11, 16);
    }
  }

  private moroccoTime(): string {
    try {
      return new Intl.DateTimeFormat('en-GB', {
        dateStyle: 'full',
        timeStyle: 'short',
        timeZone: 'Africa/Casablanca',
      }).format(new Date());
    } catch {
      return new Date().toISOString();
    }
  }

  public async shutdown(): Promise<void> {
    for (const batch of this.batches.values()) clearTimeout(batch.timer);
    this.batches.clear();
    this.history.clear();
    this.historyIds.clear();
    this.priming.clear();
    this.replyTimestamps.length = 0;
    this.lastReplyAt = 0;
    this.lastDecisionAt = 0;
    this.logger.info('AI Service', 'AI service shutdown');
  }
}

export class AICommands {
  private service: AIService;
  private logger: Logger;
  private config: AIConfig;

  constructor(service: AIService, logger: Logger, config: AIConfig) {
    this.service = service;
    this.logger = logger;
    this.config = config;
  }

  public getCommands(): any[] {
    return [this.askCommand, this.chatCommand];
  }

  private askCommand: any = {
    data: new (require('discord.js').SlashCommandBuilder)()
      .setName('ask')
      .setDescription('Ask Sukuna a question (always replies)')
      .addStringOption((o: any) =>
        o.setName('question').setDescription('Your question').setRequired(true),
      ),
    execute: async (interaction: any) => {
      await interaction.deferReply();
      const question = interaction.options.getString('question', true);
      try {
        const result = await this.service.testAsk(question, interaction.guild ?? undefined, interaction.channel ?? undefined);
        const { aiEmbed } = require('../../utils/embed');
        const embed = aiEmbed({
          question,
          answer: result.message || '...',
          displayName: this.config.displayName,
        });
        await interaction.editReply({ embeds: [embed] });
      } catch (err) {
        this.logger.error('AI Commands', 'Failed to ask AI', err as Error);
        await interaction.editReply('Failed to get AI response. Check the API key in the dashboard.');
      }
    },
  };

  private chatCommand: any = {
    data: new (require('discord.js').SlashCommandBuilder)()
      .setName('chat')
      .setDescription('Chat with Sukuna')
      .addStringOption((o: any) =>
        o.setName('message').setDescription('Your message').setRequired(true),
      ),
    execute: async (interaction: any) => {
      await interaction.deferReply();
      const message = interaction.options.getString('message', true);
      try {
        const result = await this.service.testAsk(message, interaction.guild ?? undefined, interaction.channel ?? undefined);
        const { aiEmbed } = require('../../utils/embed');
        const embed = aiEmbed({
          question: message,
          answer: result.message || '...',
          displayName: this.config.displayName,
        });
        await interaction.editReply({ embeds: [embed] });
      } catch (err) {
        this.logger.error('AI Commands', 'Failed to chat with AI', err as Error);
        await interaction.editReply('Failed to get AI response.');
      }
    },
  };
}
