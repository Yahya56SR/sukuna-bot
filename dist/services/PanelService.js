"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PanelService = exports.DEFAULT_PANEL_CONFIG = void 0;
exports.getDefaultPanelConfig = getDefaultPanelConfig;
const discord_js_1 = require("discord.js");
const emoji_1 = require("../utils/emoji");
const panel_1 = require("../utils/panel");
exports.DEFAULT_PANEL_CONFIG = {
    banner: true,
    emojiGuild: '',
    emojiMap: '',
    accent: '',
};
function getDefaultPanelConfig() {
    return { ...exports.DEFAULT_PANEL_CONFIG };
}
class PanelService {
    constructor(logger, config) {
        this.config = getDefaultPanelConfig();
        this.client = null;
        this.lastEmojiCount = 0;
        this.lastEmojiGuild = '';
        this.logger = logger;
        if (config)
            this.config = { ...this.config, ...config };
        this.applyEmojiMap(this.config.emojiMap);
        (0, panel_1.setPanelBannerEnabled)(this.config.banner !== false);
        (0, panel_1.setPanelAccent)(this.config.accent ?? '');
    }
    getConfig() {
        return this.config;
    }
    setConfig(next) {
        this.config = { ...this.config, ...(next ?? {}) };
        if (typeof this.config.emojiMap === 'string')
            this.applyEmojiMap(this.config.emojiMap);
        (0, panel_1.setPanelBannerEnabled)(this.config.banner !== false);
        (0, panel_1.setPanelAccent)(this.config.accent ?? '');
        return this.config;
    }
    setClient(client) {
        this.client = client;
    }
    getEmojiStats() {
        return { count: this.lastEmojiCount, guild: this.lastEmojiGuild };
    }
    /** Custom emoji the bot can use, plus the resolved value of every key. */
    getEmojiOverview() {
        return {
            count: this.lastEmojiCount,
            guild: this.lastEmojiGuild,
            custom: emoji_1.emojiRegistry.listCustomEmojis(),
            resolved: emoji_1.emojiRegistry.snapshot(),
        };
    }
    /**
     * Splits the emoji map into aliases (`key = name`) and direct overrides
     * (`key = <a:name:id>`), then hands both to the registry.
     */
    applyEmojiMap(text) {
        const aliases = {};
        const direct = {};
        for (const line of String(text ?? '').split(/\r?\n/)) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#'))
                continue;
            const separator = trimmed.indexOf('=');
            if (separator <= 0)
                continue;
            const key = trimmed.slice(0, separator).trim().toLowerCase();
            const value = trimmed.slice(separator + 1).trim();
            if (!key || !value)
                continue;
            if (value.startsWith('<') && value.endsWith('>'))
                direct[key] = value;
            else
                aliases[key] = value;
        }
        emoji_1.emojiRegistry.setAliases(aliases);
        emoji_1.emojiRegistry.setDirect(direct);
    }
    /** Finds the guild that holds the bot's custom emojis. */
    async resolveEmojiGuild(client) {
        const active = client ?? this.client;
        if (!active)
            return null;
        const configured = String(this.config.emojiGuild ?? '').trim();
        if (configured) {
            if (/^\d+$/.test(configured)) {
                const guild = active.guilds.cache.get(configured);
                if (guild)
                    return guild.id;
                try {
                    await active.rest.get(discord_js_1.Routes.guild(configured));
                    return configured;
                }
                catch {
                    this.logger.warn('Panel Service', `Emoji guild ${configured} is not available to the bot`);
                    return null;
                }
            }
            const byName = active.guilds.cache.find((g) => g.name.toLowerCase() === configured.toLowerCase());
            return byName?.id ?? null;
        }
        // No guild configured — look for an obvious "emoji" server.
        const guess = active.guilds.cache.find((g) => /emoji/i.test(g.name));
        return guess?.id ?? null;
    }
    /**
     * Pulls the emoji server's emoji list into the registry. Works without the
     * emoji gateway intent because it goes through the REST API.
     */
    async refreshEmojis(client) {
        const active = client ?? this.client;
        if (!active)
            return 0;
        const guildId = await this.resolveEmojiGuild(active);
        if (!guildId) {
            this.lastEmojiCount = 0;
            this.lastEmojiGuild = '';
            emoji_1.emojiRegistry.setCustomEmojis([]);
            return 0;
        }
        let emojis = [];
        try {
            const raw = await active.rest.get(discord_js_1.Routes.guildEmojis(guildId));
            emojis = (raw ?? []).map((e) => ({ id: String(e.id), name: String(e.name), animated: Boolean(e.animated) }));
        }
        catch (error) {
            this.logger.warn('Panel Service', `Could not fetch emojis for guild ${guildId}: ${error.message}`);
            const guild = active.guilds.cache.get(guildId);
            if (guild?.emojis?.cache?.size) {
                emojis = [...guild.emojis.cache.values()].map((e) => ({ id: e.id, name: e.name ?? '', animated: e.animated }));
            }
        }
        const count = emoji_1.emojiRegistry.setCustomEmojis(emojis);
        this.lastEmojiCount = count;
        this.lastEmojiGuild = guildId;
        this.logger.info('Panel Service', `Loaded ${count} custom emoji(s) from guild ${guildId}`);
        return count;
    }
}
exports.PanelService = PanelService;
