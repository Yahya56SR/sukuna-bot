"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TempVCCommands = void 0;
const discord_js_1 = require("discord.js");
class TempVCCommands {
    constructor(service) {
        this.setupCommand = {
            data: new discord_js_1.SlashCommandBuilder()
                .setName('tempvc')
                .setDescription('Manage join-to-create temporary voice channels')
                .setDefaultMemberPermissions(0n)
                .addSubcommand((sub) => sub
                .setName('setup')
                .setDescription('Set the join-to-create channel and category')
                .addChannelOption((o) => o
                .setName('channel')
                .setDescription('Voice channel members join to create a temp VC')
                .addChannelTypes(discord_js_1.ChannelType.GuildVoice)
                .setRequired(true))
                .addChannelOption((o) => o
                .setName('category')
                .setDescription('Category where temp VCs are created')
                .addChannelTypes(discord_js_1.ChannelType.GuildCategory)
                .setRequired(true)))
                .addSubcommand((sub) => sub
                .setName('panel')
                .setDescription('Post the temp VC control panel in a channel')
                .addChannelOption((o) => o
                .setName('channel')
                .setDescription('Channel to post the control panel in')
                .addChannelTypes(discord_js_1.ChannelType.GuildText)
                .setRequired(true)))
                .addSubcommand((sub) => sub.setName('limit').setDescription('Set your temp VC user limit')
                .addIntegerOption((o) => o.setName('limit').setDescription('User limit (0 = unlimited)').setRequired(true).setMinValue(0).setMaxValue(99)))
                .addSubcommand((sub) => sub.setName('name').setDescription('Set your temp VC name')
                .addStringOption((o) => o.setName('name').setDescription('New channel name').setRequired(true).setMaxLength(100)))
                .addSubcommand((sub) => sub.setName('kick').setDescription('Kick a member from your temp VC')
                .addUserOption((o) => o.setName('member').setDescription('Member to kick').setRequired(true)))
                .addSubcommand((sub) => sub.setName('config').setDescription('View temp VC config')),
            execute: async (interaction) => {
                if (!interaction.guild) {
                    await interaction.reply({ content: 'This command can only be used in a server.', flags: discord_js_1.MessageFlags.Ephemeral });
                    return;
                }
                const sub = interaction.options.getSubcommand();
                switch (sub) {
                    case 'setup': return this.setup(interaction);
                    case 'panel': return this.panel(interaction);
                    case 'limit': return this.setLimit(interaction);
                    case 'name': return this.setName(interaction);
                    case 'kick': return this.kick(interaction);
                    case 'config': return this.config(interaction);
                    default: return;
                }
            },
        };
        this.service = service;
    }
    getCommands() {
        return [this.setupCommand];
    }
    async setup(interaction) {
        const channel = interaction.options.getChannel('channel', true);
        const category = interaction.options.getChannel('category', true);
        await this.service.setup(channel.id, category.id, interaction.guildId ?? undefined);
        await interaction.reply({
            content: `✅ Temp VC setup: join <#${channel.id}> to create a channel in <#${category.id}>.`,
            flags: discord_js_1.MessageFlags.Ephemeral,
        });
    }
    async panel(interaction) {
        const channel = interaction.options.getChannel('channel', true);
        const cfg = this.service.getConfig(interaction.guildId ?? undefined);
        if (!cfg || !cfg.createChannelId || !cfg.categoryId) {
            await interaction.reply({ content: 'Set up temp VC first with `/tempvc setup`.', flags: discord_js_1.MessageFlags.Ephemeral });
            return;
        }
        const embed = new discord_js_1.EmbedBuilder()
            .setColor(0xef4444)
            .setTitle('🔊 Temporary Voice — Sukuna')
            .setDescription(`Join <#${cfg.createChannelId}> and a private room opens for you instantly.\n\n` +
            'Use the buttons below while you are inside your room to rename it, set a limit, lock/hide it, or delete it. Only the room owner (or whoever claims an abandoned room) can manage it.')
            .addFields({ name: '✨ How it works', value: `1. Join <#${cfg.createChannelId}>\n2. Your room appears in <#${cfg.categoryId}>\n3. Manage it with the buttons`, inline: true }, { name: '🎛️ Controls', value: 'Rename • Limit • Lock/Unlock\nHide/Show • Invite • Kick\nClaim • Delete', inline: true })
            .setFooter({ text: 'Sukuna Bot • TempVC' })
            .setTimestamp();
        const rows = this.service.getPanelButtons();
        const existingMessageId = cfg.panelMessageId;
        let message = null;
        if (existingMessageId) {
            try {
                message = await channel.messages.fetch(existingMessageId).catch(() => null);
            }
            catch {
                message = null;
            }
        }
        if (message) {
            await message.edit({ embeds: [embed], components: rows });
        }
        else {
            message = await channel.send({ embeds: [embed], components: rows });
        }
        await this.service.setPanel(channel.id, message.id, interaction.guildId ?? undefined);
        await interaction.reply({ content: `✅ Temp VC panel posted in ${channel}.`, flags: discord_js_1.MessageFlags.Ephemeral });
    }
    async config(interaction) {
        const cfg = this.service.getConfig(interaction.guildId ?? undefined);
        const embed = new discord_js_1.EmbedBuilder().setColor(0x5865f2).setTitle('🔊 Temporary Voice Config');
        if (!cfg || !cfg.createChannelId || !cfg.categoryId) {
            embed.setDescription('No temp VC configured. Use `/tempvc setup`.');
        }
        else {
            embed.setDescription(`Create channel: <#${cfg.createChannelId}>\n` +
                `Category: <#${cfg.categoryId}>\n` +
                `Panel channel: ${cfg.panelChannelId ? `<#${cfg.panelChannelId}>` : 'not set'}\n` +
                `Panel message: ${cfg.panelMessageId || 'not posted'}`);
        }
        await interaction.reply({ embeds: [embed], flags: discord_js_1.MessageFlags.Ephemeral });
    }
    async setLimit(interaction) {
        const member = interaction.member;
        const channelId = member.voice?.channel?.id;
        if (!channelId) {
            await interaction.reply({ content: 'You must be in a voice channel to set its limit.', flags: discord_js_1.MessageFlags.Ephemeral });
            return;
        }
        const temp = this.service.getTempVC(channelId);
        if (!temp || temp.ownerId !== interaction.user.id) {
            await interaction.reply({ content: 'You only can change limits on a temp VC you own.', flags: discord_js_1.MessageFlags.Ephemeral });
            return;
        }
        const limit = interaction.options.getInteger('limit', true);
        const channel = interaction.guild.channels.cache.get(channelId);
        if (!channel) {
            await interaction.reply({ content: 'Channel not found.', flags: discord_js_1.MessageFlags.Ephemeral });
            return;
        }
        try {
            await channel.edit({ userLimit: limit === 0 ? 0 : limit });
            await interaction.reply({ content: `✅ Temp VC user limit set to ${limit === 0 ? 'unlimited' : limit}.`, flags: discord_js_1.MessageFlags.Ephemeral });
        }
        catch (err) {
            await interaction.reply({ content: `Failed to set limit: ${err instanceof Error ? err.message : String(err)}`, flags: discord_js_1.MessageFlags.Ephemeral });
        }
    }
    async setName(interaction) {
        const member = interaction.member;
        const channelId = member.voice?.channel?.id;
        if (!channelId) {
            await interaction.reply({ content: 'You must be in a voice channel to rename it.', flags: discord_js_1.MessageFlags.Ephemeral });
            return;
        }
        const temp = this.service.getTempVC(channelId);
        if (!temp || temp.ownerId !== interaction.user.id) {
            await interaction.reply({ content: 'You only can rename a temp VC you own.', flags: discord_js_1.MessageFlags.Ephemeral });
            return;
        }
        const name = interaction.options.getString('name', true);
        const channel = interaction.guild.channels.cache.get(channelId);
        if (!channel || !('edit' in channel)) {
            await interaction.reply({ content: 'Channel not editable.', flags: discord_js_1.MessageFlags.Ephemeral });
            return;
        }
        try {
            await channel.edit({ name });
            await interaction.reply({ content: `✅ Temp VC renamed to **${name}**.`, flags: discord_js_1.MessageFlags.Ephemeral });
        }
        catch (err) {
            await interaction.reply({ content: `Failed to rename: ${err instanceof Error ? err.message : String(err)}`, flags: discord_js_1.MessageFlags.Ephemeral });
        }
    }
    async kick(interaction) {
        const member = interaction.member;
        const channelId = member.voice?.channel?.id;
        if (!channelId) {
            await interaction.reply({ content: 'You must be in a voice channel to kick someone.', flags: discord_js_1.MessageFlags.Ephemeral });
            return;
        }
        const temp = this.service.getTempVC(channelId);
        if (!temp || temp.ownerId !== interaction.user.id) {
            await interaction.reply({ content: 'You only can kick from a temp VC you own.', flags: discord_js_1.MessageFlags.Ephemeral });
            return;
        }
        const target = interaction.options.getMember('member');
        if (!target) {
            await interaction.reply({ content: 'Member not found.', flags: discord_js_1.MessageFlags.Ephemeral });
            return;
        }
        if (!target.voice.channel || target.voice.channel.id !== channelId) {
            await interaction.reply({ content: 'That member is not in your temp VC.', flags: discord_js_1.MessageFlags.Ephemeral });
            return;
        }
        try {
            await target.voice.setChannel(null);
            await interaction.reply({ content: `✅ Kicked ${target.user.username} from your temp VC.`, flags: discord_js_1.MessageFlags.Ephemeral });
        }
        catch (err) {
            await interaction.reply({ content: `Failed to kick: ${err instanceof Error ? err.message : String(err)}`, flags: discord_js_1.MessageFlags.Ephemeral });
        }
    }
}
exports.TempVCCommands = TempVCCommands;
