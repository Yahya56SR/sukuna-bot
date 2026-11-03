import { REST, Routes } from "discord.js";
import { readdirSync } from "fs";
import { join } from "path";

const commands = [];
const commandsPath = join(__dirname, "src/commands");
const categories = readdirSync(commandsPath);

for (const category of categories) {
  const categoryPath = join(commandsPath, category);
  const stat = require("fs").statSync(categoryPath);
  if (!stat.isDirectory()) continue;

  const commandFiles = readdirSync(categoryPath).filter((f) => f.endsWith(".ts") || f.endsWith(".js"));

  for (const file of commandFiles) {
    const filePath = join(categoryPath, file);
    const command = require(filePath).default || require(filePath);
    if (command.data) commands.push(command.data.toJSON());
  }
}

const rest = new REST({ version: "10" }).setToken(process.env.BOT_TOKEN!);

(async () => {
  try {
    console.log(`[Deploy] Started refreshing ${commands.length} application (/) commands.`);

    const guildId = process.env.GUILD_ID; // optional: register to one guild for instant updates
    const route = guildId
      ? Routes.applicationGuildCommands(process.env.CLIENT_ID!, guildId)
      : Routes.applicationCommands(process.env.CLIENT_ID!);

    await rest.put(route, { body: commands });
    console.log(`[Deploy] Successfully reloaded ${commands.length} application (/) commands.`);
  } catch (error) {
    console.error(error);
  }
})();
