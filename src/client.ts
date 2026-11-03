import { Client, Partials } from "discord.js";
import { readdirSync } from "fs";
import { join } from "path";
import { connectDatabase } from "./database/connection";
import { loadEvents } from "./handlers/events";
import { loadCommands } from "./handlers/commands";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { GatewayIntentBits } = require("discord.js");

export class SukunaClient extends Client {
  public readonly owners: string[];

  constructor() {
    super({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildModeration,
      ],
      partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User, Partials.GuildMember],
    });

    const ownerEnv = process.env.OWNER_IDS || "";
    this.owners = ownerEnv.split(",").map((id) => id.trim()).filter(Boolean);
  }

  public async start(): Promise<void> {
    await connectDatabase();

    loadEvents(this);
    loadCommands(this);

    const token = process.env.BOT_TOKEN;
    if (!token) {
      throw new Error("BOT_TOKEN is not defined in .env");
    }
    await this.login(token);
  }
}
