/**
 * Google Gemini Live client for the Sukuna Discord persona.
 *
 * Keeps a conversational Live session, exposes function-calling tools, and
 * returns a single reply/silent decision per event. Everything fails silent:
 * timeouts, connection loss, malformed tool calls, and queue overflow all
 * produce `null` (treated as "do not speak").
 */

import {
  GoogleGenAI,
  InteractionStatus,
  Modality,
  type FunctionCall,
  type FunctionDeclaration,
  type FunctionResponse,
  type LiveConnectConfig,
  type LiveServerMessage,
  type Part,
  type Session,
  type ThinkingConfig,
  Type,
} from '@google/genai';
import { recordActivity } from './metrics.js';

export interface SukunaToolCall {
  id?: string;
  name?: string;
  args?: Record<string, unknown>;
}

export type SukunaToolExecutor = (
  call: SukunaToolCall,
) => Promise<Record<string, unknown>> | Record<string, unknown>;

export interface SukunaMedia {
  mimeType: string;
  data: string;
  label?: string;
}

export interface SukunaDecision {
  action: 'reply' | 'silent';
  message: string;
  stickerId?: string;
  replyToTrigger?: boolean;
  toolCalls: string[];
}

export interface GeminiLiveSukunaOptions {
  apiKey: string;
  model: string;
  systemPrompt: string;
  tools?: FunctionDeclaration[];
  thinkingLevel?: string;
  temperature?: number;
  requestTimeoutMs?: number;
  maxQueueSize?: number;
  /** Conversation this client belongs to, e.g. `text:<guildId>:<channelId>`. */
  label?: string;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;
const CONNECT_TIMEOUT_MS = 12_000;
const MAX_RECONNECT_ATTEMPTS = 4;
const RECONNECT_BASE_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 20_000;
// Gemini answers a spent key with close code 1011 / RESOURCE_EXHAUSTED. Retrying
// that immediately only burns the quota further, so park the client instead.
const QUOTA_BASE_BACKOFF_MS = 60_000;
const MAX_QUOTA_BACKOFF_MS = 15 * 60_000;
const QUOTA_LOG_INTERVAL_MS = 30_000;
const DEFAULT_MAX_QUEUE_SIZE = 10;
const MAX_EVENT_LENGTH = 24_000;
const MAX_REPLY_LENGTH = 2_000;

const SEND_MESSAGE_TOOL = 'send_message';
const SEND_STICKER_TOOL = 'send_sticker';
const STAY_SILENT_TOOL = 'stay_silent';

const DECISION_TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: SEND_MESSAGE_TOOL,
    description:
      'Send one Discord message as this character. Call exactly once when you choose to speak.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        message: {
          type: Type.STRING,
          description: 'The exact Discord message to send. Plain text, no labels or JSON.',
        },
        reply: {
          type: Type.BOOLEAN,
          description:
            'True to send as a native Discord reply to the triggering message. False or omitted for a bare channel message.',
        },
      },
      required: ['message'],
    },
  },
  {
    name: SEND_STICKER_TOOL,
    description:
      'Send one real server sticker as this character. Call get_server_stickers first to obtain a real sticker id.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        sticker_id: {
          type: Type.STRING,
          description: 'A real sticker id returned by get_server_stickers.',
        },
        message: {
          type: Type.STRING,
          description: 'Optional text to send with the sticker.',
        },
        reply: {
          type: Type.BOOLEAN,
          description:
            'True to send as a native Discord reply to the triggering message.',
        },
      },
      required: ['sticker_id'],
    },
  },
  {
    name: STAY_SILENT_TOOL,
    description: 'Choose not to speak this turn.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        reason: {
          type: Type.STRING,
          description: 'Optional one-line note for logs. Never shown in Discord.',
        },
      },
    },
  },
];

interface QueuedItem {
  text: string;
  media: SukunaMedia[];
  executeTool: SukunaToolExecutor;
  resolve: (value: SukunaDecision | null) => void;
  settled: boolean;
  timeoutMs: number;
  deadline: number;
  timer: ReturnType<typeof setTimeout> | null;
  decision: SukunaDecision | null;
  toolCallNames: string[];
  toolCalls: number;
  decisionNudges: number;
}

