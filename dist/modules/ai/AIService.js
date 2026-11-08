"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AICommands = exports.AIService = void 0;
class AIService {
    constructor(logger, config) {
        this.client = null;
        this.history = new Map();
        this.historyIds = new Map();
        this.batches = new Map();
        this.replyTimestamps = [];
        this.lastReplyAt = 0;
        this.lastDecisionAt = 0;
        this.logger = logger;
        this.config = config;
    }
    setDb(_db) {
    }
    setClient(client) {
        this.client = client;
    }
    async initialize() {
        this.logger.info('AI Service', 'AI persona system initialized');
    }
    handleMessage(message) {
        if (!message.guild || message.system || !this.config.enabled)
            return;
        if (!this.config.channelIds.includes(message.channelId))
            return;
        if (message.author.bot)
            return;
        if (!message.content.trim() && message.attachments.size === 0)
            return;
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
        const batch = {
            messages: [message],
            timer: setTimeout(() => {
                this.batches.delete(message.channelId);
                void this.flushBatch(message.channelId, batch.messages);
            }, Math.max(this.config.batchWindowMs, 250)),
        };
        this.batches.set(message.channelId, batch);
    }
    async flushBatch(channelId, messages) {
        if (!this.config.enabled || !this.config.channelIds.includes(channelId))
            return;
        const trigger = messages[messages.length - 1];
        if (!trigger || !trigger.guild)
            return;
        if (this.isRateLimited())
            return;
        if (this.config.decisionCooldownSeconds > 0 &&
            Date.now() - this.lastDecisionAt < this.config.decisionCooldownSeconds * 1000) {
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
            if (!decision || decision.action !== 'reply' || !decision.message.trim())
                return;
            if (this.isRateLimited())
                return;
            if (Date.now() - trigger.createdTimestamp > 60_000)
                return;
            await this.sendDecision(trigger, decision);
        }
        catch (err) {
            this.logger.error('AI Service', 'Failed to evaluate batch', err);
        }
    }
    isRateLimited() {
        const now = Date.now();
        if (this.config.replyCooldownSeconds > 0 && now - this.lastReplyAt < this.config.replyCooldownSeconds * 1000) {
            return true;
        }
        this.pruneReplyTimestamps(now);
        return this.config.maxRepliesPerHour > 0 && this.replyTimestamps.length >= this.config.maxRepliesPerHour;
    }
    pruneReplyTimestamps(now) {
        const cutoff = now - 60 * 60 * 1000;
        while (this.replyTimestamps.length > 0 && (this.replyTimestamps[0] ?? 0) < cutoff) {
            this.replyTimestamps.shift();
        }
    }
    addHistory(message) {
        const content = this.describeMessage(message);
        if (!content)
            return;
        const entry = {
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
        if (ids.has(entry.id))
            return;
        ids.add(entry.id);
        const entries = this.history.get(message.channelId) ?? [];
        entries.push(entry);
        if (entries.length > this.config.historySize) {
            const removed = entries.splice(0, entries.length - this.config.historySize);
            for (const old of removed)
                ids.delete(old.id);
        }
        this.history.set(message.channelId, entries);
    }
    describeMessage(message) {
        const content = (message.content ?? '').replace(/\s+/g, ' ').trim();
        if (!content && message.attachments.size === 0)
            return '';
        const attachments = [...message.attachments.values()].slice(0, 3).map((a) => {
            const type = (a.contentType ?? '').toLowerCase();
            const name = a.name ?? 'attachment';
            const kind = type.startsWith('image/') ? 'image' : type.startsWith('video/') ? 'video' : type.startsWith('audio/') ? 'audio' : 'file';
            return `[${kind}: ${name}]`;
        });
        if (message.attachments.size > 3)
            attachments.push(`[+${message.attachments.size - 3} more]`);
        const trimmed = content.length > 500 ? `${content.slice(0, 500)}…` : content;
        return `${trimmed}${trimmed && attachments.length ? ' ' : ''}${attachments.join(' ')}`.trim();
    }
    buildEventPayload(_guild, channel, previous, batch) {
        const recent = previous.slice(-this.config.historySize).map((e) => `[${this.moroccoClock(e.timestamp)}] ${e.authorName} (${e.authorId}): ${e.content}`);
        const incoming = batch.map((m) => `[${this.moroccoClock(m.createdTimestamp)}] ${m.member?.displayName ?? m.author.username} (${m.author.id}): ${this.describeMessage(m)}`);
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
    async askAI(payload) {
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
            if (!jsonMatch)
                return null;
            const parsed = JSON.parse(jsonMatch[0]);
            if (parsed.action === 'reply' && parsed.message) {
                return { action: 'reply', message: parsed.message };
            }
            return { action: 'silent', message: '' };
        }
        catch (err) {
            this.logger.error('AI Service', 'AI request failed', err);
            return null;
        }
    }
    async sendDecision(trigger, decision) {
        const channel = trigger.channel;
        if (!trigger.guild || !channel.isTextBased() || channel.isDMBased())
            return;
        const content = decision.message.slice(0, this.config.maxMessageLength).trim();
        if (!content)
            return;
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
        }
        catch (err) {
            this.logger.error('AI Service', 'Failed to send AI reply', err);
        }
    }
    addHistoryEntry(channelId, entry) {
        let ids = this.historyIds.get(channelId);
        if (!ids) {
            ids = new Set();
            this.historyIds.set(channelId, ids);
        }
        if (ids.has(entry.id))
            return;
        ids.add(entry.id);
        const entries = this.history.get(channelId) ?? [];
        entries.push(entry);
        if (entries.length > this.config.historySize) {
            const removed = entries.splice(0, entries.length - this.config.historySize);
            for (const old of removed)
                ids.delete(old.id);
        }
        this.history.set(channelId, entries);
    }
    moroccoClock(timestamp) {
        try {
            return new Intl.DateTimeFormat('en-GB', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: false,
                timeZone: 'Africa/Casablanca',
            }).format(new Date(timestamp));
        }
        catch {
            return new Date(timestamp).toISOString().slice(11, 16);
        }
    }
    async shutdown() {
        for (const batch of this.batches.values())
            clearTimeout(batch.timer);
        this.batches.clear();
        this.history.clear();
        this.historyIds.clear();
        this.logger.info('AI Service', 'AI service shutdown');
    }
}
exports.AIService = AIService;
class AICommands {
    constructor(service, logger, config) {
        this.askCommand = {
            data: new (require('discord.js').SlashCommandBuilder)()
                .setName('ask')
                .setDescription('Ask the AI a question')
                .addStringOption((o) => o.setName('question').setDescription('Your question').setRequired(true)),
            execute: async (interaction) => {
                await interaction.deferReply();
                const question = interaction.options.getString('question', true);
                try {
                    const payload = `<user_message>${question}</user_message>\nDecide: reply or silent?`;
                    const decision = await this.service.askAI(payload);
                    if (decision && decision.action === 'reply') {
                        await interaction.editReply(`🤖 **${this.config.displayName}**: ${decision.message}`);
                    }
                    else {
                        await interaction.editReply('🤖 I choose to stay silent on that one.');
                    }
                }
                catch (err) {
                    this.logger.error('AI Commands', 'Failed to ask AI', err);
                    await interaction.editReply('Failed to get AI response.');
                }
            },
        };
        this.chatCommand = {
            data: new (require('discord.js').SlashCommandBuilder)()
                .setName('chat')
                .setDescription('Chat with the AI')
                .addStringOption((o) => o.setName('message').setDescription('Your message').setRequired(true)),
            execute: async (interaction) => {
                await interaction.deferReply();
                const message = interaction.options.getString('message', true);
                try {
                    const payload = `<user_message>${message}</user_message>\nDecide: reply or silent?`;
                    const decision = await this.service.askAI(payload);
                    if (decision && decision.action === 'reply') {
                        await interaction.editReply(`🤖 **${this.config.displayName}**: ${decision.message}`);
                    }
                    else {
                        await interaction.editReply('🤖 I choose to stay silent on that one.');
                    }
                }
                catch (err) {
                    this.logger.error('AI Commands', 'Failed to chat with AI', err);
                    await interaction.editReply('Failed to get AI response.');
                }
            },
        };
        this.service = service;
        this.logger = logger;
        this.config = config;
    }
    getCommands() {
        return [this.askCommand, this.chatCommand];
    }
}
exports.AICommands = AICommands;
