import { loadEnv, type Env as EnvType } from './env.js';
import { z } from 'zod';

// Load env
export const env = loadEnv();
export type Env = EnvType;

/* ------------------------------------------------------------------ */
/* Sukuna AI Persona Configuration */
/* ------------------------------------------------------------------ */

export interface SukunaConfig {
  enabled: boolean;
  displayName: string;
  channelIds: string[];
  model: string;
  temperature: number;
  requestTimeoutMs: number;
  maxMessageLength: number;
  batchWindowMs: number;
  historySize: number;
  decisionCooldownSeconds: number;
  replyCooldownSeconds: number;
  maxRepliesPerHour: number;
  showTyping: boolean;
  toolsEnabled: boolean;
  memoryEnabled: boolean;
  systemPrompt?: string;
  thinkingLevel?: 'low' | 'medium' | 'high';
  knowledgeEnabled: boolean;
  webEnabled: boolean;
  islamicEnabled: boolean;
  schedulingEnabled: boolean;
  attachmentsEnabled: boolean;
}

export const defaultSukunaConfig: SukunaConfig = {
  enabled: process.env.SUKUNA_ENABLED === 'true' || false,
  displayName: process.env.SUKUNA_DISPLAY_NAME || 'Sukuna',
  channelIds: process.env.SUKUNA_CHANNELS?.split(',').map(s => s.trim()).filter(Boolean) || [],
  model: process.env.SUKUNA_MODEL || 'gemini-3.1-flash',
  temperature: Number(process.env.SUKUNA_TEMPERATURE) || 1,
  requestTimeoutMs: 20000,
  maxMessageLength: Number(process.env.SUKUNA_MAX_MESSAGE_LENGTH) || 2000,
  batchWindowMs: 500,
  historySize: 50,
  decisionCooldownSeconds: 2,
  replyCooldownSeconds: 2,
  maxRepliesPerHour: 10,
  showTyping: true,
  toolsEnabled: true,
  memoryEnabled: true,
  systemPrompt: undefined,
  thinkingLevel: undefined,
  knowledgeEnabled: true,
  webEnabled: true,
  islamicEnabled: true,
  schedulingEnabled: true,
  attachmentsEnabled: true,
};

export function normalizeSukunaConfig(input: Partial<SukunaConfig>): SukunaConfig {
  return { ...defaultSukunaConfig, ...input };
}

// Simple config cache
let cachedConfig: SukunaConfig = { ...defaultSukunaConfig };

export function getConfig(): { sukuna: SukunaConfig } {
  return { sukuna: cachedConfig };
}

export function setSukunaConfig(config: Partial<SukunaConfig>): void {
  cachedConfig = normalizeSukunaConfig(config);
}