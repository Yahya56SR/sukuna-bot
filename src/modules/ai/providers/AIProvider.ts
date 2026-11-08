export interface AIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AIResponse {
  content: string;
  provider: string;
  model: string;
  tokens?: { input: number; output: number };
}

export interface AIProviderConfig {
  apiKey: string;
  model: string;
  baseURL?: string;
  maxTokens?: number;
  temperature?: number;
}

export abstract class AIProvider {
  protected config: AIProviderConfig;

  constructor(config: AIProviderConfig) {
    this.config = config;
  }

  abstract getName(): string;

  abstract chat(messages: AIMessage[]): Promise<AIResponse>;

  abstract isAvailable(): Promise<boolean>;
}
