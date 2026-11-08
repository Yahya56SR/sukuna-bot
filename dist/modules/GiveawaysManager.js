"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GiveawaysManager = void 0;
const discord_js_1 = require("discord.js");
class GiveawaysManager {
    constructor(logger, config) {
        this.client = null;
        this.giveaways = new Map();
        this.logger = logger;
        this.config = config;
    }
    async initialize(client) {
        try {
            this.client = client;
            this.logger.info('Giveaways Manager', 'Initializing giveaways system...');
            this.logger.info('Giveaways Manager', 'Giveaways system initialized successfully');
        }
        catch (error) {
            this.logger.error('Giveaways Manager', 'Giveaways system initialization failed', error);
            throw error;
        }
    }
    async createGiveaway(guildId, hostId, channelId, prize, description, duration, eligibleRoles = []) {
        if (!this.config.enabled) {
            throw new Error('Giveaways system is disabled');
        }
        const id = Math.random().toString(36).substr(2, 9);
        const endsAt = Date.now() + (duration * 1000);
        const giveaway = {
            id,
            guildId,
            channelId,
            hostId,
            prize,
            description,
            status: 'active',
            endsAt,
            winnerIds: [],
            winnerCount: this.config.minWinners,
            eligibleRoles,
            entryCount: 0,
            createdAt: Date.now(),
        };
        this.giveaways.set(id, giveaway);
        const channel = this.client?.channels.cache.get(channelId);
        if (channel && channel.type === discord_js_1.ChannelType.GuildText) {
            await this.sendGiveawayMessage(channel, giveaway);
        }
        this.logger.info('Giveaways Manager', `Created giveaway ${id}: ${prize}`);
        return id;
    }
    async sendGiveawayMessage(channel, giveaway) {
        const embed = new discord_js_1.EmbedBuilder()
            .setColor('#ffd700')
            .setTitle('🎉 Giveaway!')
            .setDescription(`**Prize:** ${giveaway.prize}\n**Description:** ${giveaway.description}\n**Hosted by:** <@${giveaway.hostId}>\n**Ends in:** ${this.formatTime(giveaway.endsAt - Date.now())}\n**Entries:** ${giveaway.entryCount}`)
            .setFooter({ text: 'React with 🎉 to enter!' });
        const message = await channel.send({ embeds: [embed] });
        await message.react('🎉');
        giveaway.id = message.id;
    }
    async handleGiveawayReaction(message, user) {
        if (user.bot)
            return;
        const giveawayId = this.getGiveawayIdFromMessage(message.id);
        if (!giveawayId)
            return;
        const giveaway = this.giveaways.get(giveawayId);
        if (!giveaway || giveaway.status !== 'active')
            return;
        if (this.config.roleRestrictions && giveaway.eligibleRoles.length > 0) {
            const member = message.guild?.members.cache.get(user.id);
            if (!member || !member.roles.cache.some((role) => giveaway.eligibleRoles.includes(role.id))) {
                return;
            }
        }
        giveaway.entryCount++;
        this.logger.info('Giveaways Manager', `${user.tag} entered giveaway ${giveawayId}`);
        if (Date.now() >= giveaway.endsAt) {
            await this.endGiveaway(giveawayId);
        }
    }
    async endGiveaway(giveawayId) {
        const giveaway = this.giveaways.get(giveawayId);
        if (!giveaway || giveaway.status !== 'active')
            return;
        giveaway.status = 'ended';
        const eligibleUsers = [];
        for (let i = 0; i < Math.min(giveaway.winnerCount, giveaway.entryCount); i++) {
            eligibleUsers.push(`user_${Math.floor(Math.random() * 1000)}`);
        }
        giveaway.winnerIds = eligibleUsers;
        const channel = this.client?.channels.cache.get(giveaway.channelId);
        if (channel && channel.type === discord_js_1.ChannelType.GuildText) {
            const embed = new discord_js_1.EmbedBuilder()
                .setColor('#00ff00')
                .setTitle('🎉 Giveaway Ended!')
                .setDescription(`**Prize:** ${giveaway.prize}\n**Winners:** ${eligibleUsers.map(id => `<@${id}>`).join(', ')}`)
                .setTimestamp();
            await channel.send({ embeds: [embed] });
        }
        this.logger.info('Giveaways Manager', `Giveaway ${giveawayId} ended with winners: ${eligibleUsers.join(', ')}`);
    }
    getGiveawayIdFromMessage(messageId) {
        for (const [id, giveaway] of this.giveaways.entries()) {
            if (giveaway.id === messageId) {
                return id;
            }
        }
        return null;
    }
    formatTime(milliseconds) {
        const seconds = Math.floor(milliseconds / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);
        if (days > 0)
            return `${days}d ${hours % 24}h`;
        if (hours > 0)
            return `${hours}h ${minutes % 60}m`;
        if (minutes > 0)
            return `${minutes}m ${seconds % 60}s`;
        return `${seconds}s`;
    }
    async shutdown() {
        this.giveaways.clear();
        this.logger.info('Giveaways Manager', 'Giveaways system shutdown successfully');
    }
}
exports.GiveawaysManager = GiveawaysManager;
