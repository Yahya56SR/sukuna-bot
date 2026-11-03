import { Events, type ClientEvents } from 'discord.js';

export const ready = {
  name: Events.ClientReady as keyof ClientEvents,
  once: true,
  execute: (client: any) => {
    client.logger.info(
      { tag: client.user?.tag, id: client.user?.id, guilds: client.guilds.cache.size },
      "ready",
    );
  },
};