export class GeminiLiveSukuna {
  private readonly ai: GoogleGenAI;
  private readonly model: string;
  private readonly systemPrompt: string;
  private readonly declarations: FunctionDeclaration[];
  private readonly thinkingLevel: string | null;
  private readonly temperature: number;
  private readonly requestTimeoutMs: number;
  private readonly maxQueueSize: number;
  private readonly label: string;

  private session: Session | null = null;
  private connected = false;
  private sessionGeneration = 0;
  private connectPromise: Promise<void> | null = null;

  private queue: QueuedItem[] = [];
  private inFlight: QueuedItem | null = null;
  private pumping = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;

  /** Epoch ms until which no Live request is attempted (quota circuit breaker). */
  private unavailableUntil = 0;
  private quotaBackoffMs = 0;
  private lastQuotaLogAt = 0;

  private textBuffer = '';
  private transcriptBuffer = '';
  private turnCompleteSeen = false;
  private toolRoundInFlight = false;
  private toolExecuting = false;
  private closed = false;
  private loggedUnsupportedConfig = false;

  constructor(options: GeminiLiveSukunaOptions) {
    if (!options.apiKey) {
      throw new Error('GeminiLiveSukuna requires an API key');
    }
    if (!looksLikeLiveModel(options.model)) {
      console.warn(
        `[Sukuna:Live] Model "${options.model}" does not look like a Live API model. ` +
          'Sukuna only talks to Gemini over bidiGenerateContent (WebSocket); ' +
          'models that only support generateContent will fail to connect.',
      );
    }

    this.ai = new GoogleGenAI({ apiKey: options.apiKey });
    this.model = options.model;
    this.systemPrompt = options.systemPrompt;
    this.declarations = [...DECISION_TOOL_DECLARATIONS, ...(options.tools ?? [])];
    this.thinkingLevel = resolveThinkingLevel(options.model, options.thinkingLevel);
    this.temperature = Math.min(Math.max(options.temperature ?? 1, 0), 2);
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.maxQueueSize = options.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE;
    this.label = options.label ?? '';
  }

  ask(
    text: string,
    executeTool: SukunaToolExecutor,
    timeoutMs?: number,
    media: SukunaMedia[] = [],
  ): Promise<SukunaDecision | null> {
    if (!text || !text.trim() || this.closed) return Promise.resolve(null);

    if (this.unavailableUntil > Date.now()) {
      const waitMs = this.unavailableUntil - Date.now();
      if (Date.now() - this.lastQuotaLogAt >= QUOTA_LOG_INTERVAL_MS) {
        this.lastQuotaLogAt = Date.now();
        console.warn(
          `[Sukuna:Live] Skipping event — Gemini quota cooldown still active for ${Math.ceil(waitMs / 1000)}s`,
        );
      }
      return Promise.resolve(null);
    }

    if (this.queue.length >= this.maxQueueSize) {
      console.warn('[Sukuna:Live] Queue full — skipping this event', {
        queueLength: this.queue.length,
        maxQueueSize: this.maxQueueSize,
      });
      return Promise.resolve(null);
    }

    const effectiveTimeout = Math.max(timeoutMs ?? this.requestTimeoutMs, 1_000);

    logLive('event queued', {
      chars: text.length,
      media: media.length,
      queueLength: this.queue.length + 1,
    });

    return new Promise<SukunaDecision | null>((resolve) => {
      const item: QueuedItem = {
        text,
        media: media.slice(0, 4),
        executeTool,
        resolve,
        settled: false,
        timeoutMs: effectiveTimeout,
        deadline: Date.now() + effectiveTimeout,
        timer: null,
        decision: null,
        toolCallNames: [],
        toolCalls: 0,
        decisionNudges: 0,
      };
      item.timer = setTimeout(() => this.onItemDeadline(item, 'queued'), effectiveTimeout);

      this.queue.push(item);
      void this.pump();
    });
  }

  close(): void {
    this.closed = true;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.failAllQueued('persona closed');
    this.teardownSession('closed');
  }

  private async pump(): Promise<void> {
    if (this.pumping || this.closed) return;
    this.pumping = true;

    try {
      while (!this.closed && !this.inFlight && this.queue.length > 0) {
        if (!this.connected || !this.session) {
          try {
            await this.ensureConnected();
          } catch (err) {
            const description = describeError(err);
            console.warn('[Sukuna:Live] Connection attempt failed:', description);
            if (isQuotaError(description)) {
              this.startQuotaCooldown(description);
              this.failAllQueued('quota exhausted');
              return;
            }
            this.scheduleRetry();
            return;
          }
        }

        const item = this.queue[0];
        if (!item) return;

        if (item.settled) {
          this.removeFromQueue(item);
          continue;
        }
        if (Date.now() >= item.deadline) {
          this.failItem(item, 'expired while queued');
          continue;
        }

        this.dispatch(item);
        return;
      }
    } finally {
      this.pumping = false;
    }
  }

