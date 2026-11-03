import { connectDatabase, disconnectDatabase } from './db/index.js';
import { commands } from './commands/index.js';
import { loadEnv } from './config/env.js';
import { hydrateSukunaConfig } from './config/index.js';
import { stopSettingsPoller } from './config/settings.js';
import { SukunaClient } from './core/client.js';
import { registerCommands } from './core/commands.js';
import { registerEvents } from './core/events.js';
import { createLogger } from './core/logger.js';
import { events } from './events/index.js';
import { registerApplicationCommands } from './core/commands.js';
import { closeSukuna } from './utils/sukuna.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger(env.LOG_LEVEL);
  logger.info({ node: process.version, pid: process.pid }, "starting Sukuna");

  let client: SukunaClient | null = null;

  async function shutdown(reason: string, exitCode = 0): Promise<void> {
    logger.info({ reason, exitCode }, "shutting down");

    closeSukuna();

    if (client) {
      stopSettingsPoller(client);
      await client.destroy().catch((error: unknown) => {
        logger.warn({ err: error }, "client destroy failed");
      });
    }

    await disconnectDatabase().catch(() => {});

    process.exitCode = exitCode;
    setTimeout(() => process.exit(exitCode), 5000).unref();
  }

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  process.on("unhandledRejection", (reason) => {
    logger.error({ err: reason }, "unhandled rejection");
  });

  process.on("uncaughtException", (error) => {
    logger.fatal({ err: error }, "uncaught exception");
    void shutdown("uncaughtException", 1);
  });

  try {
    await connectDatabase(env.MONGO_URI);
    logger.info("database connected");

    await hydrateSukunaConfig();
    logger.info("runtime configuration hydrated");

    client = new SukunaClient();
    client.env = env;
    client.logger = logger;

    registerCommands(client, commands);
    registerEvents(client, events);

    await client.login(env.DISCORD_TOKEN);
    await registerApplicationCommands(client);
  } catch (error) {
    logger.fatal({ err: error }, "fatal startup error");

    if (client) {
      stopSettingsPoller(client);
      await client.destroy().catch(() => {});
    }
    await disconnectDatabase().catch(() => {});

    process.exitCode = 1;
    setTimeout(() => process.exit(1), 5000).unref();
  }
}

void main();
