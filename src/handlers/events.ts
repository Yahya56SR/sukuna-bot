import { readdirSync } from "fs";
import { join } from "path";

export function loadEvents(client: any): void {
  const eventsPath = join(__dirname, "../events");
  const eventFiles = readdirSync(eventsPath).filter((f) => f.endsWith(".ts") || f.endsWith(".js"));

  for (const file of eventFiles) {
    const filePath = join(eventsPath, file);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const eventModule = require(filePath);
    const event = eventModule.default || eventModule;

    if (!event || !event.name || !event.execute) {
      console.warn(`[Events] Skipping invalid event: ${filePath}`);
      continue;
    }

    if (event.once) {
      client.once(event.name, (...args: any[]) => event.execute(client, ...args));
    } else {
      client.on(event.name, (...args: any[]) => event.execute(client, ...args));
    }

    console.log(`[Events] Loaded: ${event.name}`);
  }
}