  private dispatch(item: QueuedItem): void {
    const session = this.session;
    if (!session) return;

    item.deadline = Date.now() + item.timeoutMs;
    if (item.timer) clearTimeout(item.timer);
    item.timer = setTimeout(() => this.onItemDeadline(item, 'in flight'), item.timeoutMs);

    this.inFlight = item;
    this.resetTurnBuffers();

    logLive('turn start', {
      conversation: this.label,
      model: this.model,
      chars: item.text.length,
      media: item.media.length,
      timeoutMs: item.timeoutMs,
    });
    logLive('prompt sent', { preview: preview(item.text, 1_200) });

    try {
      const parts: Part[] = [
        ...item.media.map((media) => ({
          inlineData: { mimeType: media.mimeType, data: media.data },
        })),
        { text: this.buildPayload(item.text) },
      ];

      session.sendClientContent({
        turns: [{ role: 'user', parts }],
        turnComplete: true,
      });
    } catch (err) {
      console.warn('[Sukuna:Live] Failed to send event:', describeError(err));
      this.failItem(item, 'send failed');
      this.teardownSession('send failed');
      void this.pump();
    }
  }

  private onItemDeadline(item: QueuedItem, stage: 'queued' | 'in flight'): void {
    if (item.settled) return;

    const wasInFlight = this.inFlight === item;
    this.failItem(item, `timed out (${stage})`);

    if (wasInFlight) {
      this.teardownSession('request timeout');
      void this.pump();
    }
  }

  private failItem(item: QueuedItem, reason: string): void {
    if (item.settled) return;
    item.settled = true;

    if (item.timer) {
      clearTimeout(item.timer);
      item.timer = null;
    }
    if (this.inFlight === item) this.inFlight = null;
    this.removeFromQueue(item);

    console.warn(`[Sukuna:Live] Event dropped (${reason})`);

    item.resolve(null);
  }

  private failAllQueued(reason: string): void {
    const pending = [...this.queue];
    this.queue = [];
    this.inFlight = null;
    if (pending.length > 0) {
      console.warn(`[Sukuna:Live] Dropping ${pending.length} queued event(s): ${reason}`);
    }
    for (const item of pending) {
      if (item.settled) continue;
      item.settled = true;
      if (item.timer) {
        clearTimeout(item.timer);
        item.timer = null;
      }
      item.resolve(null);
    }
  }

  private removeFromQueue(item: QueuedItem): void {
    const idx = this.queue.indexOf(item);
    if (idx >= 0) this.queue.splice(idx, 1);
  }

  private async ensureConnected(): Promise<void> {
    if (this.closed) throw new Error('Gemini Live Sukuna is closed');
    if (this.connected && this.session) return;
    if (this.connectPromise) return this.connectPromise;

    const promise = this.openSession();
    this.connectPromise = promise;
    try {
      await promise;
    } finally {
      if (this.connectPromise === promise) this.connectPromise = null;
    }
  }

