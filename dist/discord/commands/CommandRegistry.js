"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CommandRegistry = void 0;
const discord_js_1 = require("discord.js");
class CommandRegistry {
    constructor(logger) {
        this.client = null;
        this.commands = new Map();
        this.logger = logger;
    }
    async initialize(client) {
        try {
            this.client = client;
            this.logger.info('Command Registry', 'Initializing command registry...');
            // Load built-in commands
            await this.loadBuiltInCommands();
            // Register commands with Discord
            if (this.client.isReady()) {
                await this.registerCommands();
            }
            else {
                this.client.once('ready', () => {
                    this.registerCommands();
                });
            }
            this.logger.info('Command Registry', 'Command registry initialized successfully');
        }
        catch (error) {
            this.logger.error('Command Registry', 'Command registry initialization failed', error);
            throw error;
        }
    }
    async loadBuiltInCommands() {
        // Help command
        const helpCommand = {
            data: new discord_js_1.SlashCommandBuilder()
                .setName('help')
                .setDescription('Show help information about commands'),
            execute: async (interaction) => {
                await interaction.reply({
                    content: 'Welcome to Sukuna Bot! Use `/help` for more information about available commands.',
                    flags: discord_js_1.MessageFlags.Ephemeral,
                });
            },
            description: 'Show help information about commands',
            category: 'General',
            enabled: true,
        };
        this.commands.set('help', helpCommand);
        // Info command
        const infoCommand = {
            data: new discord_js_1.SlashCommandBuilder()
                .setName('info')
                .setDescription('Show bot information and statistics'),
            execute: async (interaction) => {
                const uptime = process.uptime();
                const uptimeStr = this.formatUptime(uptime);
                await interaction.reply({
                    content: `**Sukuna Bot**\n` +
                        `Version: 1.0.0\n` +
                        `Node.js: ${process.version}\n` +
                        `Discord.js: 14.28.1\n` +
                        `Uptime: ${uptimeStr}\n` +
                        `Guilds: ${interaction.client.guilds.cache.size}\n` +
                        `Users: ${interaction.client.users.cache.size}`,
                    flags: 0,
                });
            },
            description: 'Show bot information and statistics',
            category: 'General',
            enabled: true,
        };
        this.commands.set('info', infoCommand);
        // Ping command
        const pingCommand = {
            data: new discord_js_1.SlashCommandBuilder()
                .setName('ping')
                .setDescription('Check bot latency'),
            execute: async (interaction) => {
                const sent = await interaction.reply({ content: 'Pinging...', flags: 0, fetchReply: true });
                const latency = sent.createdTimestamp - interaction.createdTimestamp;
                const apiLatency = interaction.client.ws.ping;
                await interaction.editReply({
                    content: `**Latency Results:**\n` +
                        `WebSocket: ${apiLatency}ms\n` +
                        `Round-trip: ${latency}ms\n` +
                        `API: ${Math.round(apiLatency)}ms`,
                });
            },
            description: 'Check bot latency',
            category: 'General',
            enabled: true,
        };
        this.commands.set('ping', pingCommand);
        // Welcome command
        const welcomeCommand = {
            data: new discord_js_1.SlashCommandBuilder()
                .setName('welcome')
                .setDescription('Set up welcome messages for new members'),
            execute: async (interaction) => {
                await interaction.reply({
                    content: 'Welcome command - configure welcome settings for your server',
                    flags: discord_js_1.MessageFlags.Ephemeral,
                });
            },
            description: 'Set up welcome messages for new members',
            category: 'Community',
            enabled: true,
        };
        this.commands.set('welcome', welcomeCommand);
        // Goodbye command
        const goodbyeCommand = {
            data: new discord_js_1.SlashCommandBuilder()
                .setName('goodbye')
                .setDescription('Set up goodbye messages for departing members'),
            execute: async (interaction) => {
                await interaction.reply({
                    content: 'Goodbye command - configure goodbye settings for your server',
                    flags: discord_js_1.MessageFlags.Ephemeral,
                });
            },
            description: 'Set up goodbye messages for departing members',
            category: 'Community',
            enabled: true,
        };
        this.commands.set('goodbye', goodbyeCommand);
        // Giveaway command
        const giveawayCommand = {
            data: new discord_js_1.SlashCommandBuilder()
                .setName('giveaway')
                .setDescription('Create a new giveaway'),
            execute: async (interaction) => {
                await interaction.reply({
                    content: 'Giveaway command - create and manage giveaways',
                    flags: discord_js_1.MessageFlags.Ephemeral,
                });
            },
            description: 'Create a new giveaway',
            category: 'Community',
            enabled: true,
        };
        this.commands.set('giveaway', giveawayCommand);
        // Ticket command
        const ticketCommand = {
            data: new discord_js_1.SlashCommandBuilder()
                .setName('ticket')
                .setDescription('Create a support ticket'),
            execute: async (interaction) => {
                await interaction.reply({
                    content: 'Ticket command - create and manage support tickets',
                    flags: discord_js_1.MessageFlags.Ephemeral,
                });
            },
            description: 'Create a support ticket',
            category: 'Support',
            enabled: true,
        };
        this.commands.set('ticket', ticketCommand);
        // Poll command
        const pollsCommand = {
            data: new discord_js_1.SlashCommandBuilder()
                .setName('poll')
                .setDescription('Create a poll'),
            execute: async (interaction) => {
                await interaction.reply({
                    content: 'Poll command - create and manage polls',
                    flags: discord_js_1.MessageFlags.Ephemeral,
                });
            },
            description: 'Create a poll',
            category: 'Community',
            enabled: true,
        };
        this.commands.set('poll', pollsCommand);
        this.logger.info('Command Registry', `Loaded ${this.commands.size} commands`);
    }
    async registerCommands() {
        if (!this.client) {
            throw new Error('Client not initialized');
        }
        try {
            // Convert commands to Discord command data
            const commandData = Array.from(this.commands.values())
                .filter(cmd => cmd.enabled !== false)
                .map(cmd => cmd.data.toJSON());
            // Register commands with Discord
            if (this.client.isReady()) {
                const applicationCommands = await this.client.application?.commands;
                if (applicationCommands) {
                    // Set global commands
                    await applicationCommands.set(commandData);
                    this.logger.info('Command Registry', `Registered ${commandData.length} commands globally`);
                }
            }
        }
        catch (error) {
            this.logger.error('Command Registry', 'Failed to register commands', error);
            throw error;
        }
    }
    formatUptime(seconds) {
        const days = Math.floor(seconds / (3600 * 24));
        const hours = Math.floor((seconds % (3600 * 24)) / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        const parts = [];
        if (days > 0)
            parts.push(`${days}d`);
        if (hours > 0)
            parts.push(`${hours}h`);
        if (minutes > 0)
            parts.push(`${minutes}m`);
        parts.push(`${secs}s`);
        return parts.join(' ');
    }
    getCommand(name) {
        return this.commands.get(name.toLowerCase());
    }
    getCommands() {
        return this.commands;
    }
    getCommandsByCategory() {
        const commandsByCategory = new Map();
        this.commands.forEach((command) => {
            if (!commandsByCategory.has(command.category)) {
                commandsByCategory.set(command.category, []);
            }
            commandsByCategory.get(command.category)?.push(command);
        });
        return commandsByCategory;
    }
    async shutdown() {
        this.commands.clear();
        this.client = null;
        this.logger.info('Command Registry', 'Command registry shutdown successfully');
    }
}
exports.CommandRegistry = CommandRegistry;
