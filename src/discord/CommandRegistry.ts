import { Client, SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { Logger } from '../infrastructure/Logger';

export type PermissionCheck = (interaction: ChatInputCommandInteraction) => boolean | Promise<boolean>;

export interface Command {
  data: SlashCommandBuilder;
  execute(interaction: ChatInputCommandInteraction): Promise<void>;
  description: string;
  category: string;
  enabled?: boolean;
  permissions?: PermissionCheck[];
  cooldown?: number;
}

interface CooldownRecord {
  timestamp: number;
}

export class CommandRegistry {
  private client: Client | null = null;
  private commands: Map<string, Command> = new Map();
  private logger: Logger;
  private cooldowns: Map<string, Map<string, CooldownRecord>> = new Map();
  private middleware: Array<(interaction: ChatInputCommandInteraction, next: () => Promise<void>) => Promise<void>> = [];

  constructor(logger: Logger) {
    this.logger = logger;
  }

  public addMiddleware(middleware: (interaction: ChatInputCommandInteraction, next: () => Promise<void>) => Promise<void>): void {
    this.middleware.push(middleware);
  }

  public async initialize(client: Client): Promise<void> {
    this.client = client;
    await this.loadBuiltInCommands();
    await this.registerCommands();
  }

  private async loadBuiltInCommands(): Promise<void> {
    const helpCommand: Command = {
      data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Show help information about commands'),
      execute: async (interaction) => {
        const commands = Array.from(this.commands.values())
          .filter(cmd => cmd.enabled !== false)
          .map(cmd => `**/${cmd.data.name}** - ${cmd.description}`)
          .join('\n');

        await interaction.reply({
          content: `# Sukuna Bot Commands\n\n${commands}`,
          flags: MessageFlags.Ephemeral,
        });
      },
      description: 'Show help information about commands',
      category: 'General',
      enabled: true,
    };
    this.commands.set('help', helpCommand);

    const infoCommand: Command = {
      data: new SlashCommandBuilder()
        .setName('info')
        .setDescription('Show bot information and statistics'),
      execute: async (interaction) => {
        const uptime = process.uptime();
        const uptimeStr = this.formatUptime(uptime);

        await interaction.reply({
          content: `**Sukuna Bot**\n` +
                   `Version: 1.0.0\n` +
                   `Node.js: ${process.version}\n` +
                   `Uptime: ${uptimeStr}\n` +
                   `Guilds: ${interaction.client.guilds.cache.size}\n` +
                   `Users: ${interaction.client.users.cache.size}`,
          flags: MessageFlags.Ephemeral,
        });
      },
      description: 'Show bot information and statistics',
      category: 'General',
      enabled: true,
    };
    this.commands.set('info', infoCommand);

    const pingCommand: Command = {
      data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Check bot latency'),
      execute: async (interaction) => {
        const sent = await interaction.reply({ content: 'Pinging...', fetchReply: true });
        const latency = sent.createdTimestamp - interaction.createdTimestamp;
        const apiLatency = interaction.client.ws.ping;

        await interaction.editReply({
          content: `**Latency Results:**\n` +
                   `WebSocket: ${apiLatency}ms\n` +
                   `Round-trip: ${latency}ms`,
        });
      },
      description: 'Check bot latency',
      category: 'General',
      enabled: true,
    };
    this.commands.set('ping', pingCommand);

    this.logger.info('Command Registry', `Loaded ${this.commands.size} commands`);
  }

  private async registerCommands(): Promise<void> {
    if (!this.client) {
      throw new Error('Client not initialized');
    }

    try {
      const commandData = Array.from(this.commands.values())
        .filter(cmd => cmd.enabled !== false)
        .map(cmd => cmd.data.toJSON());

      const client = this.client;
      if (client.isReady()) {
        const applicationCommands = await client.application?.commands;
        if (applicationCommands) {
          await applicationCommands.set(commandData);
          this.logger.info('Command Registry', `Registered ${commandData.length} commands globally`);
        }
      } else {
        client.once('ready', async () => {
          const applicationCommands = await client.application?.commands;
          if (applicationCommands) {
            await applicationCommands.set(commandData);
            this.logger.info('Command Registry', `Registered ${commandData.length} commands globally`);
          }
        });
      }
    } catch (error) {
      this.logger.error('Command Registry', 'Failed to register commands', error as Error);
      throw error;
    }
  }

  public async handleInteraction(interaction: ChatInputCommandInteraction): Promise<void> {
    const commandName = interaction.commandName;
    const command = this.commands.get(commandName);

    if (!command) {
      this.logger.warn('Command Registry', `Unknown command: ${commandName}`);
      return;
    }

    if (command.enabled === false) {
      await interaction.reply({ content: 'This command is currently disabled.', flags: MessageFlags.Ephemeral });
      return;
    }

    try {
      for (const permissionCheck of command.permissions || []) {
        const hasPermission = await permissionCheck(interaction);
        if (!hasPermission) {
          await interaction.reply({ content: 'You do not have permission to use this command.', flags: MessageFlags.Ephemeral });
          return;
        }
      }

      if (command.cooldown && command.cooldown > 0) {
        const userCooldowns = this.cooldowns.get(commandName) || new Map();
        const now = Date.now();
        const lastUse = userCooldowns.get(interaction.user.id);

        if (lastUse && now - lastUse.timestamp < command.cooldown * 1000) {
          const remaining = Math.ceil((command.cooldown * 1000 - (now - lastUse.timestamp)) / 1000);
          await interaction.reply({ content: `Please wait ${remaining}s before using this command again.`, flags: MessageFlags.Ephemeral });
          return;
        }

        if (!this.cooldowns.has(commandName)) {
          this.cooldowns.set(commandName, new Map());
        }
        const cmdCooldowns = this.cooldowns.get(commandName);
        if (cmdCooldowns) {
          cmdCooldowns.set(interaction.user.id, { timestamp: now });
        }
      }

      const executeMiddleware = (idx: number): Promise<void> => {
        const mw = this.middleware[idx];
        if (mw) {
          return mw(interaction, () => executeMiddleware(idx + 1));
        }
        return command.execute(interaction);
      };

      await executeMiddleware(0);
    } catch (error) {
      this.logger.error('Command Registry', `Error executing command ${commandName}`, error as Error);
      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.editReply({ content: 'An error occurred while executing this command.' });
        } else {
          await interaction.reply({ content: 'An error occurred while executing this command.', flags: MessageFlags.Ephemeral });
        }
      } catch (replyError) {
        this.logger.error('Command Registry', 'Failed to send error response', replyError as Error);
      }
    }
  }

  public getCommand(name: string): Command | undefined {
    return this.commands.get(name.toLowerCase());
  }

  public getCommands(): Map<string, Command> {
    return this.commands;
  }

  public getCommandsByCategory(): Map<string, Command[]> {
    const commandsByCategory = new Map<string, Command[]>();

    this.commands.forEach((command) => {
      if (!commandsByCategory.has(command.category)) {
        commandsByCategory.set(command.category, []);
      }
      commandsByCategory.get(command.category)?.push(command);
    });

    return commandsByCategory;
  }

  private formatUptime(seconds: number): string {
    const days = Math.floor(seconds / (3600 * 24));
    const hours = Math.floor((seconds % (3600 * 24)) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    parts.push(`${secs}s`);

    return parts.join(' ');
  }

  public registerCommand(command: Command): void {
    this.commands.set(command.data.name, command);
  }

  public async shutdown(): Promise<void> {
    this.commands.clear();
    this.cooldowns.clear();
    this.client = null;
    this.logger.info('Command Registry', 'Command registry shutdown successfully');
  }
}
