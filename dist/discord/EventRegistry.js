"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EventRegistry = void 0;
const discord_js_1 = require("discord.js");
class EventRegistry {
    constructor(logger) {
        this.client = null;
        this.logger = logger;
    }
    async initialize(client) {
        this.client = client;
        this.setupEventHandlers();
    }
    setupEventHandlers() {
        if (!this.client)
            return;
        this.client.once(discord_js_1.Events.ClientReady, () => {
            this.logger.info('Event Registry', `Bot logged in as ${this.client?.user?.tag}`);
        });
        this.client.on(discord_js_1.Events.Error, (error) => {
            this.logger.error('Event Registry', 'Discord error', error);
        });
        this.client.on(discord_js_1.Events.Warn, (warning) => {
            this.logger.warn('Event Registry', 'Discord warning', warning);
        });
        this.client.on(discord_js_1.Events.ShardDisconnect, (event) => {
            this.logger.warn('Event Registry', `Shard disconnected: ${event.code} ${event.reason}`);
        });
        this.client.on(discord_js_1.Events.GuildCreate, (guild) => {
            this.logger.info('Event Registry', `Joined guild: ${guild.name} (${guild.id})`);
        });
        this.client.on(discord_js_1.Events.GuildDelete, (guild) => {
            this.logger.info('Event Registry', `Left guild: ${guild.name} (${guild.id})`);
        });
    }
    async shutdown() {
        if (this.client) {
            this.client.removeAllListeners();
        }
        this.client = null;
    }
}
exports.EventRegistry = EventRegistry;
