import { AIProvider, AIMessage, AIResponse } from './AIProvider';

export interface OpenAIProviderConfig {
  apiKey: string;
  model: string;
  baseURL?: string;
  maxTokens?: number;
  temperature?: number;
  /** Optional JSON object mode (supported by OpenAI and most compatible APIs). */
  jsonMode?: boolean;
  timeoutMs?: number;
}

export class OpenAIProvider extends AIProvider {
  private readonly jsonMode: boolean;
  private readonly timeoutMs: number;

  constructor(config: OpenAIProviderConfig) {
    super(config);
    this.jsonMode = Boolean(config.jsonMode);
    this.timeoutMs = config.timeoutMs ?? 20000;
  }

  getName(): string {
    return 'openai';
  }

  async isAvailable(): Promise<boolean> {
    return !!this.config.apiKey;
  }

  async chat(messages: AIMessage[]): Promise<AIResponse> {
    if (!this.config.apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    const base = (this.config.baseURL || 'https://api.openai.com').replace(/\/+$/, '');

    try {
      const response = await fetch(`${base}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          max_tokens: this.config.maxTokens || 1000,
          temperature: this.config.temperature ?? 0.7,
          ...(this.jsonMode ? { response_format: { type: 'json_object' } } : {}),
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(`OpenAI API error ${response.status}: ${detail.slice(0, 200)}`);
      }

      const data = (await response.json()) as any;
      const choice = data?.choices?.[0];
      const content: string = choice?.message?.content ?? '';
      if (!content) throw new Error('OpenAI returned an empty response');

      return {
        content,
        provider: 'openai',
        model: this.config.model,
        tokens: {
          input: Number(data?.usage?.prompt_tokens ?? 0),
          output: Number(data?.usage?.completion_tokens ?? 0),
        },
      };
    } catch (error) {
      throw new Error(`OpenAI provider error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
