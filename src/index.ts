import { connectDatabase, disconnectDatabase } from './db/index.js';
import { backfillUserXp } from './db/utils.js';
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
import { stopReminderChecker } from './events/ready.js';
import { stopDashboard } from '../dashboard/server.js';
import { closeSukuna } from './utils/sukuna.js';
import { stopLiveLeaderboard } from './utils/liveLeaderboard.js';
import { stopTicketScheduler } from './utils/ticketScheduler.js';
import { stopVoiceTracking } from './events/voiceStateUpdate.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger(env.LOG_LEVEL);
  logger.info({ node: process.version, pid: process.pid }, "starting Sukuna");

  let client: SukunaClient | null = null;
  let shuttingDown = false;

  /**
   * Stop every background worker. Safe to call more than once: SIGINT and
   * SIGTERM can arrive together, and the fatal-startup path shares this.
   */
  function stopBackgroundWork(): void {
    closeSukuna();
    stopVoiceTracking();
    stopLiveLeaderboard();
    stopTicketScheduler();
    stopReminderChecker();
    stopDashboard();
    // Drain every per-system timer/cache so shutdown cannot leak work past
    // Mongo disconnect (single guild = no sharding to hide behind).
    try {
      const { shutdownAutomod } = require('./handlers/automod.js') as typeof import('./handlers/automod.js');
      shutdownAutomod();
    } catch { /* module not loaded */ }
    try {
      const { tempvc } = require('./systems/tempvc/index.js') as typeof import('./systems/tempvc/index.js');
      tempvc.shutdown();
    } catch { /* module not loaded */ }
    try {
      const { levels } = require('./systems/levels/index.js') as typeof import('./systems/levels/index.js');
      levels.stopAllVoiceSessions();
    } catch { /* module not loaded */ }
    try {
      const { autoReply } = require('./systems/autoreply/index.js') as typeof import('./systems/autoreply/index.js');
      autoReply.shutdown();
    } catch { /* module not loaded */ }
    try {
      const { mediaReactions } = require('./systems/mediareactions/index.js') as typeof import('./systems/mediareactions/index.js');
      mediaReactions.shutdown();
    } catch { /* module not loaded */ }
    try {
      const { antinuke } = require('./systems/antinuke/index.js') as typeof import('./systems/antinuke/index.js');
      antinuke.shutdown();
    } catch { /* module not loaded */ }
    try {
      const { vcVerification } = require('./systems/verification/vc.js') as typeof import('./systems/verification/vc.js');
      vcVerification.shutdown();
    } catch { /* module not loaded */ }
  }

  async function shutdown(reason: string, exitCode = 0): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ reason, exitCode }, "shutting down");

    stopBackgroundWork();
    await shutdownVoiceSafely();

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

    // Normalise legacy XP rows once so leaderboards can use an index instead
    // of a full-collection aggregation. Best effort: a failure only means the
    // slow path stays in use.
    const backfilled = await backfillUserXp();
    if (backfilled > 0) logger.info({ rows: backfilled }, "normalised legacy XP totals");
    else if (backfilled < 0) logger.warn("legacy XP normalisation skipped");

    await hydrateSukunaConfig();
    logger.info("runtime configuration hydrated");

    client = new SukunaClient();
    client.env = env;
    client.logger = logger;

    registerCommands(client, commands);
    registerEvents(client, events);

    await client.login(env.DISCORD_TOKEN);

    try {
      await registerApplicationCommands(client);
    } catch (error) {
      // A transient Discord API error while publishing commands must not kill
      // an otherwise healthy bot — slash commands will be retried next boot.
      logger.warn({ err: error }, "failed to publish application commands (will retry next start)");
    }
  } catch (error) {
    logger.fatal({ err: error }, "fatal startup error");

    stopBackgroundWork();
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

/**
 * Voice is loaded lazily (native DAVE addon); a missing dependency must never
 * block shutdown.
 */
async function shutdownVoiceSafely(): Promise<void> {
  try {
    const { shutdownVoice } = await import('./voice/manager.js');
    shutdownVoice();
  } catch {
    /* voice was never loaded */
  }
}
