import { env, type Env as EnvType } from './env.js';
import { z } from 'zod';
import { readConfigDocument, writeConfigDocument } from '../db/models/BotConfig.js';

// Load env
export { env };
export type Env = EnvType;

/* ------------------------------------------------------------------ */
/* 爱 Doctora AI Persona Configuration */
/* ------------------------------------------------------------------ */

/** Name used whenever the persona has no explicit display name. */
export const DEFAULT_DISPLAY_NAME = '爱 Doctora';

/**
 * Names this persona shipped with before. A stored config still holding one of
 * them counts as "not customised", so renaming the bot also renames existing
 * deployments instead of leaving the old UI value in MongoDB forever.
 */
const LEGACY_DISPLAY_NAMES = new Set(['Sukuna']);

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
  displayName: process.env.SUKUNA_DISPLAY_NAME || DEFAULT_DISPLAY_NAME,
  channelIds: process.env.SUKUNA_CHANNELS?.split(',').map((s) => s.trim()).filter(Boolean) || [],
  model: process.env.SUKUNA_MODEL || 'gemini-3.8-live',
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
  const merged: SukunaConfig = { ...defaultSukunaConfig, ...input };
  merged.temperature = clamp(Number(merged.temperature) || 0, 0, 2);
  merged.maxMessageLength = Math.round(clamp(Number(merged.maxMessageLength) || 2000, 100, 4000));
  merged.requestTimeoutMs = Math.round(clamp(Number(merged.requestTimeoutMs) || 20000, 1000, 120000));
  merged.batchWindowMs = Math.round(clamp(Number(merged.batchWindowMs) || 500, 100, 5000));
  merged.historySize = Math.round(clamp(Number(merged.historySize) || 50, 10, 200));
  merged.decisionCooldownSeconds = clamp(Number(merged.decisionCooldownSeconds) || 0, 0, 300);
  merged.replyCooldownSeconds = clamp(Number(merged.replyCooldownSeconds) || 0, 0, 300);
  merged.maxRepliesPerHour = Math.round(clamp(Number(merged.maxRepliesPerHour) || 10, 1, 1000));
  merged.channelIds = Array.isArray(merged.channelIds)
    ? [...new Set(merged.channelIds.map(String).filter((id) => /^\d{5,25}$/.test(id)))]
    : [];
  const requestedName = String(merged.displayName ?? '').trim();
  const name = LEGACY_DISPLAY_NAMES.has(requestedName) ? DEFAULT_DISPLAY_NAME : requestedName;
  merged.displayName = (name || DEFAULT_DISPLAY_NAME).slice(0, 64);
  merged.model = String(merged.model || 'gemini-3.8-live').slice(0, 100);
  if (merged.systemPrompt === null || merged.systemPrompt === undefined) {
    merged.systemPrompt = undefined;
  } else {
    merged.systemPrompt = String(merged.systemPrompt);
  }
  if (!merged.thinkingLevel) merged.thinkingLevel = undefined;
  return merged;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

/** Validation for partial config updates coming from the dashboard. */
export const sukunaConfigPatchSchema = z
  .object({
    enabled: z.boolean().optional(),
    displayName: z.string().trim().min(1).max(64).optional(),
    channelIds: z.array(z.string().regex(/^\d{5,25}$/)).max(200).optional(),
    model: z.string().trim().min(1).max(100).optional(),
    temperature: z.number().min(0).max(2).optional(),
    requestTimeoutMs: z.number().int().min(1000).max(120000).optional(),
    maxMessageLength: z.number().int().min(100).max(4000).optional(),
    batchWindowMs: z.number().int().min(100).max(5000).optional(),
    historySize: z.number().int().min(10).max(200).optional(),
    decisionCooldownSeconds: z.number().min(0).max(300).optional(),
    replyCooldownSeconds: z.number().min(0).max(300).optional(),
    maxRepliesPerHour: z.number().int().min(1).max(1000).optional(),
    showTyping: z.boolean().optional(),
    toolsEnabled: z.boolean().optional(),
    memoryEnabled: z.boolean().optional(),
    systemPrompt: z.string().max(20000).nullable().optional(),
    thinkingLevel: z.enum(['low', 'medium', 'high']).nullable().optional(),
    knowledgeEnabled: z.boolean().optional(),
    webEnabled: z.boolean().optional(),
    islamicEnabled: z.boolean().optional(),
    schedulingEnabled: z.boolean().optional(),
    attachmentsEnabled: z.boolean().optional(),
  })
  .strict();

export type SukunaConfigPatch = z.infer<typeof sukunaConfigPatchSchema>;

/* ------------------------------------------------------------------ */
/* Runtime cache + persistence                                        */
/* ------------------------------------------------------------------ */

const CONFIG_KEY = 'sukuna';

let cachedConfig: SukunaConfig = { ...defaultSukunaConfig };
let hydrated = false;

export function getSukunaConfig(): SukunaConfig {
  return cachedConfig;
}

export function getConfig(): { sukuna: SukunaConfig } {
  return { sukuna: cachedConfig };
}

/**
 * Apply an in-memory update. Use `saveSukunaConfig` when the change must be
 * persisted (dashboard writes). This stays synchronous so the hot message path
 * never touches the database.
 */
export function setSukunaConfig(input: Partial<SukunaConfig>): SukunaConfig {
  cachedConfig = normalizeSukunaConfig({ ...cachedConfig, ...input });
  return cachedConfig;
}

export async function hydrateSukunaConfig(): Promise<SukunaConfig> {
  try {
    const stored = await readConfigDocument<Partial<SukunaConfig>>(CONFIG_KEY);
    if (stored && typeof stored === 'object') {
      cachedConfig = normalizeSukunaConfig({ ...defaultSukunaConfig, ...stored });
    }
    hydrated = true;
  } catch (error) {
    console.warn('[Config] Could not load persisted Sukuna config; using defaults.', error);
  }
  return cachedConfig;
}

export async function saveSukunaConfig(input: Partial<SukunaConfig>): Promise<SukunaConfig> {
  // Persist before touching the cache so a failed write cannot leave the bot
  // running with settings that will vanish on restart.
  const next = normalizeSukunaConfig({ ...cachedConfig, ...input });
  await writeConfigDocument(CONFIG_KEY, next);
  cachedConfig = next;
  return cachedConfig;
}

export async function resetSukunaConfig(): Promise<SukunaConfig> {
  const next: SukunaConfig = { ...defaultSukunaConfig, systemPrompt: undefined, thinkingLevel: undefined };
  await writeConfigDocument(CONFIG_KEY, next);
  cachedConfig = next;
  return cachedConfig;
}

export function isSukunaConfigHydrated(): boolean {
  return hydrated;
}
