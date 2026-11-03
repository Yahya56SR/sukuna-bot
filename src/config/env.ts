import { z } from "zod";

const EnvSchema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().min(1),
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
});

export type Env = z.infer<typeof EnvSchema>;

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
