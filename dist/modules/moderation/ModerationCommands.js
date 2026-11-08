"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ModerationCommands = void 0;
const discord_js_1 = require("discord.js");
class ModerationCommands {
    constructor(service, logger) {
        this.warnCommand = {
            data: new discord_js_1.SlashCommandBuilder()
                .setName('warn')
                .setDescription('Warn a user')
                .addUserOption(option => option.setName('user').setDescription('User to warn').setRequired(true))
                .addStringOption(option => option.setName('reason').setDescription('Reason for warning').setRequired(true)),
            execute: async (interaction) => {
                if (!interaction.guild || !interaction.guild.members) {
                    await interaction.reply({ content: 'This command can only be used in a server.', flags: discord_js_1.MessageFlags.Ephemeral });
                    return;
                }
                const user = interaction.options.getUser('user', true);
                const reason = interaction.options.getString('reason', true);
                const member = interaction.guild.members.cache.get(user.id);
                if (!member) {
                    await interaction.reply({ content: 'User not found in this server.', flags: discord_js_1.MessageFlags.Ephemeral });
                    return;
                }
                try {
                    const caseId = await this.service.warn(interaction.guild.id, user.id, interaction.user.id, reason);
                    await interaction.reply({ content: `⚠️ Warned ${user.tag} (Case: ${caseId})\nReason: ${reason}`, flags: discord_js_1.MessageFlags.Ephemeral });
                }
                catch (error) {
                    this.logger.error('Moderation Commands', 'Failed to warn user', error);
                    await interaction.reply({ content: 'Failed to warn user.', flags: discord_js_1.MessageFlags.Ephemeral });
                }
            },
        };
        this.kickCommand = {
            data: new discord_js_1.SlashCommandBuilder()
                .setName('kick')
                .setDescription('Kick a user from the server')
                .addUserOption(option => option.setName('user').setDescription('User to kick').setRequired(true))
                .addStringOption(option => option.setName('reason').setDescription('Reason for kick')),
            execute: async (interaction) => {
                if (!interaction.guild || !interaction.guild.members) {
                    await interaction.reply({ content: 'This command can only be used in a server.', flags: discord_js_1.MessageFlags.Ephemeral });
                    return;
                }
                const user = interaction.options.getUser('user', true);
                const reason = interaction.options.getString('reason') || 'No reason provided';
                const member = interaction.guild.members.cache.get(user.id);
                if (!member) {
                    await interaction.reply({ content: 'User not found in this server.', flags: discord_js_1.MessageFlags.Ephemeral });
                    return;
                }
                if (!member.kickable) {
                    await interaction.reply({ content: 'Cannot kick this user.', flags: discord_js_1.MessageFlags.Ephemeral });
                    return;
                }
                try {
                    const caseId = await this.service.kick(interaction.guild.id, user.id, interaction.user.id, reason);
                    await interaction.reply({ content: `👢 Kicked ${user.tag} (Case: ${caseId})\nReason: ${reason}`, flags: discord_js_1.MessageFlags.Ephemeral });
                }
                catch (error) {
                    this.logger.error('Moderation Commands', 'Failed to kick user', error);
                    await interaction.reply({ content: 'Failed to kick user.', flags: discord_js_1.MessageFlags.Ephemeral });
                }
            },
        };
        this.banCommand = {
            data: new discord_js_1.SlashCommandBuilder()
                .setName('ban')
                .setDescription('Ban a user from the server')
                .addUserOption(option => option.setName('user').setDescription('User to ban').setRequired(true))
                .addStringOption(option => option.setName('reason').setDescription('Reason for ban')),
            execute: async (interaction) => {
                if (!interaction.guild) {
                    await interaction.reply({ content: 'This command can only be used in a server.', flags: discord_js_1.MessageFlags.Ephemeral });
                    return;
                }
                const user = interaction.options.getUser('user', true);
                const reason = interaction.options.getString('reason') || 'No reason provided';
                try {
                    const caseId = await this.service.ban(interaction.guild.id, user.id, interaction.user.id, reason);
                    await interaction.reply({ content: `🔨 Banned ${user.tag} (Case: ${caseId})\nReason: ${reason}`, flags: discord_js_1.MessageFlags.Ephemeral });
                }
                catch (error) {
                    this.logger.error('Moderation Commands', 'Failed to ban user', error);
                    await interaction.reply({ content: 'Failed to ban user.', flags: discord_js_1.MessageFlags.Ephemeral });
                }
            },
        };
        this.muteCommand = {
            data: new discord_js_1.SlashCommandBuilder()
                .setName('mute')
                .setDescription('Mute a user for a duration')
                .addUserOption(option => option.setName('user').setDescription('User to mute').setRequired(true))
                .addIntegerOption(option => option.setName('duration').setDescription('Duration in minutes').setRequired(true))
                .addStringOption(option => option.setName('reason').setDescription('Reason for mute')),
            execute: async (interaction) => {
                if (!interaction.guild || !interaction.guild.members) {
                    await interaction.reply({ content: 'This command can only be used in a server.', flags: discord_js_1.MessageFlags.Ephemeral });
                    return;
                }
                const user = interaction.options.getUser('user', true);
                const duration = interaction.options.getInteger('duration', true);
                const reason = interaction.options.getString('reason') || 'No reason provided';
                const member = interaction.guild.members.cache.get(user.id);
                if (!member) {
                    await interaction.reply({ content: 'User not found in this server.', flags: discord_js_1.MessageFlags.Ephemeral });
                    return;
                }
                if (!member.moderatable) {
                    await interaction.reply({ content: 'Cannot mute this user.', flags: discord_js_1.MessageFlags.Ephemeral });
                    return;
                }
                try {
                    const caseId = await this.service.mute(interaction.guild.id, user.id, interaction.user.id, reason, duration);
                    await interaction.reply({ content: `🔇 Muted ${user.tag} for ${duration} minutes (Case: ${caseId})\nReason: ${reason}`, flags: discord_js_1.MessageFlags.Ephemeral });
                }
                catch (error) {
                    this.logger.error('Moderation Commands', 'Failed to mute user', error);
                    await interaction.reply({ content: 'Failed to mute user.', flags: discord_js_1.MessageFlags.Ephemeral });
                }
            },
        };
        this.warningsCommand = {
            data: new discord_js_1.SlashCommandBuilder()
                .setName('warnings')
                .setDescription('View warnings for a user')
                .addUserOption(option => option.setName('user').setDescription('User to check').setRequired(true)),
            execute: async (interaction) => {
                if (!interaction.guild) {
                    await interaction.reply({ content: 'This command can only be used in a server.', flags: discord_js_1.MessageFlags.Ephemeral });
                    return;
                }
                const user = interaction.options.getUser('user', true);
                try {
                    const warnings = await this.service.getWarnings(interaction.guild.id, user.id);
                    const embed = new discord_js_1.EmbedBuilder()
                        .setColor('#ff9900')
                        .setTitle(`⚠️ Warnings for ${user.tag}`)
                        .setDescription(warnings.length === 0 ? 'No warnings found.' : warnings.map(w => `• ${w.reason} (${new Date(w.created_at).toLocaleDateString()})`).join('\n'))
                        .setTimestamp();
                    await interaction.reply({ embeds: [embed], flags: discord_js_1.MessageFlags.Ephemeral });
                }
                catch (error) {
                    this.logger.error('Moderation Commands', 'Failed to get warnings', error);
                    await interaction.reply({ content: 'Failed to get warnings.', flags: discord_js_1.MessageFlags.Ephemeral });
                }
            },
        };
        this.service = service;
        this.logger = logger;
    }
    getCommands() {
        return [this.warnCommand, this.kickCommand, this.banCommand, this.muteCommand, this.warningsCommand];
    }
}
exports.ModerationCommands = ModerationCommands;
