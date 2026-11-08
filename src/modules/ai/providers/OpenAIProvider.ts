import { AIProvider, AIMessage, AIResponse } from './AIProvider';

export class OpenAIProvider extends AIProvider {
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

    try {
      const response = await fetch(`${this.config.baseURL || 'https://api.openai.com'}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: messages.map(m => ({ role: m.role, content: m.content })),
          max_tokens: this.config.maxTokens || 1000,
          temperature: this.config.temperature ?? 0.7,
        }),
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.statusText}`);
      }

      const data = await response.json();

      return {
        content: data.choices[0].message.content,
        provider: 'openai',
        model: this.config.model,
        tokens: {
          input: data.usage?.prompt_tokens || 0,
          output: data.usage?.completion_tokens || 0,
        },
      };
    } catch (error) {
      throw new Error(`OpenAI provider error: ${error}`);
    }
  }
}
