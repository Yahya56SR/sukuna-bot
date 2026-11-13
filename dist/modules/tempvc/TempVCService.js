"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TempVCService = void 0;
const discord_js_1 = require("discord.js");
const drizzle_orm_1 = require("drizzle-orm");
const schema_1 = require("../../database/schema");
const id_1 = require("../../utils/id");
const panel_1 = require("../../utils/panel");
/** Config rows are keyed by guild; the dashboard's legacy single config lives in 'global'. */
const GLOBAL_GUILD = 'global';
const PANEL_PREFIX = 'tempvc:';
const PANEL_BUTTONS = [
    { id: 'rename', label: 'RENAME', emoji: 'pencil', style: discord_js_1.ButtonStyle.Secondary },
    { id: 'limit', label: 'LIMIT', emoji: 'member', style: discord_js_1.ButtonStyle.Secondary },
    { id: 'lock', label: 'LOCK', emoji: 'lock', style: discord_js_1.ButtonStyle.Secondary },
    { id: 'unlock', label: 'UNLOCK', emoji: 'unlock', style: discord_js_1.ButtonStyle.Secondary },
    { id: 'invite', label: 'INVITE', emoji: 'link', style: discord_js_1.ButtonStyle.Secondary },
    { id: 'delete', label: 'DELETE', emoji: 'trash', style: discord_js_1.ButtonStyle.Danger },
    { id: 'hide', label: 'HIDE', emoji: 'eye', style: discord_js_1.ButtonStyle.Secondary },
    { id: 'show', label: 'SHOW', emoji: 'eye', style: discord_js_1.ButtonStyle.Secondary },
    { id: 'claim', label: 'CLAIM', emoji: 'check', style: discord_js_1.ButtonStyle.Success },
    { id: 'kick', label: 'KICK', emoji: 'kick', style: discord_js_1.ButtonStyle.Danger },
];
function rowToConfig(row) {
    return {
        enabled: Boolean(row.enabled),
        createChannelId: row.create_channel_id ?? '',
        categoryId: row.category_id ?? '',
        panelChannelId: row.panel_channel_id ?? '',
        panelMessageId: row.panel_message_id ?? '',
    };
}
function rowToInstance(row) {
    return {
        channelId: row.channel_id,
        ownerId: row.owner_id,
        categoryId: row.category_id,
        guildId: row.guild_id ?? GLOBAL_GUILD,
        createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
    };
}
class TempVCService {
    constructor(logger) {
        this.db = null;
        this.client = null;
        this.configs = new Map();
        this.instances = new Map();
        /** Channels currently being deleted — guards against double-delete races. */
        this.deleting = new Set();
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
        this.configs.clear();
        const configRows = await this.db.select().from(schema_1.tempvcConfigs);
        for (const row of configRows) {
            this.configs.set(row.guild_id || GLOBAL_GUILD, rowToConfig(row));
        }
        // Load existing temp VC instances and prune ones whose channel is gone.
        this.instances.clear();
        const instanceRows = await this.db.select().from(schema_1.tempvcInstances);
        let pruned = 0;
        for (const row of instanceRows) {
            const instance = rowToInstance(row);
            const channel = this.client ? await this.client.channels.fetch(instance.channelId).catch(() => null) : null;
            if (this.client && !channel) {
                await this.db.delete(schema_1.tempvcInstances).where((0, drizzle_orm_1.eq)(schema_1.tempvcInstances.channel_id, instance.channelId));
                pruned += 1;
                continue;
            }
            this.instances.set(instance.channelId, instance);
        }
        this.logger.info('TempVC Service', `Temp VC system initialized with ${this.instances.size} active instance(s)${pruned ? ` (pruned ${pruned} stale)` : ''}`);
    }
    /**
     * Config resolution: the guild-specific row wins; otherwise the legacy
     * 'global' row is used. Pass no argument (dashboard) to get the global row.
     */
    getConfig(guildId) {
        if (guildId) {
            return this.configs.get(guildId) ?? this.configs.get(GLOBAL_GUILD) ?? null;
        }
        return this.configs.get(GLOBAL_GUILD)
            ?? Array.from(this.configs.values())[0]
            ?? null;
    }
    /** Dashboard setter — applies to the legacy global row for backwards compatibility. */
    setConfig(config) {
        this.configs.set(GLOBAL_GUILD, config);
        if (this.db) {
            void this.persistConfig(GLOBAL_GUILD, config).catch((error) => {
                this.logger.warn('TempVC Service', `Could not persist tempvc config: ${error.message}`);
            });
        }
    }
    getGuildConfig(guildId) {
        return this.getConfig(guildId);
    }
    async persistConfig(guildId, config) {
        if (!this.db)
            return;
        const now = Math.floor(Date.now() / 1000);
        await this.db.run((0, drizzle_orm_1.sql) `
      INSERT INTO tempvc_configs (id, guild_id, create_channel_id, category_id, panel_channel_id, panel_message_id, enabled, created_at)
      VALUES (${`tempvc_${guildId}`}, ${guildId}, ${config.createChannelId}, ${config.categoryId}, ${config.panelChannelId}, ${config.panelMessageId}, ${config.enabled ? 1 : 0}, ${now})
      ON CONFLICT(id) DO UPDATE SET
        create_channel_id = excluded.create_channel_id,
        category_id = excluded.category_id,
        panel_channel_id = excluded.panel_channel_id,
        panel_message_id = excluded.panel_message_id,
        enabled = excluded.enabled
    `);
    }
    async setup(createChannelId, categoryId, guildId) {
        if (!this.db)
            throw new Error('Database not connected');
        const target = guildId ?? GLOBAL_GUILD;
        const config = {
            enabled: true,
            createChannelId,
            categoryId,
            panelChannelId: this.configs.get(target)?.panelChannelId ?? '',
            panelMessageId: this.configs.get(target)?.panelMessageId ?? '',
        };
        await this.persistConfig(target, config);
        this.configs.set(target, config);
        this.logger.info('TempVC Service', `Temp VC setup (${target}): createChannel=${createChannelId}, category=${categoryId}`);
    }
    async setPanel(channelId, messageId, guildId) {
        if (!this.db)
            return;
        const target = guildId ?? GLOBAL_GUILD;
        const config = this.getConfig(target) ?? {
            enabled: true,
            createChannelId: '',
            categoryId: '',
            panelChannelId: '',
            panelMessageId: '',
        };
        config.panelChannelId = channelId;
        config.panelMessageId = messageId;
        this.configs.set(target, config);
        await this.persistConfig(target, config);
    }
    async createTempVC(member) {
        const guildId = member.guild.id;
        const config = this.getConfig(guildId);
        if (!config || !config.enabled || !this.client)
            return null;
        const category = member.guild.channels.cache.get(config.categoryId)
            ?? await member.guild.channels.fetch(config.categoryId).catch(() => null);
        if (!category || category.type !== discord_js_1.ChannelType.GuildCategory)
            return null;
        try {
            const vc = await member.guild.channels.create({
                name: `${member.user.username}'s VC`,
                type: discord_js_1.ChannelType.GuildVoice,
                parent: category.id,
                reason: 'Join-to-create temp VC',
                permissionOverwrites: [
                    {
                        id: member.id,
                        allow: [
                            discord_js_1.PermissionFlagsBits.ViewChannel,
                            discord_js_1.PermissionFlagsBits.Connect,
                            discord_js_1.PermissionFlagsBits.Speak,
                            discord_js_1.PermissionFlagsBits.Stream,
                            discord_js_1.PermissionFlagsBits.ManageChannels,
                        ],
                    },
                    {
                        id: member.guild.id,
                        allow: [discord_js_1.PermissionFlagsBits.ViewChannel, discord_js_1.PermissionFlagsBits.Connect, discord_js_1.PermissionFlagsBits.Speak, discord_js_1.PermissionFlagsBits.Stream],
                    },
                ],
            });
            await member.voice.setChannel(vc);
            const instance = {
                channelId: vc.id,
                ownerId: member.id,
                categoryId: config.categoryId,
                guildId,
                createdAt: Date.now(),
            };
            await this.db?.insert(schema_1.tempvcInstances).values({
                id: (0, id_1.shortId)('vc'),
                guild_id: guildId,
                channel_id: vc.id,
                owner_id: member.id,
                category_id: config.categoryId,
                created_at: new Date(),
            });
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
        if (this.deleting.has(channelId))
            return;
        this.deleting.add(channelId);
        try {
            const channel = await this.client.channels.fetch(channelId).catch(() => null);
            if (channel) {
                await channel.delete('Temp VC cleanup').catch(() => undefined);
            }
            await this.db?.delete(schema_1.tempvcInstances).where((0, drizzle_orm_1.eq)(schema_1.tempvcInstances.channel_id, channelId));
            this.instances.delete(channelId);
        }
        finally {
            this.deleting.delete(channelId);
        }
    }
    isTempVC(channelId) {
        return this.instances.has(channelId);
    }
    getTempVC(channelId) {
        return this.instances.get(channelId);
    }
    getPanelButtons() {
        return (0, panel_1.panelButtonRows)(PANEL_BUTTONS.map((button) => ({ ...button, id: `${PANEL_PREFIX}${button.id}` })), 5);
    }
    /**
     * Builds the big temp VC control panel: intro, a bullet per control,
     * banner artwork and the control buttons.
     */
    async buildPanel(cfg, guild) {
        const createMention = cfg.createChannelId ? `<#${cfg.createChannelId}>` : '`Create VC`';
        const categoryMention = cfg.categoryId ? `<#${cfg.categoryId}>` : 'a category';
        const features = [
            { emoji: 'voice', label: 'Create', value: `Join ${createMention} and a room opens for you` },
            { emoji: 'pencil', label: 'Rename', value: 'Give your room any name you like' },
            { emoji: 'member', label: 'Limit', value: 'Set how many people can join' },
            { emoji: 'lock', label: 'Lock / Unlock', value: 'Control who can join your room' },
            { emoji: 'eye', label: 'Hide / Show', value: 'Control who can see your room' },
            { emoji: 'link', label: 'Invite', value: 'Bring someone into your room' },
            { emoji: 'check', label: 'Claim', value: 'Take over an abandoned room' },
            { emoji: 'kick', label: 'Kick', value: 'Remove a member from your room' },
            { emoji: 'trash', label: 'Delete', value: 'Remove the room for good' },
        ];
        return (0, panel_1.buildPanelPayload)({
            emoji: 'tempvc',
            title: 'Temporary Voice',
            guildName: guild?.name,
            guildIconUrl: guild?.iconURL({ extension: 'png', size: 256 }) ?? undefined,
            color: 0xef4444,
            intro: `Join ${createMention} and a private room opens for you instantly in ${categoryMention}. Use the buttons below while you are inside your room.`,
            features,
            note: 'Only the room owner (or whoever claims an abandoned room) can manage it.',
            banner: {
                title: 'Temporary Voice',
                subtitle: guild?.name,
                emoji: '🔊',
                accent: '#ef4444',
                accentSecondary: '#f97316',
            },
            buttons: PANEL_BUTTONS.map((button) => ({ ...button, id: `${PANEL_PREFIX}${button.id}` })),
            footer: `${guild?.name ?? 'Sukuna Bot'} • Temporary Voice`,
        });
    }
    async resolveMember(interaction) {
        const member = interaction.member;
        if (member && 'voice' in member)
            return member;
        if (!interaction.guildId || !interaction.user?.id)
            return null;
        const guild = interaction.guild ?? this.client?.guilds.cache.get(interaction.guildId);
        return guild ? guild.members.fetch(interaction.user.id).catch(() => null) : null;
    }
    async handlePanelButton(interaction) {
        const customId = interaction.customId;
        if (!customId.startsWith(PANEL_PREFIX))
            return false;
        const action = customId.slice(PANEL_PREFIX.length);
        const member = await this.resolveMember(interaction);
        if (!member) {
            await interaction.reply({ content: 'Could not resolve your membership in this server.', ephemeral: true }).catch(() => undefined);
            return true;
        }
        const vcChannelId = member.voice?.channel?.id;
        if (!vcChannelId) {
            await interaction.reply({ content: 'You must be in a voice channel to use these controls.', ephemeral: true }).catch(() => undefined);
            return true;
        }
        const temp = this.getTempVC(vcChannelId);
        if (!temp) {
            await interaction.reply({ content: 'This is not a temporary voice channel.', ephemeral: true }).catch(() => undefined);
            return true;
        }
        const isOwner = temp.ownerId === member.id;
        const guild = member.guild;
        switch (action) {
            case 'rename':
                if (!isOwner) {
                    await interaction.reply({ content: 'Only the VC owner can rename it.', ephemeral: true }).catch(() => undefined);
                    return true;
                }
                await interaction.reply({ content: 'Use `/tempvc name <name>` to rename your VC.', ephemeral: true }).catch(() => undefined);
                return true;
            case 'limit':
                if (!isOwner) {
                    await interaction.reply({ content: 'Only the VC owner can set the limit.', ephemeral: true }).catch(() => undefined);
                    return true;
                }
                await interaction.reply({ content: 'Use `/tempvc limit <number>` to set the user limit.', ephemeral: true }).catch(() => undefined);
                return true;
            case 'lock':
                if (!isOwner) {
                    await interaction.reply({ content: 'Only the VC owner can lock it.', ephemeral: true }).catch(() => undefined);
                    return true;
                }
                try {
                    await member.voice.channel?.permissionOverwrites.edit(guild.id, { Connect: false });
                    await interaction.reply({ content: '🔒 VC locked.', ephemeral: true });
                }
                catch (err) {
                    await interaction.reply({ content: `Failed to lock: ${err instanceof Error ? err.message : String(err)}`, ephemeral: true });
                }
                return true;
            case 'unlock':
                if (!isOwner) {
                    await interaction.reply({ content: 'Only the VC owner can unlock it.', ephemeral: true }).catch(() => undefined);
                    return true;
                }
                try {
                    await member.voice.channel?.permissionOverwrites.edit(guild.id, { Connect: null });
                    await interaction.reply({ content: '🔓 VC unlocked.', ephemeral: true });
                }
                catch (err) {
                    await interaction.reply({ content: `Failed to unlock: ${err instanceof Error ? err.message : String(err)}`, ephemeral: true });
                }
                return true;
            case 'invite':
                if (!isOwner) {
                    await interaction.reply({ content: 'Only the VC owner can invite.', ephemeral: true }).catch(() => undefined);
                    return true;
                }
                await interaction.reply({ content: `Invite someone: <#${vcChannelId}>`, ephemeral: true }).catch(() => undefined);
                return true;
            case 'delete':
                if (!isOwner) {
                    await interaction.reply({ content: 'Only the VC owner can delete it.', ephemeral: true }).catch(() => undefined);
                    return true;
                }
                try {
                    await this.deleteTempVC(vcChannelId);
                    await interaction.reply({ content: '🗑️ VC deleted.', ephemeral: true });
                }
                catch (err) {
                    await interaction.reply({ content: `Failed to delete: ${err instanceof Error ? err.message : String(err)}`, ephemeral: true });
                }
                return true;
            case 'hide':
                if (!isOwner) {
                    await interaction.reply({ content: 'Only the VC owner can hide it.', ephemeral: true }).catch(() => undefined);
                    return true;
                }
                try {
                    await member.voice.channel?.permissionOverwrites.edit(guild.id, { ViewChannel: false });
                    await interaction.reply({ content: '👁️‍🗨️ VC hidden.', ephemeral: true });
                }
                catch (err) {
                    await interaction.reply({ content: `Failed to hide: ${err instanceof Error ? err.message : String(err)}`, ephemeral: true });
                }
                return true;
            case 'show':
                if (!isOwner) {
                    await interaction.reply({ content: 'Only the VC owner can show it.', ephemeral: true }).catch(() => undefined);
                    return true;
                }
                try {
                    await member.voice.channel?.permissionOverwrites.edit(guild.id, { ViewChannel: null });
                    await interaction.reply({ content: '👁️ VC shown.', ephemeral: true });
                }
                catch (err) {
                    await interaction.reply({ content: `Failed to show: ${err instanceof Error ? err.message : String(err)}`, ephemeral: true });
                }
                return true;
            case 'claim': {
                if (isOwner) {
                    await interaction.reply({ content: 'You already own this VC.', ephemeral: true }).catch(() => undefined);
                    return true;
                }
                // The owner must be genuinely gone (left the room) — not just offline in cache.
                const ownerVoice = guild.members.cache.get(temp.ownerId)?.voice.channelId
                    ?? (await guild.members.fetch(temp.ownerId).catch(() => null))?.voice.channelId;
                if (ownerVoice === vcChannelId) {
                    await interaction.reply({ content: 'This VC already has an owner in the channel.', ephemeral: true }).catch(() => undefined);
                    return true;
                }
                const channel = member.voice.channel;
                await this.transferOwnership(temp, member.id, channel);
                await interaction.reply({ content: '📥 VC claimed. You are now the owner.', ephemeral: true }).catch(() => undefined);
                return true;
            }
            case 'kick':
                if (!isOwner) {
                    await interaction.reply({ content: 'Only the VC owner can kick members.', ephemeral: true }).catch(() => undefined);
                    return true;
                }
                await interaction.reply({ content: 'Use `/tempvc kick <member>` to kick from your VC.', ephemeral: true }).catch(() => undefined);
                return true;
            default:
                return false;
        }
    }
    async transferOwnership(temp, newOwnerId, channel) {
        const oldOwnerId = temp.ownerId;
        temp.ownerId = newOwnerId;
        this.instances.set(temp.channelId, temp);
        if (this.db) {
            await this.db.update(schema_1.tempvcInstances)
                .set({ owner_id: newOwnerId })
                .where((0, drizzle_orm_1.eq)(schema_1.tempvcInstances.channel_id, temp.channelId));
        }
        if (channel) {
            try {
                await channel.permissionOverwrites.edit(newOwnerId, {
                    ViewChannel: true,
                    Connect: true,
                    Speak: true,
                    Stream: true,
                    ManageChannels: true,
                });
                // Remove manage rights from the previous owner.
                if (oldOwnerId && oldOwnerId !== newOwnerId) {
                    await channel.permissionOverwrites.edit(oldOwnerId, { ManageChannels: null });
                }
            }
            catch (error) {
                this.logger.warn('TempVC Service', `Could not transfer overwrites: ${error.message}`);
            }
        }
        this.logger.info('TempVC Service', `Temp VC ${temp.channelId} ownership transferred ${oldOwnerId} → ${newOwnerId}`);
    }
    async handleVoiceStateUpdate(oldChannelId, newChannelId, member) {
        const guildId = member.guild.id;
        const config = this.getConfig(guildId);
        if (!config || !config.enabled)
            return false;
        // If they joined the create channel, spawn a temp VC
        if (newChannelId === config.createChannelId && oldChannelId !== newChannelId && !member.user.bot) {
            // Serialize create per guild+user to avoid duplicate rooms on rapid joins.
            const existing = Array.from(this.instances.values()).find((i) => i.guildId === guildId && i.ownerId === member.id);
            if (existing) {
                const channel = await this.client?.channels.fetch(existing.channelId).catch(() => null);
                if (channel)
                    return false;
                // Stale row — clean it and continue to create.
                await this.deleteTempVC(existing.channelId);
            }
            return (await this.createTempVC(member)) !== null;
        }
        // If they left a temp VC and it's now empty, delete it
        if (oldChannelId && oldChannelId !== newChannelId) {
            const temp = this.getTempVC(oldChannelId);
            if (temp) {
                const channel = this.client ? await this.client.channels.fetch(oldChannelId).catch(() => null) : null;
                if (channel && channel.members.size === 0) {
                    await this.deleteTempVC(oldChannelId);
                    return true;
                }
            }
        }
        return false;
    }
    async postPanel(channel, guildId) {
        const target = guildId ?? GLOBAL_GUILD;
        const config = this.getConfig(target);
        if (!config)
            return null;
        const guild = guildId ? this.client?.guilds.cache.get(guildId) : null;
        const panel = await this.buildPanel(config, guild);
        let message = null;
        try {
            message = await channel.send({ embeds: [panel.embed], components: panel.components, files: panel.files });
            await this.setPanel(channel.id, message.id, target);
            return message;
        }
        catch (err) {
            this.logger.error('TempVC Service', 'Failed to post panel', err);
            return null;
        }
    }
    async shutdown() {
        this.instances.clear();
        this.configs.clear();
        this.deleting.clear();
        this.logger.info('TempVC Service', 'Temp VC system shutdown');
    }
}
exports.TempVCService = TempVCService;
