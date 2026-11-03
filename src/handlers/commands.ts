import { readdirSync } from "fs";
import { join } from "path";
import { BaseCommand, Command } from "../types/command";

export function loadCommands(client: any): void {
  const commandsPath = join(__dirname, "../commands");
  const categories = readdirSync(commandsPath);

  for (const category of categories) {
    const categoryPath = join(commandsPath, category);
    const stat = require("fs").statSync(categoryPath);
    if (!stat.isDirectory()) continue;

    const commandFiles = readdirSync(categoryPath).filter((f) => f.endsWith(".ts") || f.endsWith(".js"));

    for (const file of commandFiles) {
      const filePath = join(categoryPath, file);
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const commandModule = require(filePath);
      const command: Command = commandModule.default || commandModule;

      if (!command || !command.data || !command.execute) {
        console.warn(`[Commands] Skipping invalid command: ${filePath}`);
        continue;
      }

      client.commands.set(command.data.name, command);
      console.log(`[Commands] Loaded: ${command.data.name} (${category})`);
    }
  }
}

export { BaseCommand };
