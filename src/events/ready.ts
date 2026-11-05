import { Events, type ClientEvents } from 'discord.js';
import { startDashboard, setSukunaActive } from '../../dashboard/server.js';
import { getSukunaConfig } from '../config/index.js';
import { recordActivity } from '../core/metrics.js';
import { startLiveLeaderboard } from '../utils/liveLeaderboard.js';
import { startTicketScheduler } from '../utils/ticketScheduler.js';
import { startVoiceTracking } from './voiceStateUpdate.js';
import { warmActiveTempVCCache } from '../db/models/TempVC.js';
import { initAutomod } from '../handlers/automod.js';
import { initReactionRoles } from '../handlers/reactionRoles.js';
import { invalidateStarboardCache, handleStarboardReaction } from '../commands/utility/starboard.js';
import { checkReminders } from '../commands/utility/remind.js';

/** Background reminder interval; cleared on shutdown so it cannot outlive Mongo. */
let reminderInterval: NodeJS.Timeout | null = null;

export function stopReminderChecker(): void {
  if (reminderInterval) clearInterval(reminderInterval);
  reminderInterval = null;
}

export const ready = {
  name: Events.ClientReady as keyof ClientEvents,
  once: true,
  execute: async (client: any) => {
    client.logger.info(
      { tag: client.user?.tag, id: client.user?.id, guilds: client.guilds.cache.size },
      'ready',
    );

    const config = getSukunaConfig();
    setSukunaActive(config.enabled);

    // The env flag always wins so a persisted "disabled" persona can never lock
    // operators out of the dashboard.
    const dashboardEnabled =
      client.env?.DASHBOARD_ENABLED === true ||
      client.env?.SUKUNA_ENABLED === true ||
      config.enabled;

    if (dashboardEnabled) {
      startDashboard(client);
      recordActivity('system', 'Dashboard server started', {
        level: 'success',
        meta: { guilds: client.guilds.cache.size, commands: client.commands.size },
      });
      client.logger.info('[Dashboard] Web control panel started');
    } else {
      client.logger.info('[Dashboard] Disabled — set DASHBOARD_ENABLED=true or SUKUNA_ENABLED=true');
    }

    if (config.enabled) {
      client.logger.info('[Sukuna] AI persona enabled');
    } else {
      client.logger.info('[Sukuna] AI persona disabled');
    }

    // Initialize systems
    await initAutomod();

    // Initialize reaction roles for each guild
    for (const guild of client.guilds.cache.values()) {
      try {
        await initReactionRoles(guild);
      } catch (err) {
        client.logger.warn({ err, guildId: guild.id }, 'reaction roles init failed');
      }
    }
    client.logger.info('[ReactionRoles] Panels initialized');

    // Initialize starboard cache
    invalidateStarboardCache();
    client.logger.info('[Starboard] Cache initialized');

    // XP/level system background work: voice minutes and the self-updating
    // leaderboard. Both are no-ops until a guild configures them.
    startVoiceTracking(client);
    startLiveLeaderboard(client);
    startTicketScheduler(client);

    // Temp VC reconciliation: warm the active VC cache and drop rows whose
    // channel no longer exists, so stale owner rows can't lock users out after
    // a restart or manual channel deletion.
    try {
      await warmActiveTempVCCache();
      client.logger.info('[TempVC] Active VC cache warmed');
    } catch (err) {
      client.logger.warn({ err }, 'temp VC cache warm failed');
    }

    client.logger.info('[Tickets] Voice tracking, live leaderboard and auto-close scheduler started');

    // Reminder checker (runs every minute). Tracked so shutdown can clear it —
    // previously this interval kept firing after Mongo disconnected.
    reminderInterval = setInterval(() => {
      checkReminders(client).catch(err => client.logger.warn({ err }, 'reminder check failed'));
    }, 60_000);
    reminderInterval.unref?.();
    client.logger.info('[Reminders] Background checker started');

    // When GUILD_ID is set, leave any guild the bot is not meant to run in.
    const allowedGuildId = client.env?.GUILD_ID;
    if (allowedGuildId) {
      const toLeave = [...client.guilds.cache.values()].filter((g) => g.id !== allowedGuildId);
      for (const guild of toLeave) {
        try {
          await guild.leave();
          client.logger.info({ guildId: guild.id, guildName: guild.name }, 'left unallowed guild');
        } catch (error) {
          client.logger.warn({ err: error, guildId: guild.id }, 'failed to leave unallowed guild');
        }
      }
      client.logger.info(
        { allowedGuildId, left: toLeave.length, remaining: client.guilds.cache.size },
        'guild restriction applied',
      );
    }

    recordActivity('system', 'Bot ready', {
      level: 'success',
      meta: { guilds: client.guilds.cache.size, users: client.users.cache.size },
    });
  },
};