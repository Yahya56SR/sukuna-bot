import { Events, type ClientEvents } from 'discord.js';
import { setSukunaActive } from '../../dashboard/server.js';
import { isSukunaActive } from '../utils/sukuna.js';
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
    if (defaultSukunaConfig.enabled) {
      setSukunaActive(true);
      client.logger.info('[Sukuna] AI persona enabled');
    }
  },
};