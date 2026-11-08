import { Client, Message } from 'discord.js';
import { Logger } from '../../infrastructure/Logger';

export interface AIMessage {
  id: string;
  authorId: string;
  authorName: string;
  content: string;
  timestamp: number;
  bot: boolean;
}

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
}

interface PendingBatch {
  messages: Message[];
  timer: ReturnType<typeof setTimeout>;
}

export class AIService {
  private logger: Logger;
  private client: Client | null = null;
  private config: AIConfig;
  private history = new Map<string, HistoryEntry[]>();
  private historyIds = new Map<string, Set<string>>();
  private batches = new Map<string, PendingBatch>();
  private replyTimestamps: number[] = [];
  private lastReplyAt = 0;
  private lastDecisionAt = 0;

  constructor(logger: Logger, config: AIConfig) {
    this.logger = logger;
    this.config = config;
  }

  public setDb(_db: any): void {
  }

  public setClient(client: Client): void {
    this.client = client;
  }

  public async initialize(): Promise<void> {
    this.logger.info('AI Service', 'AI persona system initialized');
  }

  public handleMessage(message: Message): void {
    if (!message.guild || message.system || !this.config.enabled) return;
    if (!this.config.channelIds.includes(message.channelId)) return;
    if (message.author.bot) return;
    if (!message.content.trim() && message.attachments.size === 0) return;

    this.addHistory(message);

    const existing = this.batches.get(message.channelId);
    if (existing) {
      existing.messages.push(message);
      if (existing.messages.length >= 12) {
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

    if (this.isRateLimited()) return;

    if (
      this.config.decisionCooldownSeconds > 0 &&
      Date.now() - this.lastDecisionAt < this.config.decisionCooldownSeconds * 1000
    ) {
      return;
    }

    if (!this.config.apiKey) {
      this.logger.warn('AI Service', 'Enabled but no API key configured.');
      return;
    }

    const entries = this.history.get(channelId) ?? [];
    const batchIds = new Set(messages.map((m) => m.id));
    const previous = entries.filter((e) => !batchIds.has(e.id));

    const payload = this.buildEventPayload(trigger.guild, trigger.channel, previous, messages);

    try {
      const decision = await this.askAI(payload);
      this.lastDecisionAt = Date.now();

      if (!decision || decision.action !== 'reply' || !decision.message.trim()) return;

      if (this.isRateLimited()) return;

      if (Date.now() - trigger.createdTimestamp > 60_000) return;

      await this.sendDecision(trigger, decision);
    } catch (err) {
      this.logger.error('AI Service', 'Failed to evaluate batch', err as Error);
    }
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
    };

    let ids = this.historyIds.get(message.channelId);
    if (!ids) {
      ids = new Set();
      this.historyIds.set(message.channelId, ids);
    }
    if (ids.has(entry.id)) return;
    ids.add(entry.id);

    const entries = this.history.get(message.channelId) ?? [];
    entries.push(entry);
    if (entries.length > this.config.historySize) {
      const removed = entries.splice(0, entries.length - this.config.historySize);
      for (const old of removed) ids.delete(old.id);
    }
    this.history.set(message.channelId, entries);
  }

  private describeMessage(message: Message): string {
    const content = (message.content ?? '').replace(/\s+/g, ' ').trim();
    if (!content && message.attachments.size === 0) return '';

    const attachments = [...message.attachments.values()].slice(0, 3).map((a) => {
      const type = (a.contentType ?? '').toLowerCase();
      const name = a.name ?? 'attachment';
      const kind = type.startsWith('image/') ? 'image' : type.startsWith('video/') ? 'video' : type.startsWith('audio/') ? 'audio' : 'file';
      return `[${kind}: ${name}]`;
    });
    if (message.attachments.size > 3) attachments.push(`[+${message.attachments.size - 3} more]`);

    const trimmed = content.length > 500 ? `${content.slice(0, 500)}…` : content;
    return `${trimmed}${trimmed && attachments.length ? ' ' : ''}${attachments.join(' ')}`.trim();
  }

  private buildEventPayload(_guild: any, channel: any, previous: HistoryEntry[], batch: Message[]): string {
    const recent = previous.slice(-this.config.historySize).map((e) =>
      `[${this.moroccoClock(e.timestamp)}] ${e.authorName} (${e.authorId}): ${e.content}`
    );
    const incoming = batch.map((m) =>
      `[${this.moroccoClock(m.createdTimestamp)}] ${m.member?.displayName ?? m.author.username} (${m.author.id}): ${this.describeMessage(m)}`
    );

    const latest = incoming.length ? incoming[incoming.length - 1] : '(none)';
    const channelName = channel.name ?? channel.id;

    return [
      `<current_time>${new Date().toISOString()}</current_time>`,
      `<server>${_guild.name} — ${_guild.memberCount} members</server>`,
      `<channel id="${channel.id}">#${channelName}</channel>`,
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

  private async askAI(payload: string): Promise<{ action: string; message: string } | null> {
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${this.config.model}:generateContent?key=${this.config.apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${this.config.systemPrompt}\n\n${payload}\n\nRespond with JSON only: {"action":"reply"|"silent","message":"..."}` }] }],
          generationConfig: {
            temperature: this.config.temperature,
            maxOutputTokens: Math.min(this.config.maxMessageLength, 2000),
          },
        }),
        signal: AbortSignal.timeout(this.config.requestTimeoutMs),
      });

      if (!response.ok) {
        this.logger.error('AI Service', `API error: ${response.status}`);
        return null;
      }

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

      const jsonMatch = text.match(/\{[\s\S]*?\}/);
      if (!jsonMatch) return null;

      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.action === 'reply' && parsed.message) {
        return { action: 'reply', message: parsed.message };
      }
      return { action: 'silent', message: '' };
    } catch (err) {
      this.logger.error('AI Service', 'AI request failed', err as Error);
      return null;
    }
  }

  private async sendDecision(trigger: Message, decision: { action: string; message: string }): Promise<void> {
    const channel = trigger.channel;
    if (!trigger.guild || !channel.isTextBased() || channel.isDMBased()) return;

    const content = decision.message.slice(0, this.config.maxMessageLength).trim();
    if (!content) return;

    try {
      await channel.send({ content, allowedMentions: { parse: ['users'] } });

      this.lastReplyAt = Date.now();
      this.replyTimestamps.push(Date.now());

      this.addHistoryEntry(trigger.channelId, {
        id: 'ai-' + Date.now(),
        authorId: this.client?.user?.id ?? 'ai',
        authorName: this.config.displayName,
        content,
        timestamp: Date.now(),
        bot: true,
      });
    } catch (err) {
      this.logger.error('AI Service', 'Failed to send AI reply', err as Error);
    }
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
    if (entries.length > this.config.historySize) {
      const removed = entries.splice(0, entries.length - this.config.historySize);
      for (const old of removed) ids.delete(old.id);
    }
    this.history.set(channelId, entries);
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

  public async shutdown(): Promise<void> {
    for (const batch of this.batches.values()) clearTimeout(batch.timer);
    this.batches.clear();
    this.history.clear();
    this.historyIds.clear();
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
      .setDescription('Ask the AI a question')
      .addStringOption((o: any) =>
        o.setName('question').setDescription('Your question').setRequired(true),
      ),
    execute: async (interaction: any) => {
      await interaction.deferReply();
      const question = interaction.options.getString('question', true);

      try {
        const payload = `<user_message>${question}</user_message>\nDecide: reply or silent?`;
        const decision = await (this.service as any).askAI(payload);
        if (decision && decision.action === 'reply') {
          await interaction.editReply(`🤖 **${this.config.displayName}**: ${decision.message}`);
        } else {
          await interaction.editReply('🤖 I choose to stay silent on that one.');
        }
      } catch (err) {
        this.logger.error('AI Commands', 'Failed to ask AI', err as Error);
        await interaction.editReply('Failed to get AI response.');
      }
    },
  };

  private chatCommand: any = {
    data: new (require('discord.js').SlashCommandBuilder)()
      .setName('chat')
      .setDescription('Chat with the AI')
      .addStringOption((o: any) =>
        o.setName('message').setDescription('Your message').setRequired(true),
      ),
    execute: async (interaction: any) => {
      await interaction.deferReply();
      const message = interaction.options.getString('message', true);

      try {
        const payload = `<user_message>${message}</user_message>\nDecide: reply or silent?`;
        const decision = await (this.service as any).askAI(payload);
        if (decision && decision.action === 'reply') {
          await interaction.editReply(`🤖 **${this.config.displayName}**: ${decision.message}`);
        } else {
          await interaction.editReply('🤖 I choose to stay silent on that one.');
        }
      } catch (err) {
        this.logger.error('AI Commands', 'Failed to chat with AI', err as Error);
        await interaction.editReply('Failed to get AI response.');
      }
    },
  };
}