  private async openSession(): Promise<void> {
    const generation = ++this.sessionGeneration;

    let rejectAttempt: (err: Error) => void = () => {};
    const attemptFailed = new Promise<never>((_, reject) => {
      rejectAttempt = reject;
    });
    void attemptFailed.catch(() => {});

    const connectPromise = this.ai.live.connect({
      model: this.model,
      config: this.buildConnectConfig(),
      callbacks: {
        onmessage: (message) => {
          if (generation !== this.sessionGeneration) return;
          try {
            this.handleServerMessage(message);
          } catch (err) {
            console.warn('[Sukuna:Live] Failed to handle server message:', describeError(err));
          }
        },
        onclose: (event) => {
          if (generation !== this.sessionGeneration) return;
          rejectAttempt(new Error(this.describeClose(event)));
          this.handleConnectionLost(generation, event);
        },
        onerror: (event) => {
          if (generation !== this.sessionGeneration) return;
          const err = (event as { error?: unknown } | undefined)?.error ?? event;
          rejectAttempt(err instanceof Error ? err : new Error(String(err)));
          this.handleConnectionLost(generation, err);
        },
      },
    });

    const timer = setTimeout(
      () => rejectAttempt(new Error(`connect timeout after ${CONNECT_TIMEOUT_MS}ms`)),
      CONNECT_TIMEOUT_MS,
    );

    try {
      const session = await Promise.race([connectPromise, attemptFailed]);

      if (generation !== this.sessionGeneration) {
        try {
          session.close();
        } catch {
          /* ignore */
        }
        throw new Error('Live session was superseded');
      }

      this.session = session;
      this.connected = true;
      this.reconnectAttempts = 0;
      this.resetTurnBuffers();

      logLive('session ready', {
        conversation: this.label,
        model: this.model,
        thinkingLevel: this.thinkingLevel ?? '(none)',
        output: 'audio+transcription',
        tools: this.declarations.length,
      });
    } catch (err) {
      void connectPromise
        .then((session) => {
          try {
            session.close();
          } catch {
            /* ignore */
          }
        })
        .catch(() => {
          /* ignore */
        });
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  private handleConnectionLost(generation: number, event: unknown): void {
    if (generation !== this.sessionGeneration) return;

    this.sessionGeneration += 1;
    this.session = null;
    this.connected = false;
    this.resetTurnBuffers();

    console.warn('[Sukuna:Live] Session lost:', describeError(event));

    if (this.inFlight) {
      this.failItem(this.inFlight, 'connection lost');
    }

    // A spent quota is not a transient socket failure: park the client instead
    // of reconnecting in a loop that keeps failing (code 1011 Resource exhausted).
    const description = describeError(event);
    if (isQuotaError(description)) {
      this.startQuotaCooldown(description);
      this.failAllQueued('quota exhausted');
      return;
    }

    if (this.queue.length > 0 && !this.closed) {
      this.scheduleRetry();
    }
  }

  /**
   * Stop talking to Gemini for a while after the key runs out. The delay
   * escalates while the outage lasts (60s → 15min) and resets as soon as a
   * request succeeds again.
   */
  private startQuotaCooldown(detail: string): void {
    const now = Date.now();
    if (now < this.unavailableUntil) return;

    this.quotaBackoffMs = this.quotaBackoffMs
      ? Math.min(this.quotaBackoffMs * 2, MAX_QUOTA_BACKOFF_MS)
      : QUOTA_BASE_BACKOFF_MS;
    this.unavailableUntil = now + this.quotaBackoffMs;
    this.lastQuotaLogAt = now;

    console.error(
      `[Sukuna:Live] Gemini quota exhausted — pausing Live requests for ` +
        `${Math.round(this.quotaBackoffMs / 1000)}s. The persona stays silent until then. ` +
        `Check the API key limits (per-minute and per-day quotas, and any other bot or the ` +
        `voice mode sharing the same key). Server said: ${detail}`,
    );

    recordActivity('error', 'Gemini quota exhausted — persona paused', {
      level: 'error',
      meta: {
        model: this.model,
        cooldownSeconds: Math.round(this.quotaBackoffMs / 1000),
        detail: preview(detail, 300),
      },
    });
  }

  private teardownSession(reason: string): void {
    this.sessionGeneration += 1;

    const session = this.session;
    this.session = null;
    this.connected = false;
    this.resetTurnBuffers();

    if (this.inFlight) {
      this.failItem(this.inFlight, reason);
    }

    if (session) {
      logLive('session closed', { conversation: this.label, reason });
      try {
        session.close();
      } catch {
        /* ignore */
      }
    }
  }

  private scheduleRetry(): void {
    if (this.closed || this.retryTimer) return;

    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.reconnectAttempts = 0;
      this.failAllQueued('connection unavailable');
      return;
    }

    this.reconnectAttempts += 1;
    const delay = Math.min(
      RECONNECT_BASE_DELAY_MS * 2 ** (this.reconnectAttempts - 1),
      MAX_RECONNECT_DELAY_MS,
    );

    console.warn(
      `[Sukuna:Live] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`,
    );

    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.pump();
    }, delay);
  }

  private buildConnectConfig(): LiveConnectConfig {
    const config: LiveConnectConfig = {
      systemInstruction: { parts: [{ text: this.systemPrompt }] },
      temperature: this.temperature,
      // TEXT-only output is rejected by the 3.8 Live models (the server closes
      // the session with code 1007 "response modalities (TEXT) is not
      // supported"), so request audio and read the transcript instead.
      // Verified against the l7aj-bot persona, which uses the same models.
      responseModalities: [Modality.AUDIO],
      outputAudioTranscription: {},
      // The socket is closed after every turn, so this only bounds the history
      // of the tool rounds inside a single turn.
      contextWindowCompression: { slidingWindow: {} },
      tools: [{ functionDeclarations: this.declarations }],
    };

    if (this.thinkingLevel) {
      config.thinkingConfig = {
        thinkingLevel: this.thinkingLevel as ThinkingConfig['thinkingLevel'],
      };
    }

    return config;
  }

  private buildPayload(text: string): string {
    const safe = text
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ')
      // Keep the tail: the newest messages matter more than the header.
      .slice(-MAX_EVENT_LENGTH);

    return `${safe}\n\nDecide now. Call exactly one of \`${SEND_MESSAGE_TOOL}\`, \`${SEND_STICKER_TOOL}\` or \`${STAY_SILENT_TOOL}\`.`;
  }

  private handleServerMessage(message: LiveServerMessage): void {
    if (this.closed) return;

    if (message.goAway) {
      logLive('session going away', { conversation: this.label });
    }

    const item = this.inFlight;
    if (!item) return;

    if (message.toolCall?.functionCalls?.length) {
      if (this.toolRoundInFlight && !this.toolExecuting) {
        this.toolRoundInFlight = false;
      }
      void this.handleToolCalls(item, message.toolCall.functionCalls);
      return;
    }

    const serverContent = message.serverContent;
    if (!serverContent) return;

    const hasFollowUpContent =
      (serverContent.modelTurn?.parts?.length ?? 0) > 0 ||
      Boolean(serverContent.outputTranscription?.text) ||
      Boolean(serverContent.interrupted);

    if (this.toolRoundInFlight && hasFollowUpContent) {
      this.toolRoundInFlight = false;
    }

    for (const part of serverContent.modelTurn?.parts ?? []) {
      if (part.text && !(part as { thought?: boolean }).thought) {
        this.textBuffer += part.text;
      }
    }

    if (serverContent.outputTranscription?.text) {
      this.transcriptBuffer += serverContent.outputTranscription.text;
    }

    if (serverContent.interrupted) {
      this.finishTurn(item, 'interrupted', true);
      return;
    }

    if (serverContent.turnComplete) {
      this.turnCompleteSeen = true;

      // A tool round is still running: the turnComplete for the tool-call turn
      // can arrive after the tool response. Wait for the follow-up generation.
      if (this.toolRoundInFlight) return;
      if (serverContent.interactionStatus === InteractionStatus.IN_PROGRESS) {
        return;
      }
      this.finishTurn(item, 'turnComplete');
      return;
    }

    if (this.turnCompleteSeen && serverContent.interactionStatus === InteractionStatus.IDLE) {
      this.finishTurn(item, 'idle');
    }
  }

  private async handleToolCalls(item: QueuedItem, calls: FunctionCall[]): Promise<void> {
    if (this.toolRoundInFlight || item.settled) return;

    this.toolRoundInFlight = true;
    this.turnCompleteSeen = false;
    this.toolExecuting = true;

    const generation = this.sessionGeneration;
    const responses: FunctionResponse[] = [];

    for (const call of calls.slice(0, 6)) {
      const name = call.name || 'unknown';
      item.toolCallNames.push(name);
      item.toolCalls += 1;

      logLive('tool call', {
        name,
        args: preview(JSON.stringify(call.args ?? {}), 600),
      });

      const response = await this.runTool(item, call);

      logLive('tool result', {
        name,
        result: preview(JSON.stringify(response), 600),
      });

      responses.push({
        id: call.id,
        name,
        response,
      });

      if (item.decision) break;
    }

    if (generation !== this.sessionGeneration || this.inFlight !== item || item.settled) {
      this.toolRoundInFlight = false;
      this.toolExecuting = false;
      return;
    }

    if (item.toolCalls > 10 && !item.decision) {
      this.toolExecuting = false;
      this.finishTurn(item, 'tool limit', true);
      return;
    }

    if (item.decision) {
      this.toolExecuting = false;
      this.finishTurn(item, 'decision', true);
      return;
    }

    try {
      this.session?.sendToolResponse({ functionResponses: responses });
    } catch (err) {
      console.warn('[Sukuna:Live] Failed to send tool responses:', describeError(err));
      this.toolExecuting = false;
      this.failItem(item, 'tool response failed');
      this.teardownSession('tool response failed');
      void this.pump();
      return;
    }

    this.toolExecuting = false;
  }

  private async runTool(item: QueuedItem, call: FunctionCall): Promise<Record<string, unknown>> {
    const name = call.name || '';

    if (name === SEND_MESSAGE_TOOL) {
      if (item.decision) {
        return { ok: false, error: 'A decision was already made for this turn.' };
      }

      const raw = typeof call.args?.message === 'string' ? call.args.message : '';
      const message = sanitizeReply(raw);
      if (!message) {
        return { ok: false, error: 'The message argument was empty.' };
      }

      item.decision = {
        action: 'reply',
        message: message.length > MAX_REPLY_LENGTH ? message.slice(0, MAX_REPLY_LENGTH) : message,
        replyToTrigger: toBoolean(call.args?.reply),
        toolCalls: [...item.toolCallNames],
      };
      return { ok: true, status: 'queued' };
    }

    if (name === SEND_STICKER_TOOL) {
      if (item.decision) {
        return { ok: false, error: 'A decision was already made for this turn.' };
      }

      const rawStickerId = call.args?.sticker_id;
      const stickerId =
        typeof rawStickerId === 'string'
          ? rawStickerId.trim()
          : typeof rawStickerId === 'number'
            ? String(rawStickerId)
            : '';
      if (!/^\d{15,25}$/.test(stickerId)) {
        return {
          ok: false,
          error: 'A real numeric sticker id is required.',
        };
      }

      const raw = typeof call.args?.message === 'string' ? call.args.message : '';
      const message = sanitizeReply(raw);
      item.decision = {
        action: 'reply',
        message: message.length > MAX_REPLY_LENGTH ? message.slice(0, MAX_REPLY_LENGTH) : message,
        stickerId,
        replyToTrigger: toBoolean(call.args?.reply),
        toolCalls: [...item.toolCallNames],
      };
      return { ok: true, status: 'queued' };
    }

    if (name === STAY_SILENT_TOOL) {
      if (item.decision) {
        return { ok: false, error: 'A decision was already made for this turn.' };
      }
      item.decision = {
        action: 'silent',
        message: '',
        toolCalls: [...item.toolCallNames],
      };
      return { ok: true, status: 'silent' };
    }

    if (item.toolCalls > 10) {
      return { ok: false, error: 'Tool-call limit reached.' };
    }

    try {
      const result = await item.executeTool({
        id: call.id,
        name,
        args: call.args ?? {},
      });
      return result && typeof result === 'object' ? result : { result: String(result) };
    } catch (err) {
      console.warn(`[Sukuna:Live] Tool "${name}" failed:`, describeError(err));
      return { ok: false, error: describeError(err) };
    }
  }

  private finishTurn(item: QueuedItem | null, reason: string, forceReset = false): void {
    const target = item ?? this.inFlight;
    const responseText = (this.transcriptBuffer || this.textBuffer).trim();
    const decision = target?.decision ?? this.parseDecision(responseText);
    const toolCalls = target?.toolCallNames ?? [];

    logLive('model output', {
      reason,
      toolCalls: toolCalls.length ? toolCalls.join(',') : '(none)',
      text: responseText ? preview(responseText, 2_000) : '(no text or transcript)',
    });

    if (
      target &&
      !decision &&
      !target.settled &&
      !forceReset &&
      target.toolCallNames.length > 0 &&
      target.decisionNudges < 1 &&
      (reason === 'turnComplete' || reason === 'idle') &&
      this.session
    ) {
      this.resetTurnBuffers();
      target.decisionNudges += 1;

      try {
        this.session.sendClientContent({
          turns: [
            {
              role: 'user',
              parts: [
                {
                  text:
                    'You have the tool result. Do not describe it. Call exactly one decision tool now: ' +
                    'send_message, send_sticker, or stay_silent.',
                },
              ],
            },
          ],
          turnComplete: true,
        });
      } catch {
        /* fall through to normal fail-silent */
      }
      return;
    }

    this.resetTurnBuffers();

    if (!target) return;

    this.inFlight = null;
    if (target.timer) {
      clearTimeout(target.timer);
      target.timer = null;
    }
    this.removeFromQueue(target);

    if (!target.settled) {
      target.settled = true;
      target.resolve(decision ? { ...decision, toolCalls } : null);
    }

    // A real answer proves the key is usable again; stop backing off.
    this.quotaBackoffMs = 0;
    this.unavailableUntil = 0;

    if (decision) {
      logLive('decision', {
        action: decision.action,
        source: target.decision ? 'tool call' : 'transcript fallback',
        reply: Boolean(decision.replyToTrigger),
        stickerId: decision.stickerId ?? null,
        chars: decision.message.length,
        text: decision.message ? preview(decision.message, 2_000) : '(silent)',
      });
    } else {
      logLive('decision', {
        action: 'none — failing silent',
        reason,
        toolCalls: toolCalls.length ? toolCalls.join(',') : '(none)',
      });
    }

    // One Discord event = one self-contained Live turn. Its history travels in
    // the payload, so keeping this socket would let the next event — another
    // channel, another DM, another guild — continue this conversation
    // server-side and mix the two contexts together. Always drop the socket.
    this.teardownSession(reason);

    void this.pump();
  }

  private resetTurnBuffers(): void {
    this.textBuffer = '';
    this.transcriptBuffer = '';
    this.turnCompleteSeen = false;
    this.toolRoundInFlight = false;
    this.toolExecuting = false;
  }

  private describeClose(event: unknown): string {
    const close = event as { code?: number; reason?: string } | undefined;
    const reason = close?.reason || 'no reason provided';
    const message = `Live session closed (code ${close?.code ?? '?'}): ${reason}`;

    if (!this.loggedUnsupportedConfig && /not supported/i.test(reason)) {
      this.loggedUnsupportedConfig = true;
      console.error(
        '[Sukuna:Live] The model rejected the session configuration. Use a Live-capable model ' +
          '(e.g. gemini-3.8-live) and request AUDIO output — TEXT response modalities are not ' +
          `supported by the 3.8 Live models. Server said: ${reason}`,
      );
    }

    return message;
  }

  private parseDecision(raw: string): SukunaDecision | null {
    const json = extractJsonObject(raw);
    if (!json) return null;

    try {
      const parsed = JSON.parse(json) as Record<string, unknown>;
      const action = typeof parsed.action === 'string' ? parsed.action.trim().toLowerCase() : '';
      if (action === 'silent') {
        return { action: 'silent', message: '', toolCalls: [] };
      }
      if (action === 'reply') {
        const message = sanitizeReply(typeof parsed.message === 'string' ? parsed.message : '');
        return message ? { action: 'reply', message, toolCalls: [] } : null;
      }
    } catch {
      /* fall through */
    }
    return null;
  }
}

