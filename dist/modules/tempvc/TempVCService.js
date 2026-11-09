"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TempVCService = void 0;
const discord_js_1 = require("discord.js");
const drizzle_orm_1 = require("drizzle-orm");
const schema_1 = require("../../database/schema");
const PANEL_PREFIX = 'tempvc:';
const PANEL_BUTTONS = [
    { id: 'rename', label: 'RENAME', emoji: '✏️', style: discord_js_1.ButtonStyle.Secondary },
    { id: 'limit', label: 'LIMIT', emoji: '👥', style: discord_js_1.ButtonStyle.Secondary },
    { id: 'lock', label: 'LOCK', emoji: '🔒', style: discord_js_1.ButtonStyle.Secondary },
    { id: 'unlock', label: 'UNLOCK', emoji: '🔓', style: discord_js_1.ButtonStyle.Secondary },
    { id: 'invite', label: 'INVITE', emoji: '✉️', style: discord_js_1.ButtonStyle.Secondary },
    { id: 'delete', label: 'DELETE', emoji: '🗑️', style: discord_js_1.ButtonStyle.Danger },
    { id: 'hide', label: 'HIDE', emoji: '👁️', style: discord_js_1.ButtonStyle.Secondary },
    { id: 'show', label: 'SHOW', emoji: '👁️', style: discord_js_1.ButtonStyle.Secondary },
    { id: 'claim', label: 'CLAIM', emoji: '✅', style: discord_js_1.ButtonStyle.Success },
    { id: 'kick', label: 'KICK', emoji: '👢', style: discord_js_1.ButtonStyle.Danger },
];
class TempVCService {
    constructor(logger) {
        this.db = null;
        this.client = null;
        this.config = null;
        this.instances = new Map();
        this.logger = logger;
    }
    setDb(db) {
        this.db = db;
    }
    setClient(client) {
        this.client = client;
    }
    async initialize() {
        if (!this.db)
            return;
        const rows = await this.db.select().from(schema_1.tempvcConfigs).limit(1);
        if (rows[0]) {
            this.config = {
                enabled: true,
                createChannelId: rows[0].create_channel_id,
                categoryId: rows[0].category_id,
                panelChannelId: rows[0].panel_channel_id || '',
                panelMessageId: rows[0].panel_message_id || '',
            };
        }
        // Load existing temp VC instances
        const instances = await this.db.select().from(schema_1.tempvcInstances);
        for (const inst of instances) {
            this.instances.set(inst.channel_id, {
                channelId: inst.channel_id,
                ownerId: inst.owner_id,
                categoryId: inst.category_id,
                createdAt: inst.created_at ? new Date(inst.created_at).getTime() : Date.now(),
            });
        }
        this.logger.info('TempVC Service', `Temp VC system initialized with ${this.instances.size} active instances`);
    }
    setConfig(config) {
        this.config = config;
    }
    getConfig() {
        return this.config;
    }
    async setup(createChannelId, categoryId) {
        if (!this.db)
            throw new Error('Database not connected');
        await this.db.insert(schema_1.tempvcConfigs).values({
            id: 'tempvc_main',
            create_channel_id: createChannelId,
            category_id: categoryId,
            panel_channel_id: '',
            panel_message_id: '',
            enabled: true,
        });
        this.config = {
            enabled: true,
            createChannelId,
            categoryId,
            panelChannelId: '',
            panelMessageId: '',
        };
        this.logger.info('TempVC Service', `Temp VC setup: createChannel=${createChannelId}, category=${categoryId}`);
    }
    async setPanel(channelId, messageId) {
        if (!this.db || !this.config)
            return;
        await this.db.update(schema_1.tempvcConfigs)
            .set({ panel_channel_id: channelId, panel_message_id: messageId })
            .where((0, drizzle_orm_1.eq)(schema_1.tempvcConfigs.id, 'tempvc_main'));
        this.config.panelChannelId = channelId;
        this.config.panelMessageId = messageId;
    }
    async createTempVC(member) {
        if (!this.config || !this.client)
            return null;
        const category = this.client.guilds.cache.get(member.guild.id)?.channels.cache.get(this.config.categoryId);
        if (!category || category.type !== discord_js_1.ChannelType.GuildCategory)
            return null;
        try {
            const vc = await member.guild.channels.create({
                name: `${member.user.username}'s VC`,
                type: discord_js_1.ChannelType.GuildVoice,
                parent: category,
                reason: 'Join-to-create temp VC',
            });
            await member.voice.setChannel(vc);
            const instance = {
                channelId: vc.id,
                ownerId: member.id,
                categoryId: this.config.categoryId,
                createdAt: Date.now(),
            };
            if (this.db) {
                await this.db.insert(schema_1.tempvcInstances).values({
                    id: vc.id,
                    channel_id: vc.id,
                    owner_id: member.id,
                    category_id: this.config.categoryId,
                    created_at: new Date(),
                });
            }
            this.instances.set(vc.id, instance);
            this.logger.info('TempVC Service', `Created temp VC ${vc.id} for ${member.user.tag}`);
            return vc.id;
        }
        catch (err) {
            this.logger.error('TempVC Service', 'Failed to create temp VC', err);
            return null;
        }
    }
    async deleteTempVC(channelId) {
        if (!this.client)
            return;
        const channel = this.client.channels.cache.get(channelId);
        if (channel) {
            try {
                await channel.delete();
            }
            catch {
                /* ignore */
            }
        }
        if (this.db) {
            await this.db.delete(schema_1.tempvcInstances).where((0, drizzle_orm_1.eq)(schema_1.tempvcInstances.channel_id, channelId));
        }
        this.instances.delete(channelId);
    }
    isTempVC(channelId) {
        return this.instances.has(channelId);
    }
    getTempVC(channelId) {
        return this.instances.get(channelId);
    }
    getPanelButtons() {
        const rows = [];
        for (let i = 0; i < PANEL_BUTTONS.length; i += 5) {
            const row = new discord_js_1.ActionRowBuilder();
            for (const btn of PANEL_BUTTONS.slice(i, i + 5)) {
                row.addComponents(new discord_js_1.ButtonBuilder()
                    .setCustomId(`${PANEL_PREFIX}${btn.id}`)
                    .setLabel(btn.label)
                    .setEmoji(btn.emoji)
                    .setStyle(btn.style));
            }
            rows.push(row);
        }
        return rows;
    }
    async handlePanelButton(interaction) {
        const customId = interaction.customId;
        if (!customId.startsWith(PANEL_PREFIX))
            return false;
        const action = customId.slice(PANEL_PREFIX.length);
        const member = interaction.member;
        if (!member)
            return false;
        const vcChannelId = member.voice?.channel?.id;
        if (!vcChannelId) {
            await interaction.reply({ content: 'You must be in a voice channel to use these controls.', ephemeral: true });
            return true;
        }
        const temp = this.getTempVC(vcChannelId);
        if (!temp) {
            await interaction.reply({ content: 'This is not a temporary voice channel.', ephemeral: true });
            return true;
        }
        const isOwner = temp.ownerId === member.id;
        const guild = member.guild;
        switch (action) {
            case 'rename':
                if (!isOwner) {
                    await interaction.reply({ content: 'Only the VC owner can rename it.', ephemeral: true });
                    return true;
                }
                await interaction.reply({ content: 'Use `/tempvc name <name>` to rename your VC.', ephemeral: true });
                return true;
            case 'limit':
                if (!isOwner) {
                    await interaction.reply({ content: 'Only the VC owner can set the limit.', ephemeral: true });
                    return true;
                }
                await interaction.reply({ content: 'Use `/tempvc limit <number>` to set the user limit.', ephemeral: true });
                return true;
            case 'lock':
                if (!isOwner) {
                    await interaction.reply({ content: 'Only the VC owner can lock it.', ephemeral: true });
                    return true;
                }
                try {
                    await member.voice.channel.permissionOverwrites.edit(guild.id, { Connect: false });
                    await interaction.reply({ content: '🔒 VC locked.', ephemeral: true });
                }
                catch (err) {
                    await interaction.reply({ content: `Failed to lock: ${err instanceof Error ? err.message : String(err)}`, ephemeral: true });
                }
                return true;
            case 'unlock':
                if (!isOwner) {
                    await interaction.reply({ content: 'Only the VC owner can unlock it.', ephemeral: true });
                    return true;
                }
                try {
                    await member.voice.channel.permissionOverwrites.edit(guild.id, { Connect: null });
                    await interaction.reply({ content: '🔓 VC unlocked.', ephemeral: true });
                }
                catch (err) {
                    await interaction.reply({ content: `Failed to unlock: ${err instanceof Error ? err.message : String(err)}`, ephemeral: true });
                }
                return true;
            case 'invite':
                if (!isOwner) {
                    await interaction.reply({ content: 'Only the VC owner can invite.', ephemeral: true });
                    return true;
                }
                await interaction.reply({ content: `Invite someone: <#${vcChannelId}>`, ephemeral: true });
                return true;
            case 'delete':
                if (!isOwner) {
                    await interaction.reply({ content: 'Only the VC owner can delete it.', ephemeral: true });
                    return true;
                }
                try {
                    await member.voice.channel.delete();
                    await this.deleteTempVC(vcChannelId);
                    await interaction.reply({ content: '🗑️ VC deleted.', ephemeral: true });
                }
                catch (err) {
                    await interaction.reply({ content: `Failed to delete: ${err instanceof Error ? err.message : String(err)}`, ephemeral: true });
                }
                return true;
            case 'hide':
                if (!isOwner) {
                    await interaction.reply({ content: 'Only the VC owner can hide it.', ephemeral: true });
                    return true;
                }
                try {
                    await member.voice.channel.permissionOverwrites.edit(guild.id, { ViewChannel: false });
                    await interaction.reply({ content: '👁️‍🗨️ VC hidden.', ephemeral: true });
                }
                catch (err) {
                    await interaction.reply({ content: `Failed to hide: ${err instanceof Error ? err.message : String(err)}`, ephemeral: true });
                }
                return true;
            case 'show':
                if (!isOwner) {
                    await interaction.reply({ content: 'Only the VC owner can show it.', ephemeral: true });
                    return true;
                }
                try {
                    await member.voice.channel.permissionOverwrites.edit(guild.id, { ViewChannel: null });
                    await interaction.reply({ content: '👁️ VC shown.', ephemeral: true });
                }
                catch (err) {
                    await interaction.reply({ content: `Failed to show: ${err instanceof Error ? err.message : String(err)}`, ephemeral: true });
                }
                return true;
            case 'claim':
                if (isOwner) {
                    await interaction.reply({ content: 'You already own this VC.', ephemeral: true });
                    return true;
                }
                if (!temp.ownerId || !guild.members.cache.has(temp.ownerId)) {
                    temp.ownerId = member.id;
                    if (this.db) {
                        await this.db.update(schema_1.tempvcInstances)
                            .set({ owner_id: member.id })
                            .where((0, drizzle_orm_1.eq)(schema_1.tempvcInstances.channel_id, vcChannelId));
                    }
                    await interaction.reply({ content: '📥 VC claimed.', ephemeral: true });
                }
                else {
                    await interaction.reply({ content: 'This VC already has an owner.', ephemeral: true });
                }
                return true;
            case 'kick':
                if (!isOwner) {
                    await interaction.reply({ content: 'Only the VC owner can kick members.', ephemeral: true });
                    return true;
                }
                await interaction.reply({ content: 'Use `/tempvc kick <member>` to kick from your VC.', ephemeral: true });
                return true;
            default:
                return false;
        }
    }
    async handleVoiceStateUpdate(oldChannelId, newChannelId, member) {
        if (!this.config)
            return false;
        // If they joined the create channel, spawn a temp VC
        if (newChannelId === this.config.createChannelId && oldChannelId !== newChannelId) {
            return (await this.createTempVC(member)) !== null;
        }
        // If they left a temp VC and it's now empty, delete it
        if (oldChannelId && oldChannelId !== newChannelId) {
            const temp = this.getTempVC(oldChannelId);
            if (temp) {
                const channel = this.client?.channels.cache.get(oldChannelId);
                if (channel && channel.members.size === 0) {
                    await this.deleteTempVC(oldChannelId);
                    return true;
                }
            }
        }
        return false;
    }
    async postPanel(channel) {
        if (!this.config)
            return null;
        const createMention = this.config.createChannelId ? `<#${this.config.createChannelId}>` : '`Create VC`';
        const categoryMention = this.config.categoryId ? `<#${this.config.categoryId}>` : 'a category';
        const embed = new discord_js_1.EmbedBuilder()
            .setColor(0xef4444)
            .setTitle('🔊 Temporary Voice — Sukuna')
            .setDescription(`Join ${createMention} and a private room opens for you instantly.\n\n` +
            'Use the buttons below while you are inside your room to rename it, set a limit, lock/hide it, or delete it. Only the room owner (or whoever claims an abandoned room) can manage it.')
            .addFields({ name: '✨ How it works', value: `1. Join ${createMention}\n2. Your room appears in ${categoryMention}\n3. Manage it with the buttons (or \`/tempvc\` commands)`, inline: true }, { name: '🎛️ Controls', value: 'Rename • Limit • Lock/Unlock\nHide/Show • Invite • Kick\nClaim (if abandoned) • Delete', inline: true }, { name: '💡 Tips', value: 'Empty rooms auto-delete.\nCreate is instant — no queue.\nOwners can set a member limit.', inline: true })
            .setFooter({ text: 'Sukuna Bot • TempVC' })
            .setTimestamp();
        const rows = this.getPanelButtons();
        let message = null;
        try {
            message = await channel.send({ embeds: [embed], components: rows });
            await this.setPanel(channel.id, message.id);
            return message;
        }
        catch (err) {
            this.logger.error('TempVC Service', 'Failed to post panel', err);
            return null;
        }
    }
    async shutdown() {
        this.instances.clear();
        this.logger.info('TempVC Service', 'Temp VC system shutdown');
    }
}
exports.TempVCService = TempVCService;
