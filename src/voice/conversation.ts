/**
 * Duplex voice conversation with the Gemini Live API.
 *
 * Mic path:  Discord opus (48 kHz stereo) → decoded PCM → 16 kHz mono → 20 ms
 *            frames → `sendRealtimeInput`. A short silence tail follows every
 *            utterance so the server side VAD can close the turn; while the
 *            channel is quiet nothing is streamed (and nothing is billed).
 * Ear path:  Live audio chunks → 48 kHz stereo PCM → the guild's audio player.
 *            `serverContent.interrupted` flushes playback (barge-in).
 *
 * The Live socket is reconnected with backoff because Live sessions are capped
 * in duration and can be closed by the server at any time.
 */

import { GoogleGenAI, Modality, type LiveConnectConfig, type Session } from '@google/genai';
import {
  StreamType,
  createAudioResource,
  type AudioPlayer,
  type AudioReceiveStream,
  type VoiceConnection,
} from '@discordjs/voice';
import { PassThrough, type Transform } from 'node:stream';
import { opus } from 'prism-media';
import { DiscordPcmTo16k, PcmToDiscord } from './pcm.js';

const INPUT_RATE = 16_000;
const OUTPUT_RATE = 24_000;
const FRAME_SAMPLES = 320; // 20 ms at 16 kHz
const FRAME_BYTES = FRAME_SAMPLES * 2;
const MAX_INPUT_BYTES = FRAME_BYTES * 100; // ~2 s of backlog
/** How long silence keeps flowing after the last decoded packet (VAD tail). */
const INPUT_TAIL_MS = 1_500;
const MAX_RECONNECTS = 6;
const STABLE_SESSION_MS = 60_000;

export interface VoiceConversationOptions {
  connection: VoiceConnection;
  player: AudioPlayer;
  apiKey: string;
  model: string;
  systemPrompt: string;
  voiceName: string;
  thinkingLevel?: string;
  /** Called when the conversation gives up after repeated Live failures. */
  onStopped?: () => void;
}

interface Listener {
  stream: AudioReceiveStream;
  decoder: Transform;
  downmix: Transform;
}

export class VoiceConversation {
  private readonly options: VoiceConversationOptions;
  private readonly listeners = new Map<string, Listener>();

  private session: Session | null = null;
  private output: PassThrough | null = null;
  private inputBuffer: Buffer = Buffer.alloc(0);
  private ticker: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnects = 0;
  private connectedAt = 0;
  private lastInputAt = 0;
  private sendFailures = 0;
  private closed = false;
  private speakingModel = false;

  private readonly handleSpeakingStart = (userId: string): void => this.listenTo(userId);

  constructor(options: VoiceConversationOptions) {
    this.options = options;
  }

  /** Opens the Live session and starts pumping mic audio. */
  async start(): Promise<void> {
    await this.connect();

    this.options.connection.receiver.speaking.on('start', this.handleSpeakingStart);
    this.ticker = setInterval(() => this.pump(), 20);
    this.ticker.unref?.();
  }

  /** True while the model's audio is still being played. */
  get speaking(): boolean {
    return this.speakingModel;
  }

  /** Number of members currently being decoded. */
  get listenerCount(): number {
    return this.listeners.size;
  }

  stop(): void {
    if (this.closed) return;
    this.closed = true;

    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;

    try {
      this.options.connection.receiver.speaking.off('start', this.handleSpeakingStart);
    } catch {
      /* receiver already gone */
    }

    for (const listener of this.listeners.values()) {
      listener.stream.destroy();
      listener.decoder.destroy();
      listener.downmix.destroy();
    }
    this.listeners.clear();

    this.closeSession();
    this.interrupt();
  }

