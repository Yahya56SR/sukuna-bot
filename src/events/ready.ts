import { Events, type ClientEvents } from 'discord.js';
import { startDashboard, setSukunaActive } from '../../dashboard/server.js';
import { defaultSukunaConfig } from '../config/index.js';

export const ready = {
  name: Events.ClientReady as keyof ClientEvents,
  once: true,
  execute: async (client: any) => {
    client.logger.info(
      { tag: client.user?.tag, id: client.user?.id, guilds: client.guilds.cache.size },
      'ready',
    );

    // Start the dashboard if Sukuna is enabled
    const isEnabled = defaultSukunaConfig.enabled === true;
    if (isEnabled) {
      startDashboard();
      setSukunaActive(true);
      client.logger.info('[Sukuna] AI persona enabled — dashboard started');
    } else {
      client.logger.info('[Sukuna] AI persona disabled — dashboard not started');
    }
  },
};