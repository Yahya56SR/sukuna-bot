import { Client, SlashCommandBuilder, SlashCommandOptionsOnlyBuilder, ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { Logger } from '../infrastructure/Logger';
import { brandedEmbed, errorEmbed, formatUptime, BRAND } from '../utils/embed';

export type PermissionCheck = (interaction: ChatInputCommandInteraction) => boolean | Promise<boolean>;

export interface Command {
  data: SlashCommandBuilder | SlashCommandOptionsOnlyBuilder;
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

const COOLDOWN_SWEEP_MS = 60_000;
const COOLDOWN_RETENTION_MS = 5 * 60_000;

export class CommandRegistry {
  private client: Client | null = null;
  private commands: Map<string, Command> = new Map();
  private logger: Logger;
  private cooldowns: Map<string, Map<string, CooldownRecord>> = new Map();
  private middleware: Array<(interaction: ChatInputCommandInteraction, next: () => Promise<void>) => Promise<void>> = [];
  private cooldownSweepTimer: NodeJS.Timeout | null = null;

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
    this.startCooldownSweep();
  }

  private startCooldownSweep(): void {
    this.stopCooldownSweep();
    this.cooldownSweepTimer = setInterval(() => this.sweepCooldowns(), COOLDOWN_SWEEP_MS);
    // Avoid keeping the process alive solely for cleanup.
    (this.cooldownSweepTimer as any)?.unref?.();
  }

  private stopCooldownSweep(): void {
    if (this.cooldownSweepTimer) {
      clearInterval(this.cooldownSweepTimer);
      this.cooldownSweepTimer = null;
    }
  }

  private sweepCooldowns(): void {
    const now = Date.now();
    for (const [cmd, perUser] of this.cooldowns.entries()) {
      for (const [userId, rec] of perUser.entries()) {
        if (now - rec.timestamp > COOLDOWN_RETENTION_MS) perUser.delete(userId);
      }
      if (perUser.size === 0) this.cooldowns.delete(cmd);
    }
  }

  private async loadBuiltInCommands(): Promise<void> {
    const helpCommand: Command = {
      data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Show all commands grouped by category')
        .addStringOption((o) => o.setName('category').setDescription('Filter by category').setRequired(false)),
      execute: async (interaction) => {
        const filter = interaction.options.getString('category')?.toLowerCase();
        const byCat = this.getCommandsByCategory();
        const embed = brandedEmbed(BRAND.red)
          .setTitle('🤖 Sukuna Bot — Commands')
          .setDescription('All available slash commands. Use `/help <category>` to filter.');

        let total = 0;
        for (const [cat, cmds] of [...byCat.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
          if (filter && cat.toLowerCase() !== filter) continue;
          const lines = cmds
            .filter((c) => c.enabled !== false)
            .sort((a, b) => a.data.name.localeCompare(b.data.name))
            .map((c) => `\`/${c.data.name}\` — ${c.description}`);
          if (!lines.length) continue;
          total += lines.length;
          embed.addFields({ name: `${cat} (${lines.length})`, value: lines.join('\n').slice(0, 1024) });
        }

        if (total === 0) embed.setDescription('No commands found for that filter.');
        embed.setFooter({ text: `Sukuna Bot • ${total} command${total === 1 ? '' : 's'}` });

        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
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
        const uptimeStr = formatUptime(process.uptime());
        const mem = process.memoryUsage();
        const heapMB = (mem.heapUsed / 1024 / 1024).toFixed(1);
        const client = interaction.client;
        const ping = client?.ws?.ping ?? 0;

        const embed = brandedEmbed(BRAND.red)
          .setTitle('🤖 Sukuna Bot')
          .setDescription('Your all-in-one server companion — moderation, economy, leveling, AI, music & more.')
          .setAuthor({ name: client.user?.username ?? 'Sukuna Bot', iconURL: client.user?.displayAvatarURL() })
          .addFields(
            { name: 'Version', value: '2.0.0', inline: true },
            { name: 'Node.js', value: process.version, inline: true },
            { name: 'Ping', value: `${ping}ms`, inline: true },
            { name: 'Uptime', value: uptimeStr, inline: true },
            { name: 'Servers', value: `${client.guilds.cache.size}`, inline: true },
            { name: 'Users', value: `${client.users.cache.size}`, inline: true },
            { name: 'Memory', value: `${heapMB} MB heap`, inline: true },
            { name: 'Commands', value: `${this.commands.size}`, inline: true },
            { name: 'Status', value: client.isReady() ? '🟢 Online' : '🔴 Offline', inline: true },
          )
          .setThumbnail(client.user?.displayAvatarURL());

        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
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
        const sent = await interaction.reply({ content: '🏓 Pinging...', fetchReply: true });
        const latency = sent.createdTimestamp - interaction.createdTimestamp;
        const apiLatency = interaction.client.ws.ping;

        const embed = brandedEmbed(apiLatency < 100 ? BRAND.green : apiLatency < 200 ? BRAND.orange : BRAND.red)
          .setTitle('🏓 Latency')
          .addFields(
            { name: 'WebSocket', value: `\`${apiLatency}ms\``, inline: true },
            { name: 'Round-trip', value: `\`${latency}ms\``, inline: true },
            { name: 'Health', value: apiLatency < 100 ? '🟢 Excellent' : apiLatency < 200 ? '🟡 Good' : '🔴 High', inline: true },
          );
        await interaction.editReply({ content: null, embeds: [embed] });
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
      await interaction.reply({ embeds: [errorEmbed('Disabled', 'This command is currently disabled.')], flags: MessageFlags.Ephemeral }).catch(() => undefined);
      return;
    }

    try {
      for (const permissionCheck of command.permissions || []) {
        const hasPermission = await permissionCheck(interaction);
        if (!hasPermission) {
          await interaction.reply({ embeds: [errorEmbed('No permission', 'You do not have permission to use this command.')], flags: MessageFlags.Ephemeral }).catch(() => undefined);
          return;
        }
      }

      if (command.cooldown && command.cooldown > 0) {
        const userCooldowns = this.cooldowns.get(commandName) || new Map();
        const now = Date.now();
        const lastUse = userCooldowns.get(interaction.user.id);

        if (lastUse && now - lastUse.timestamp < command.cooldown * 1000) {
          const remaining = Math.ceil((command.cooldown * 1000 - (now - lastUse.timestamp)) / 1000);
          await interaction.reply({ embeds: [errorEmbed('Slow down', `Please wait **${remaining}s** before using \`/${commandName}\` again.`)], flags: MessageFlags.Ephemeral }).catch(() => undefined);
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
        const embed = errorEmbed('Something went wrong', 'An error occurred while executing this command. Please try again.');
        if (interaction.replied || interaction.deferred) {
          await interaction.editReply({ content: null, embeds: [embed] });
        } else {
          await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
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

  public registerCommand(command: Command): void {
    this.commands.set(command.data.name, command);
  }

  public async shutdown(): Promise<void> {
    this.stopCooldownSweep();
    this.commands.clear();
    this.cooldowns.clear();
    this.client = null;
    this.logger.info('Command Registry', 'Command registry shutdown successfully');
  }
}
