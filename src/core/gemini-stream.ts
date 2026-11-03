/**
 * Google Gemini streaming client for Sukuna — one-off calls, no persistent connection.
 *
 * Uses models.generateContentStream to stream text chunks in real time.
 * Each call is independent: send the prompt, stream the response, done.
 */

import { GoogleGenAI, type GenerationConfig } from '@google/genai';

export interface GeminiStreamSukunaOptions {
  apiKey: string;
  model: string;
  systemPrompt: string;
  temperature?: number;
  maxTokens?: number;
  requestTimeoutMs?: number;
}

export type StreamChunkHandler = (chunk: string) => void;

export class GeminiStreamSukuna {
  private readonly ai: GoogleGenAI;
  private readonly model: string;
  private readonly systemPrompt: string;
  private readonly temperature: number;
  private readonly maxTokens: number | undefined;
  private readonly requestTimeoutMs: number;

  constructor(options: GeminiStreamSukunaOptions) {
    if (!options.apiKey) {
      throw new Error('GeminiStreamSukuna requires an API key');
    }
    this.ai = new GoogleGenAI({ apiKey: options.apiKey });
    this.model = options.model;
    this.systemPrompt = options.systemPrompt;
    this.temperature = Math.min(Math.max(options.temperature ?? 1, 0), 2);
    this.maxTokens = options.maxTokens;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
  }

  /**
   * Send one prompt and stream text chunks via the handler.
   * Resolves with the full assembled text.
   * No persistent connection — the stream closes when done.
   */
  async stream(
    prompt: string,
    onChunk: StreamChunkHandler,
    abortSignal?: AbortSignal,
  ): Promise<string> {
    const contents = [
      { role: 'user', parts: [{ text: this.systemPrompt + '\n\n' + prompt }] },
    ];

    const config: GenerationConfig = {
      temperature: this.temperature,
    };
    if (this.maxTokens) {
      config.maxOutputTokens = this.maxTokens;
    }

    const stream = await this.ai.models.generateContentStream({
      model: this.model,
      contents,
      config,
    });

    let fullText = '';

    for await (const chunk of stream) {
      if (abortSignal?.aborted) {
        break;
      }
      const text = chunk.text ?? '';
      if (text) {
        fullText += text;
        onChunk(text);
      }
    }

    return fullText;
  }

  close(): void {
    // No persistent connection to clean up
  }
}