  private buildConfig(): LiveConnectConfig {
    const config: LiveConnectConfig = {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: this.options.voiceName || 'Aoede' },
        },
      },
      systemInstruction: { parts: [{ text: this.options.systemPrompt }] },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      realtimeInputConfig: {
        automaticActivityDetection: { disabled: false, silenceDurationMs: 700 },
      },
      temperature: 1,
      // Same bounded context trick as the text persona; voice sessions run long.
      contextWindowCompression: { slidingWindow: {} },
    };

    // gemini-3.8-live rejects thinkingConfig; only the extended-thinking model
    // accepts a level, so keep it absent unless the dashboard set one.
    if (this.options.thinkingLevel) {
      config.thinkingConfig = {
        thinkingLevel: this.options.thinkingLevel as NonNullable<LiveConnectConfig['thinkingConfig']>['thinkingLevel'],
      };
    }

    return config;
  }

  private async connect(): Promise<void> {
    if (this.closed) return;

    const ai = new GoogleGenAI({ apiKey: this.options.apiKey });
    const session = await ai.live.connect({
      model: this.options.model,
      config: this.buildConfig(),
      callbacks: {
        onmessage: (message) => this.onMessage(message),
        onerror: (event) => {
          const error = (event as { error?: unknown } | undefined)?.error ?? event;
          this.scheduleReconnect(error instanceof Error ? error.message : String(error));
        },
        onclose: () => this.scheduleReconnect('socket closed'),
      },
    });

    if (this.closed) {
      try {
        session.close();
      } catch {
        /* already closed */
      }
      return;
    }

    this.session = session;
    this.connectedAt = Date.now();
    this.sendFailures = 0;
  }

  private onMessage(message: {
    serverContent?: {
      modelTurn?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> };
      interrupted?: boolean;
      turnComplete?: boolean;
    };
    goAway?: unknown;
  }): void {
    if (this.closed) return;

    if (message.serverContent) {
      for (const part of message.serverContent.modelTurn?.parts ?? []) {
        const data = part.inlineData?.data;
        const mimeType = part.inlineData?.mimeType ?? '';
        if (!data || !mimeType.startsWith('audio/')) continue;
        this.ensureOutput().write(Buffer.from(data, 'base64'));
      }

      if (message.serverContent.interrupted) this.interrupt();
      if (message.serverContent.turnComplete) this.endOutput();
    }

    if (message.goAway) this.scheduleReconnect('goAway');
  }

  private pump(): void {
    const session = this.session;
    if (this.closed || !session) return;

    // Nobody is talking: stop streaming (and billing) silence. The tail above
    // is longer than silenceDurationMs, so the VAD has already closed the turn.
    // Sending resumes automatically with the next decoded packet.
    if (this.lastInputAt === 0 || Date.now() - this.lastInputAt > INPUT_TAIL_MS) {
      this.inputBuffer = Buffer.alloc(0);
      return;
    }

    const frame = this.takeInput(FRAME_BYTES);
    try {
      session.sendRealtimeInput({
        audio: { data: frame.toString('base64'), mimeType: `audio/pcm;rate=${INPUT_RATE}` },
      });
      this.sendFailures = 0;
    } catch (error) {
      this.sendFailures += 1;
      if (this.sendFailures === 1) {
        console.warn('[Voice] Mic frame rejected:', error instanceof Error ? error.message : error);
      }
      if (this.sendFailures > 20) this.scheduleReconnect('mic frames rejected');
    }
  }

  private takeInput(bytes: number): Buffer {
    if (this.inputBuffer.length >= bytes) {
      const frame = this.inputBuffer.subarray(0, bytes);
      this.inputBuffer = this.inputBuffer.subarray(bytes);
      return frame;
    }

    const padded = Buffer.alloc(bytes);
    this.inputBuffer.copy(padded, 0, 0, Math.min(this.inputBuffer.length, bytes));
    this.inputBuffer = Buffer.alloc(0);
    return padded;
  }

  private pushInput(chunk: Buffer): void {
    if (this.closed) return;

    this.lastInputAt = Date.now();
    this.inputBuffer = this.inputBuffer.length > 0 ? Buffer.concat([this.inputBuffer, chunk]) : chunk;
    if (this.inputBuffer.length > MAX_INPUT_BYTES) {
      this.inputBuffer = this.inputBuffer.subarray(this.inputBuffer.length - MAX_INPUT_BYTES);
    }
  }

  private listenTo(userId: string): void {
    if (this.closed || this.listeners.has(userId)) return;

    let stream: AudioReceiveStream;
    try {
      stream = this.options.connection.receiver.subscribe(userId);
    } catch (error) {
      console.warn('[Voice] Could not subscribe to member audio:', error instanceof Error ? error.message : error);
      return;
    }

    const decoder = new opus.Decoder({ rate: 48_000, channels: 2, frameSize: 960 });
    const downmix = new DiscordPcmTo16k();

    const cleanup = (): void => {
      if (this.listeners.get(userId)?.stream !== stream) return;
      this.listeners.delete(userId);
      stream.destroy();
      decoder.destroy();
      downmix.destroy();
    };

    stream.on('error', cleanup);
    stream.once('end', cleanup);
    stream.once('close', cleanup);
    decoder.on('error', cleanup);
    downmix.on('error', cleanup);
    downmix.on('data', (chunk: Buffer) => this.pushInput(chunk));

    stream.pipe(decoder).pipe(downmix);
    this.listeners.set(userId, { stream, decoder, downmix });
  }

  private ensureOutput(): PassThrough {
    if (this.output) return this.output;

    const source = new PassThrough();
    this.output = source;
    this.speakingModel = true;

    try {
      const resource = createAudioResource(source.pipe(new PcmToDiscord(OUTPUT_RATE)), {
        inputType: StreamType.Raw,
      });
      this.options.player.play(resource);
    } catch (error) {
      console.warn('[Voice] Could not start playback:', error instanceof Error ? error.message : error);
    }

    return source;
  }

  private endOutput(): void {
    const output = this.output;
    this.output = null;
    this.speakingModel = false;
    if (output) output.end();
  }

  /** Stops the current model turn (barge-in or reconnect). */
  private interrupt(): void {
    const output = this.output;
    this.output = null;
    this.speakingModel = false;
    if (!output) return;

    try {
      output.destroy();
    } catch {
      /* already destroyed */
    }
    try {
      this.options.player.stop(true);
    } catch {
      /* player already idle */
    }
  }

  private closeSession(): void {
    const session = this.session;
    this.session = null;
    if (!session) return;
    try {
      session.close();
    } catch {
      /* already closed */
    }
  }

  private scheduleReconnect(reason: string): void {
    if (this.closed) return;

    this.closeSession();
    this.interrupt();

    if (this.reconnectTimer) return;

    // Only a session that actually lived resets the backoff; otherwise a server
    // that accepts the socket and immediately closes it would loop forever.
    if (this.connectedAt > 0 && Date.now() - this.connectedAt >= STABLE_SESSION_MS) {
      this.reconnects = 0;
    }
    this.connectedAt = 0;

    if (this.reconnects >= MAX_RECONNECTS) {
      console.warn('[Voice] Voice conversation stopped after repeated failures:', reason);
      this.stop();
      this.options.onStopped?.();
      return;
    }

    this.reconnects += 1;
    const delay = Math.min(1_000 * 2 ** (this.reconnects - 1), 15_000);
    console.warn(
      `[Voice] Live session lost (${reason}); reconnecting in ${Math.round(delay / 1000)}s ` +
        `(attempt ${this.reconnects}/${MAX_RECONNECTS})`,
    );

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect().catch((error: unknown) => {
        this.scheduleReconnect(
          error instanceof Error ? error.message : 'reconnect failed',
        );
      });
    }, delay);
    this.reconnectTimer.unref?.();
  }
}
