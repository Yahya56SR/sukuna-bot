import type { ClientEvents } from 'discord.js';
import type { SukunaClient } from './client.js';

export interface BotEvent {
  name: keyof ClientEvents;
  once?: boolean;
  execute: (client: SukunaClient, ...args: any[]) => Promise<void> | void;
}

type Listener = (...args: unknown[]) => void;

export function registerEvents(client: SukunaClient, events: readonly BotEvent[]): void {
  const emitter = client as unknown as {
    on(event: string, listener: Listener): void;
    once(event: string, listener: Listener): void;
  };

  for (const event of events) {
    const listener: Listener = (...args) => {
      try {
        void Promise.resolve(event.execute(client, ...args)).catch((error: unknown) => {
          client.logger.error({ err: error, event: event.name }, "event handler failed");
        });
      } catch (error) {
        client.logger.error({ err: error, event: event.name }, "event handler threw synchronously");
      }
    };

    if (event.once) emitter.once(event.name, listener);
    else emitter.on(event.name, listener);
  }
}
