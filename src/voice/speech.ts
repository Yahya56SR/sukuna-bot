/**
 * Turns a decided reply into spoken audio with the Gemini Live API.
 *
 * The chat session is decision-oriented (every turn must end in a tool call),
 * so its own audio does not reliably match the message that gets posted. This
 * module runs one short Live turn whose only job is to read that message out
 * loud, and streams the resulting PCM straight into Discord's player.
 */

import { GoogleGenAI, Modality, type LiveConnectConfig, type Session } from '@google/genai';
import { PassThrough, type Readable } from 'node:stream';
import { PcmToDiscord } from './pcm.js';

/** Gemini's prebuilt Live voices. */
export const VOICE_NAMES = [
  'Aoede',
  'Kore',
  'Leda',
  'Puck',
  'Charon',
  'Fenrir',
  'Orus',
  'Zephyr',
] as const;

export const DEFAULT_VOICE_NAME = 'Aoede';

const DEFAULT_TIMEOUT_MS = 45_000;
const MAX_SPEECH_CHARS = 600;
const OUTPUT_RATE = 24_000;

export interface SpeechOptions {
  apiKey: string;
  /** Live model id, e.g. gemini-3.8-live. */
  model: string;
  voiceName?: string;
  timeoutMs?: number;
}

/** Reads SUKUNA_VOICE_NAME, falling back to a warm prebuilt voice. */
export function resolveVoiceName(): string {
  const configured = process.env.SUKUNA_VOICE_NAME?.trim();
  return configured || DEFAULT_VOICE_NAME;
}

/** Strips Discord markup so the model does not read ids and asterisks aloud. */
export function sanitizeForSpeech(text: string): string {
  return text
    .replace(/<@[!&]?\d+>/g, '')
    .replace(/<#\d+>/g, '')
    .replace(/<a?:\w+:\d+>/g, '')
    .replace(/[*_~`|]{1,3}/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_SPEECH_CHARS);
}

const SPEECH_INSTRUCTION = `You are the voice of 爱 Doctora, a girl talking with friends in a Discord server.

You will receive exactly one message. Read it out loud, word for word, like you are saying it in a voice call:
- Keep the same words, the same order and the same tone. Do not add, remove, shorten or explain anything.
- Keep the personality: warm, playful, a little sarcastic, Moroccan Darija in Arabizi with French or English when the text switches.
- Never read emoji names, mention markup or formatting characters aloud.
- Do not answer the message and do not call any tools. Just say it.`;

/**
 * Starts one Live turn that reads `text` out loud.
 *
 * Returns a readable stream of 48 kHz stereo s16le PCM (Discord's Raw format).
 * The stream always ends: on turn completion, on error, or on timeout.
 */
export function createSpeechStream(text: string, options: SpeechOptions): Readable {
  if (!options.apiKey) throw new Error('createSpeechStream requires a Gemini API key');

  const spoken = sanitizeForSpeech(text);
  if (!spoken) throw new Error('Nothing to speak');

  const ai = new GoogleGenAI({ apiKey: options.apiKey });
  const source = new PassThrough();
  const stream = source.pipe(new PcmToDiscord(OUTPUT_RATE));
  const timeoutMs = Math.max(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 5_000);

  let session: Session | null = null;
  let finished = false;

  const finish = (): void => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);

    const open = session;
    session = null;
    if (open) {
      try {
        open.close();
      } catch {
        /* already closed */
      }
    }
    source.end();
  };

  const fail = (error: unknown): void => {
    if (!finished) {
      console.warn('[Voice] Speech turn failed:', error instanceof Error ? error.message : error);
    }
    finish();
  };

  const timer = setTimeout(() => fail(new Error(`speech timed out after ${timeoutMs}ms`)), timeoutMs);
  timer.unref?.();

  const config: LiveConnectConfig = {
    responseModalities: [Modality.AUDIO],
    speechConfig: {
      voiceConfig: { prebuiltVoiceConfig: { voiceName: options.voiceName || DEFAULT_VOICE_NAME } },
    },
    systemInstruction: { parts: [{ text: SPEECH_INSTRUCTION }] },
    temperature: 1,
  };

  void ai.live
    .connect({
      model: options.model,
      config,
      callbacks: {
        onmessage: (message) => {
          if (finished) return;

          for (const part of message.serverContent?.modelTurn?.parts ?? []) {
            const data = part.inlineData?.data;
            const mimeType = part.inlineData?.mimeType ?? '';
            if (!data || !mimeType.startsWith('audio/')) continue;
            source.write(Buffer.from(data, 'base64'));
          }

          if (message.serverContent?.interrupted) finish();
          if (message.serverContent?.turnComplete) finish();
        },
        onerror: (event) => {
          const error = (event as { error?: unknown } | undefined)?.error ?? event;
          fail(error);
        },
        onclose: () => finish(),
      },
    })
    .then((live) => {
      if (finished) {
        try {
          live.close();
        } catch {
          /* already closed */
        }
        return;
      }

      session = live;
      try {
        live.sendClientContent({
          turns: [{ role: 'user', parts: [{ text: spoken }] }],
          turnComplete: true,
        });
      } catch (error) {
        fail(error);
      }
    })
    .catch(fail);

  // The stream is consumed by the voice player; a teardown must not leak the socket.
  stream.once('close', finish);

  return stream;
}
