import { z } from "zod";

const EnvSchema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().min(1),
  GUILD_ID: z.string().optional(),
  DEV_GUILD_ID: z.string().optional(),
  OWNER_IDS: z.string().default(""),
  MONGO_URI: z.string().min(1),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  REGISTER_COMMANDS: z.preprocess(
    (v) => v === "true" || v === true,
    z.boolean().default(true),
  ),
  SKIP_MIGRATIONS: z.preprocess(
    (v) => v === "true" || v === true,
    z.boolean().default(false),
  ),
  GEMINI_API_KEY: z.string().optional(),
  SUKUNA_ENABLED: z.preprocess(
    (v) => v === "true" || v === true,
    z.boolean().default(false),
  ),
  SUKUNA_CHANNELS: z.preprocess(
    (v) => typeof v === 'string' ? v.split(',').map(s => s.trim()).filter(Boolean) : (v ?? []),
    z.array(z.string()).default([]),
  ),
  SUKUNA_DISPLAY_NAME: z.string().default("爱 Doctora"),
  SUKUNA_MODEL: z.string().default("gemini-3.8-live"),
  SUKUNA_VOICE_NAME: z.string().default("Aoede"),
  SUKUNA_VOICE_DUPLEX: z.preprocess(
    (v) => (v === undefined || v === "" ? true : v === "true" || v === true),
    z.boolean().default(true),
  ),
  SUKUNA_TEMPERATURE: z.preprocess(
    (v) => typeof v === 'number' ? v : Number(v ?? 1),
    z.number().min(0).max(2).default(1),
  ),
  SUKUNA_MAX_MESSAGE_LENGTH: z.preprocess(
    (v) => typeof v === 'number' ? v : Number(v ?? 2000),
    z.number().default(2000),
  ),
  DASHBOARD_ENABLED: z.preprocess(
    (v) => v === "true" || v === true,
    z.boolean().default(false),
  ),
  DASHBOARD_TOKEN: z.preprocess(
    // Treat an empty value in .env as "not set" so a generated token is used.
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().min(8).optional(),
  ),
});

export interface Env {
  DISCORD_TOKEN: string;
  DISCORD_CLIENT_ID: string;
  GUILD_ID?: string;
  DEV_GUILD_ID?: string;
  OWNER_IDS: string;
  MONGO_URI: string;
  LOG_LEVEL: "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";
  REGISTER_COMMANDS: boolean;
  SKIP_MIGRATIONS: boolean;
  GEMINI_API_KEY?: string;
  SUKUNA_ENABLED: boolean;
  SUKUNA_CHANNELS: string[];
  SUKUNA_DISPLAY_NAME: string;
  SUKUNA_MODEL: string;
  SUKUNA_VOICE_NAME: string;
  SUKUNA_VOICE_DUPLEX: boolean;
  SUKUNA_TEMPERATURE: number;
  SUKUNA_MAX_MESSAGE_LENGTH: number;
  DASHBOARD_ENABLED: boolean;
  DASHBOARD_TOKEN?: string;
}

export const env = loadEnv();
export type EnvType = Env;

export function loadEnv(): Env {
  // node >=20.6 supports process.loadEnvFile
  if (typeof process.loadEnvFile === "function") {
    try {
      process.loadEnvFile(".env");
    } catch {
      // .env may not exist in production (host injects vars)
    }
  }

  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Invalid environment variables:");
    console.error(parsed.error.flatten().fieldErrors);
    process.exit(1);
  }

  return parsed.data;
}

// Default config getter
export function getDefaultConfig(): Env {
  return env;
}