/* ---------------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------------- */

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Flatten and shorten text for console logging. */
function preview(text: string, max = 600): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (!flat) return '(empty)';
  return flat.length <= max ? flat : `${flat.slice(0, max)}… (${flat.length} chars)`;
}

function logLive(event: string, data?: Record<string, unknown>): void {
  if (data) console.log(`[Sukuna:Live] ${event}`, data);
  else console.log(`[Sukuna:Live] ${event}`);
}

/** RESOURCE_EXHAUSTED / 429 style failures must not be retried in a loop. */
function isQuotaError(text: string): boolean {
  if (/\b429\b/.test(text)) return true;
  return /(quota|exhausted|rate.?limit)/i.test(text);
}

function toBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === 'true' || value === '1';
}

function sanitizeReply(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function extractJsonObject(text: string): string | null {
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

function looksLikeLiveModel(model: string): boolean {
  const name = model.replace(/^models\//, '').toLowerCase();
  return name.includes('live') || name.includes('native-audio');
}

function resolveThinkingLevel(model: string, level: string | undefined): string | null {
  const normalisedModel = model.replace(/^models\//, '');
  const explicit = level?.trim().toLowerCase() || null;

  if (normalisedModel === 'gemini-3.8-live') return null;
  if (normalisedModel === 'gemini-3.8-live-extended-thinking') return explicit ?? 'low';
  return explicit;
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object') {
    const record = err as { reason?: string; message?: string; code?: number };
    return record.reason || record.message || JSON.stringify(record);
  }
  return String(err);
}

/* ---------------------------------------------------------------------------
 * One-shot Live text turn (dashboard persona test)
 * ------------------------------------------------------------------------- */

export interface GeminiLiveTextOptions {
  apiKey: string;
  model: string;
  systemPrompt: string;
  prompt: string;
  temperature?: number;
  timeoutMs?: number;
}

/**
 * Run one real Sukuna turn against a Live model and return the text it would
 * post to Discord ('' when it chooses to stay silent).
 *
 * Opens a WebSocket (bidiGenerateContent) session, sends a single event,
 * executes nothing, and closes. Sukuna never calls `generateContent`, because
 * Live-only models reject it.
 */
export async function generateLiveText(options: GeminiLiveTextOptions): Promise<string> {
  if (!options.apiKey) throw new Error('generateLiveText requires an API key');

  const ai = new GoogleGenAI({ apiKey: options.apiKey });
  const timeoutMs = Math.max(options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS, 1_000);

  let session: Session | null = null;
  let settled = false;
  let collected = '';

  return new Promise<string>((resolve, reject) => {
    function finish(error: Error | null): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      const open = session;
      session = null;
      if (open) {
        try {
          open.close();
        } catch {
          /* ignore */
        }
      }

      if (error) {
        console.warn('[Sukuna:Live] Persona test failed:', error.message);
        reject(error);
      } else {
        logLive('persona test result', {
          reply: collected.trim() ? preview(collected, 2_000) : '(stayed silent)',
        });
        resolve(collected.trim());
      }
    }

    const timer = setTimeout(() => {
      finish(new Error(`Live request timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const config: LiveConnectConfig = {
      systemInstruction: { parts: [{ text: options.systemPrompt }] },
      // Live 3.8 models reject TEXT; audio + transcription is the supported way.
      responseModalities: [Modality.AUDIO],
      outputAudioTranscription: {},
      temperature: Math.min(Math.max(options.temperature ?? 1, 0), 2),
      // Same decision contract as production, so the test exercises the real path.
      tools: [{ functionDeclarations: DECISION_TOOL_DECLARATIONS }],
    };

    ai.live
      .connect({
        model: options.model,
        config,
        callbacks: {
          onmessage: (message) => {
            for (const call of message.toolCall?.functionCalls ?? []) {
              logLive('persona test tool call', {
                name: call.name ?? 'unknown',
                args: preview(JSON.stringify(call.args ?? {}), 600),
              });
              if (call.name === STAY_SILENT_TOOL) {
                collected = '';
                finish(null);
                return;
              }
              if (call.name === SEND_MESSAGE_TOOL || call.name === SEND_STICKER_TOOL) {
                const raw = typeof call.args?.message === 'string' ? call.args.message : '';
                collected = sanitizeReply(raw);
                finish(null);
                return;
              }
            }

            for (const part of message.serverContent?.modelTurn?.parts ?? []) {
              if (part.text && !(part as { thought?: boolean }).thought) collected += part.text;
            }
            if (message.serverContent?.outputTranscription?.text) {
              collected += message.serverContent.outputTranscription.text;
            }
            if (message.serverContent?.turnComplete) finish(null);
          },
          onerror: (event) => {
            const err = (event as { error?: unknown } | undefined)?.error ?? event;
            finish(err instanceof Error ? err : new Error(describeError(err)));
          },
          onclose: (event) => {
            const close = event as { code?: number; reason?: string } | undefined;
            if (collected.trim()) {
              finish(null);
              return;
            }
            finish(
              new Error(
                `Live session closed (code ${close?.code ?? '?'}): ${close?.reason || 'no reason provided'}`,
              ),
            );
          },
        },
      })
      .then((opened) => {
        if (settled) {
          try {
            opened.close();
          } catch {
            /* ignore */
          }
          return;
        }

        session = opened;
        logLive('persona test session ready', { model: options.model });
        try {
          opened.sendClientContent({
            turns: [
              {
                role: 'user',
                parts: [
                  {
                    text:
                      options.prompt +
                      `\n\nDecide now. Call exactly one of \`${SEND_MESSAGE_TOOL}\`, \`${SEND_STICKER_TOOL}\` or \`${STAY_SILENT_TOOL}\`.`,
                  },
                ],
              },
            ],
            turnComplete: true,
          });
        } catch (error) {
          finish(error instanceof Error ? error : new Error(String(error)));
        }
      })
      .catch((error) => finish(error instanceof Error ? error : new Error(describeError(error))));
  });
}
