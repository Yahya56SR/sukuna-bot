import type {
  ChatInputCommandInteraction,
  ClientApplication,
  Guild,
  GuildMember,
  PermissionResolvable,
  AutocompleteInteraction,
} from 'discord.js';
import type { SukunaClient } from './client.js';

export type CommandData =
  | import("discord.js").SlashCommandBuilder
  | import("discord.js").SlashCommandOptionsOnlyBuilder
  | import("discord.js").SlashCommandSubcommandsOnlyBuilder;

export interface CommandContext {
  client: SukunaClient;
  interaction: ChatInputCommandInteraction<"cached">;
  guild: Guild;
  member: GuildMember;
  settings: any;
  premium: boolean;
}

export interface Command {
  data: CommandData;
  category: string;
  userPermissions?: PermissionResolvable[];
  botPermissions?: PermissionResolvable[];
  allowWhenDisabled?: boolean;
  premiumOnly?: boolean;
  cooldownSeconds?: number;
  execute: (context: CommandContext) => Promise<void>;
  autocomplete?: (interaction: AutocompleteInteraction<"cached">) => Promise<void>;
}

export function registerCommands(client: SukunaClient, commands: readonly Command[]): void {
  for (const command of commands) {
    const name = command.data.name;
    if (client.commands.has(name)) {
      throw new Error(`Duplicate command registration: ${name}`);
    }
    client.commands.set(name, command);
  }
}

export async function registerApplicationCommands(client: SukunaClient): Promise<void> {
  if (!client.env.REGISTER_COMMANDS || !client.application) return;

  const app = client.application as ClientApplication;
  const payload = [...client.commands.values()].map((command) => command.data.toJSON());
  if (client.env.DEV_GUILD_ID) {
    await app.commands.set(payload, client.env.DEV_GUILD_ID);
    client.logger.info(
      { count: payload.length, guildId: client.env.DEV_GUILD_ID },
      "registered development guild commands",
    );
    return;
  }

  await app.commands.set(payload);
  client.logger.info({ count: payload.length }, "registered global commands");
}