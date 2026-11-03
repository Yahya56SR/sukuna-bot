import { Events, type ClientEvents } from 'discord.js';
import { startDashboard, setSukunaActive } from '../../dashboard/server.js';
import { getSukunaConfig } from '../config/index.js';
import { recordActivity } from '../core/metrics.js';
import { startLiveLeaderboard } from '../utils/liveLeaderboard.js';
import { startVoiceTracking } from './voiceStateUpdate.js';

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

    // XP/level system background work: voice minutes and the self-updating
    // leaderboard. Both are no-ops until a guild configures them.
    startVoiceTracking(client);
    startLiveLeaderboard(client);
    client.logger.info('[Levels] Voice tracking and live leaderboard scheduler started');
  },
};
