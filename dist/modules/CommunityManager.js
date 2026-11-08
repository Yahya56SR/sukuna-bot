"use strict";
// Sukuna Bot - Welcome/Goodbye Systems
Object.defineProperty(exports, "__esModule", { value: true });
exports.CommunityManager = void 0;
const discord_js_1 = require("discord.js");
class CommunityManager {
    constructor(logger, communityConfig) {
        this.client = null;
        this.logger = logger;
        this.communityConfig = communityConfig;
    }
    async initialize(client) {
        try {
            this.client = client;
            this.logger.info('Community Manager', 'Initializing community systems...');
            this.setupEventHandlers();
            this.logger.info('Community Manager', 'Community systems initialized successfully');
        }
        catch (error) {
            this.logger.error('Community Manager', 'Community systems initialization failed', error);
            throw error;
        }
    }
    setupEventHandlers() {
        if (!this.client)
            return;
        this.client.on('guildMemberAdd', async (member) => {
            await this.handleMemberJoin(member);
        });
        this.client.on('guildMemberRemove', async (member) => {
            await this.handleMemberLeave(member);
        });
    }
    async handleMemberJoin(member) {
        if (!this.communityConfig.welcome.enabled)
            return;
        const channel = member.guild.channels.cache.get(this.communityConfig.welcome.channel);
        if (!channel || channel.type !== discord_js_1.ChannelType.GuildText) {
            return;
        }
        try {
            if (this.communityConfig.welcome.embed) {
                const embed = new discord_js_1.EmbedBuilder()
                    .setColor('#00ff00')
                    .setTitle('🎉 Welcome!')
                    .setDescription(this.communityConfig.welcome.message.replace('{user}', member.user.tag).replace('{server}', member.guild.name))
                    .setThumbnail(member.user.displayAvatarURL())
                    .setFooter({ text: member.guild.name })
                    .setTimestamp();
                await channel.send({ embeds: [embed] });
            }
            else {
                await channel.send(this.communityConfig.welcome.message.replace('{user}', member.user.tag).replace('{server}', member.guild.name));
            }
            this.logger.info('Community Manager', `Welcome message sent for ${member.user.tag} in ${member.guild.name}`);
        }
        catch (error) {
            this.logger.error('Community Manager', `Failed to send welcome message for ${member.user.tag}`, error);
        }
    }
    async handleMemberLeave(member) {
        if (!this.communityConfig.goodbye.enabled)
            return;
        const channel = member.guild.channels.cache.get(this.communityConfig.goodbye.channel);
        if (!channel || channel.type !== discord_js_1.ChannelType.GuildText) {
            return;
        }
        try {
            if (this.communityConfig.goodbye.embed) {
                const embed = new discord_js_1.EmbedBuilder()
                    .setColor('#ff0000')
                    .setTitle('👋 Goodbye!')
                    .setDescription(this.communityConfig.goodbye.message.replace('{user}', member.user.tag).replace('{server}', member.guild.name))
                    .setThumbnail(member.user.displayAvatarURL())
                    .setFooter({ text: member.guild.name })
                    .setTimestamp();
                await channel.send({ embeds: [embed] });
            }
            else {
                await channel.send(this.communityConfig.goodbye.message.replace('{user}', member.user.tag).replace('{server}', member.guild.name));
            }
            this.logger.info('Community Manager', `Goodbye message sent for ${member.user.tag} in ${member.guild.name}`);
        }
        catch (error) {
            this.logger.error('Community Manager', `Failed to send goodbye message for ${member.user.tag}`, error);
        }
    }
    async assignDefaultRole(member) {
        if (!this.communityConfig.autoroles.enabled || !this.communityConfig.autoroles.defaultRole)
            return;
        try {
            const role = member.guild.roles.cache.get(this.communityConfig.autoroles.defaultRole);
            if (role) {
                await member.roles.add(role);
                this.logger.info('Community Manager', `Assigned default role to ${member.user.tag} in ${member.guild.name}`);
            }
        }
        catch (error) {
            this.logger.error('Community Manager', `Failed to assign default role to ${member.user.tag}`, error);
        }
    }
    async shutdown() {
        this.logger.info('Community Manager', 'Community systems shutdown successfully');
    }
}
exports.CommunityManager = CommunityManager;
