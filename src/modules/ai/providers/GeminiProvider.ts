import { AIProvider, AIMessage, AIResponse } from './AIProvider';

export interface GeminiProviderConfig {
  apiKey: string;
  model: string;
  baseURL?: string;
  maxTokens?: number;
  temperature?: number;
  /** When set, asks the model to answer with a JSON object (no markdown fences). */
  jsonMode?: boolean;
  timeoutMs?: number;
}

/**
 * Google AI Studio (Gemini) provider. Note Gemini doesn't have roles — the
 * system prompt is prepended to the user turn, which is the documented
 * pattern for this API.
 */
export class GeminiProvider extends AIProvider {
  private readonly jsonMode: boolean;
  private readonly timeoutMs: number;

  constructor(config: GeminiProviderConfig) {
    super(config);
    this.jsonMode = Boolean(config.jsonMode);
    this.timeoutMs = config.timeoutMs ?? 20000;
  }

  getName(): string {
    return 'gemini';
  }

  async isAvailable(): Promise<boolean> {
    return !!this.config.apiKey;
  }

  async chat(messages: AIMessage[]): Promise<AIResponse> {
    if (!this.config.apiKey) {
      throw new Error('Gemini API key not configured');
    }

    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const turns = messages.filter((m) => m.role !== 'system');

    const contents = turns.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));
    if (contents.length === 0) {
      contents.push({ role: 'user', parts: [{ text: 'Generate a response.' }] });
    }

    const body = {
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      contents,
      generationConfig: {
        temperature: this.config.temperature ?? 1,
        maxOutputTokens: this.config.maxTokens ?? 1000,
        ...(this.jsonMode ? { responseMimeType: 'application/json' } : {}),
      },
    };

    const base = this.config.baseURL || 'https://generativelanguage.googleapis.com';
    const response = await fetch(
      `${base}/v1beta/models/${this.config.model}:generateContent?key=${this.config.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      },
    );

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Gemini API error ${response.status}: ${detail.slice(0, 200)}`);
    }

    const data = (await response.json()) as any;
    const content: string = data?.candidates?.[0]?.content?.parts?.map((p: any) => String(p?.text ?? '')).join('') ?? '';
    const usage = data?.usageMetadata ?? {};
    return {
      content: content.trim(),
      provider: 'gemini',
      model: this.config.model,
      tokens: {
        input: Number(usage.promptTokenCount ?? 0),
        output: Number(usage.candidatesTokenCount ?? 0),
      },
    };
  }
}
