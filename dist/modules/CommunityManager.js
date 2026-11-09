"use strict";
// Sukuna Bot - Welcome/Goodbye Systems
Object.defineProperty(exports, "__esModule", { value: true });
exports.CommunityManager = void 0;
const discord_js_1 = require("discord.js");
const welcomecard_1 = require("../utils/welcomecard");
class CommunityManager {
    constructor(logger, communityConfig) {
        this.client = null;
        this.cardService = null;
        this.logger = logger;
        this.communityConfig = communityConfig;
        // Back-compat: default sendImage on for existing configs
        this.communityConfig.welcome.sendImage = this.communityConfig.welcome.sendImage ?? true;
        this.communityConfig.welcome.welcomeImageMessage = this.communityConfig.welcome.welcomeImageMessage ?? 'Welcome {username} to {server}!';
    }
    setCardService(service) {
        this.cardService = service;
    }
    setConfig(config) {
        this.communityConfig = config;
    }
    getConfig() {
        return this.communityConfig;
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
    fillTemplate(template, member) {
        return (template || '')
            .replace(/\{user\}/g, `<@${member.id}>`)
            .replace(/\{username\}/g, member.displayName ?? member.user?.username ?? member.user?.tag ?? 'New Member')
            .replace(/\{server\}/g, member.guild?.name ?? '')
            .replace(/\{memberCount\}/g, String(member.guild?.memberCount ?? ''))
            .replace(/\{tag\}/g, member.user?.tag ?? '');
    }
    fillTemplateForImage(template, member) {
        // Image cards can't render @mentions — use plain display name
        return (template || '')
            .replace(/\{user\}/g, member.displayName ?? member.user?.username ?? 'New Member')
            .replace(/\{username\}/g, member.displayName ?? member.user?.username ?? 'New Member')
            .replace(/\{server\}/g, member.guild?.name ?? '')
            .replace(/\{memberCount\}/g, String(member.guild?.memberCount ?? ''))
            .replace(/\{tag\}/g, member.user?.tag ?? '');
    }
    async handleMemberJoin(member) {
        if (!this.communityConfig.welcome.enabled)
            return;
        const channel = member.guild.channels.cache.get(this.communityConfig.welcome.channel);
        if (!channel || channel.type !== discord_js_1.ChannelType.GuildText) {
            return;
        }
        try {
            const textMessage = this.fillTemplate(this.communityConfig.welcome.message, member);
            const imageMessage = this.fillTemplateForImage(this.communityConfig.welcome.welcomeImageMessage || 'Welcome {username} to {server}!', member);
            const shouldSendImage = this.communityConfig.welcome.sendImage !== false;
            if (shouldSendImage) {
                try {
                    const tmpl = this.cardService?.getConfig?.()?.welcome;
                    const buffer = await welcomecard_1.welcomeCard.generate({
                        avatarUrl: member.user.displayAvatarURL({ extension: 'png', size: 256 }),
                        displayName: member.displayName ?? member.user.username,
                        guildName: member.guild.name,
                        memberCount: member.guild.memberCount,
                        welcomeMessage: imageMessage,
                        template: tmpl,
                    });
                    const file = new discord_js_1.AttachmentBuilder(buffer, { name: 'welcome.png' });
                    if (this.communityConfig.welcome.embed) {
                        const embed = new discord_js_1.EmbedBuilder()
                            .setColor('#ef4444')
                            .setTitle('🎉 Welcome!')
                            .setDescription(textMessage)
                            .setThumbnail(member.user.displayAvatarURL())
                            .setImage('attachment://welcome.png')
                            .setFooter({ text: member.guild.name })
                            .setTimestamp();
                        await channel.send({ embeds: [embed], files: [file] });
                    }
                    else {
                        await channel.send({ content: textMessage, files: [file] });
                    }
                }
                catch (cardErr) {
                    this.logger.warn('Community Manager', 'Welcome card render failed, sending text only', cardErr);
                    // Fallback to text/embed without image
                    if (this.communityConfig.welcome.embed) {
                        const embed = new discord_js_1.EmbedBuilder()
                            .setColor('#ef4444')
                            .setTitle('🎉 Welcome!')
                            .setDescription(textMessage)
                            .setThumbnail(member.user.displayAvatarURL())
                            .setFooter({ text: member.guild.name })
                            .setTimestamp();
                        await channel.send({ embeds: [embed] });
                    }
                    else {
                        await channel.send(textMessage);
                    }
                }
            }
            else if (this.communityConfig.welcome.embed) {
                const embed = new discord_js_1.EmbedBuilder()
                    .setColor('#ef4444')
                    .setTitle('🎉 Welcome!')
                    .setDescription(textMessage)
                    .setThumbnail(member.user.displayAvatarURL())
                    .setFooter({ text: member.guild.name })
                    .setTimestamp();
                await channel.send({ embeds: [embed] });
            }
            else {
                await channel.send(textMessage);
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
            const message = this.fillTemplate(this.communityConfig.goodbye.message, member);
            if (this.communityConfig.goodbye.embed) {
                const embed = new discord_js_1.EmbedBuilder()
                    .setColor('#ff0000')
                    .setTitle('👋 Goodbye!')
                    .setDescription(message)
                    .setThumbnail(member.user.displayAvatarURL())
                    .setFooter({ text: member.guild.name })
                    .setTimestamp();
                await channel.send({ embeds: [embed] });
            }
            else {
                await channel.send(message);
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
