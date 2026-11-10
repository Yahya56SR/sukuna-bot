"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GeminiProvider = void 0;
const AIProvider_1 = require("./AIProvider");
/**
 * Google AI Studio (Gemini) provider. Note Gemini doesn't have roles — the
 * system prompt is prepended to the user turn, which is the documented
 * pattern for this API.
 */
class GeminiProvider extends AIProvider_1.AIProvider {
    constructor(config) {
        super(config);
        this.jsonMode = Boolean(config.jsonMode);
        this.timeoutMs = config.timeoutMs ?? 20000;
    }
    getName() {
        return 'gemini';
    }
    async isAvailable() {
        return !!this.config.apiKey;
    }
    async chat(messages) {
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
        const response = await fetch(`${base}/v1beta/models/${this.config.model}:generateContent?key=${this.config.apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (!response.ok) {
            const detail = await response.text().catch(() => '');
            throw new Error(`Gemini API error ${response.status}: ${detail.slice(0, 200)}`);
        }
        const data = (await response.json());
        const content = data?.candidates?.[0]?.content?.parts?.map((p) => String(p?.text ?? '')).join('') ?? '';
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
exports.GeminiProvider = GeminiProvider;
