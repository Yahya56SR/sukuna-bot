"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ModerationCommands = void 0;
const discord_js_1 = require("discord.js");
const embed_1 = require("../../utils/embed");
function timestamp(value) {
    if (!value)
        return 'unknown';
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? 'unknown' : `<t:${Math.floor(date.getTime() / 1000)}:R>`;
}
class ModerationCommands {
    constructor(service, logger) {
        this.warnCommand = {
            data: new discord_js_1.SlashCommandBuilder()
                .setName('warn')
                .setDescription('Warn a user')
                .setDefaultMemberPermissions(discord_js_1.PermissionFlagsBits.ModerateMembers)
                .addUserOption((option) => option.setName('user').setDescription('User to warn').setRequired(true))
                .addStringOption((option) => option.setName('reason').setDescription('Reason for warning').setRequired(true)),
            execute: async (interaction) => {
                const guildId = this.requireGuild(interaction);
                if (!guildId)
                    return;
                const user = interaction.options.getUser('user', true);
                const reason = interaction.options.getString('reason', true);
                try {
                    const caseId = await this.service.warn(guildId, user.id, interaction.user.id, reason);
                    const active = await this.service.getWarnings(guildId, user.id);
                    await interaction.reply({
                        embeds: [
                            (0, embed_1.brandedEmbed)('#facc15')
                                .setTitle(`⚠️ Warned ${user.username}`)
                                .setDescription(`**Reason:** ${reason}\n**Active warnings:** ${active.length}\n**Case:** \`${caseId}\``),
                        ],
                        flags: discord_js_1.MessageFlags.Ephemeral,
                    });
                }
                catch (error) {
                    this.logger.error('Moderation Commands', 'Failed to warn user', error);
                    await this.fail(interaction, error);
                }
            },
        };
        this.warnRemoveCommand = {
            data: new discord_js_1.SlashCommandBuilder()
                .setName('warn-remove')
                .setDescription('Remove a warning by case id')
                .setDefaultMemberPermissions(discord_js_1.PermissionFlagsBits.ModerateMembers)
                .addStringOption((option) => option.setName('case_id').setDescription('Warning / case id').setRequired(true))
                .addStringOption((option) => option.setName('reason').setDescription('Why the warning is being removed')),
            execute: async (interaction) => {
                const guildId = this.requireGuild(interaction);
                if (!guildId)
                    return;
                const warningId = interaction.options.getString('case_id', true).trim();
                const reason = interaction.options.getString('reason') ?? undefined;
                try {
                    const removed = await this.service.removeWarning(guildId, warningId, interaction.user.id, reason);
                    if (!removed) {
                        await interaction.reply({ content: 'No active warning with that id was found.', flags: discord_js_1.MessageFlags.Ephemeral });
                        return;
                    }
                    await interaction.reply({ content: `✅ Removed warning \`${warningId}\`.`, flags: discord_js_1.MessageFlags.Ephemeral });
                }
                catch (error) {
                    this.logger.error('Moderation Commands', 'Failed to remove warning', error);
                    await this.fail(interaction, error);
                }
            },
        };
        this.warningsCommand = {
            data: new discord_js_1.SlashCommandBuilder()
                .setName('warnings')
                .setDescription('View warnings for a user')
                .setDefaultMemberPermissions(discord_js_1.PermissionFlagsBits.ModerateMembers)
                .addUserOption((option) => option.setName('user').setDescription('User to check').setRequired(true))
                .addBooleanOption((option) => option.setName('include_removed').setDescription('Include removed warnings')),
            execute: async (interaction) => {
                const guildId = this.requireGuild(interaction);
                if (!guildId)
                    return;
                const user = interaction.options.getUser('user', true);
                const includeRemoved = interaction.options.getBoolean('include_removed') ?? false;
                try {
                    const warnings = await this.service.getWarnings(guildId, user.id, includeRemoved);
                    const embed = new discord_js_1.EmbedBuilder()
                        .setColor(warnings.length ? '#facc15' : '#22c55e')
                        .setTitle(`⚠️ Warnings for ${user.username}`)
                        .setDescription(warnings.length === 0
                        ? 'No warnings found.'
                        : warnings
                            .slice(0, 20)
                            .map((w) => {
                            const state = w.active ? '' : ' *(removed)*';
                            const by = `<@${w.moderator_id}>`;
                            return `• \`${w.id}\` — ${w.reason}${state}\n  by ${by} ${timestamp(w.created_at)}`;
                        })
                            .join('\n'))
                        .setFooter({ text: `${(0, embed_1.formatNumber)(warnings.length)} warning(s)` })
                        .setTimestamp();
                    await interaction.reply({ embeds: [embed], flags: discord_js_1.MessageFlags.Ephemeral });
                }
                catch (error) {
                    this.logger.error('Moderation Commands', 'Failed to get warnings', error);
                    await this.fail(interaction, error);
                }
            },
        };
        this.warningsClearCommand = {
            data: new discord_js_1.SlashCommandBuilder()
                .setName('warnings-clear')
                .setDescription('Clear all active warnings for a user')
                .setDefaultMemberPermissions(discord_js_1.PermissionFlagsBits.ModerateMembers)
                .addUserOption((option) => option.setName('user').setDescription('User whose warnings to clear').setRequired(true)),
            execute: async (interaction) => {
                const guildId = this.requireGuild(interaction);
                if (!guildId)
                    return;
                const user = interaction.options.getUser('user', true);
                try {
                    const count = await this.service.clearWarnings(guildId, user.id, interaction.user.id);
                    await interaction.reply({ content: `✅ Cleared **${count}** warning(s) for ${user.username}.`, flags: discord_js_1.MessageFlags.Ephemeral });
                }
                catch (error) {
                    this.logger.error('Moderation Commands', 'Failed to clear warnings', error);
                    await this.fail(interaction, error);
                }
            },
        };
        this.kickCommand = {
            data: new discord_js_1.SlashCommandBuilder()
                .setName('kick')
                .setDescription('Kick a user from the server')
                .setDefaultMemberPermissions(discord_js_1.PermissionFlagsBits.KickMembers)
                .addUserOption((option) => option.setName('user').setDescription('User to kick').setRequired(true))
                .addStringOption((option) => option.setName('reason').setDescription('Reason for kick')),
            execute: async (interaction) => {
                const guildId = this.requireGuild(interaction);
                if (!guildId)
                    return;
                const user = interaction.options.getUser('user', true);
                const reason = interaction.options.getString('reason') ?? 'No reason provided';
                try {
                    const caseId = await this.service.kick(guildId, user.id, interaction.user.id, reason);
                    await interaction.reply({ content: `👢 Kicked ${user.tag} (Case: \`${caseId}\`)\nReason: ${reason}`, flags: discord_js_1.MessageFlags.Ephemeral });
                }
                catch (error) {
                    this.logger.error('Moderation Commands', 'Failed to kick user', error);
                    await this.fail(interaction, error);
                }
            },
        };
        this.banCommand = {
            data: new discord_js_1.SlashCommandBuilder()
                .setName('ban')
                .setDescription('Ban a user from the server')
                .setDefaultMemberPermissions(discord_js_1.PermissionFlagsBits.BanMembers)
                .addUserOption((option) => option.setName('user').setDescription('User to ban').setRequired(true))
                .addStringOption((option) => option.setName('reason').setDescription('Reason for ban'))
                .addIntegerOption((option) => option.setName('delete_days').setDescription('Delete this many days of messages (0-7)').setMinValue(0).setMaxValue(7)),
            execute: async (interaction) => {
                const guildId = this.requireGuild(interaction);
                if (!guildId)
                    return;
                const user = interaction.options.getUser('user', true);
                const reason = interaction.options.getString('reason') ?? 'No reason provided';
                const days = interaction.options.getInteger('delete_days') ?? 0;
                try {
                    const caseId = await this.service.ban(guildId, user.id, interaction.user.id, reason, days);
                    await interaction.reply({ content: `🔨 Banned ${user.tag} (Case: \`${caseId}\`)\nReason: ${reason}`, flags: discord_js_1.MessageFlags.Ephemeral });
                }
                catch (error) {
                    this.logger.error('Moderation Commands', 'Failed to ban user', error);
                    await this.fail(interaction, error);
                }
            },
        };
        this.unbanCommand = {
            data: new discord_js_1.SlashCommandBuilder()
                .setName('unban')
                .setDescription('Unban a user from the server')
                .setDefaultMemberPermissions(discord_js_1.PermissionFlagsBits.BanMembers)
                .addStringOption((option) => option.setName('user_id').setDescription('User id to unban').setRequired(true))
                .addStringOption((option) => option.setName('reason').setDescription('Reason for unban')),
            execute: async (interaction) => {
                const guildId = this.requireGuild(interaction);
                if (!guildId)
                    return;
                const userId = interaction.options.getString('user_id', true).trim();
                const reason = interaction.options.getString('reason') ?? undefined;
                try {
                    const caseId = await this.service.unban(guildId, userId, interaction.user.id, reason);
                    await interaction.reply({ content: `✅ Unbanned <@${userId}> (Case: \`${caseId}\`)`, flags: discord_js_1.MessageFlags.Ephemeral });
                }
                catch (error) {
                    this.logger.error('Moderation Commands', 'Failed to unban user', error);
                    await this.fail(interaction, error);
                }
            },
        };
        this.muteCommand = {
            data: new discord_js_1.SlashCommandBuilder()
                .setName('mute')
                .setDescription('Timeout a user for a duration')
                .setDefaultMemberPermissions(discord_js_1.PermissionFlagsBits.ModerateMembers)
                .addUserOption((option) => option.setName('user').setDescription('User to mute').setRequired(true))
                .addIntegerOption((option) => option.setName('duration').setDescription('Duration in minutes (1-40320)').setRequired(true).setMinValue(1).setMaxValue(40320))
                .addStringOption((option) => option.setName('reason').setDescription('Reason for mute')),
            execute: async (interaction) => {
                const guildId = this.requireGuild(interaction);
                if (!guildId)
                    return;
                const user = interaction.options.getUser('user', true);
                const duration = interaction.options.getInteger('duration', true);
                const reason = interaction.options.getString('reason') ?? 'No reason provided';
                try {
                    const caseId = await this.service.mute(guildId, user.id, interaction.user.id, reason, duration);
                    await interaction.reply({
                        content: `🔇 Muted ${user.tag} for ${duration} minutes (Case: \`${caseId}\`)\nReason: ${reason}`,
                        flags: discord_js_1.MessageFlags.Ephemeral,
                    });
                }
                catch (error) {
                    this.logger.error('Moderation Commands', 'Failed to mute user', error);
                    await this.fail(interaction, error);
                }
            },
        };
        this.unmuteCommand = {
            data: new discord_js_1.SlashCommandBuilder()
                .setName('unmute')
                .setDescription('Remove a timeout from a user')
                .setDefaultMemberPermissions(discord_js_1.PermissionFlagsBits.ModerateMembers)
                .addUserOption((option) => option.setName('user').setDescription('User to unmute').setRequired(true))
                .addStringOption((option) => option.setName('reason').setDescription('Reason for unmute')),
            execute: async (interaction) => {
                const guildId = this.requireGuild(interaction);
                if (!guildId)
                    return;
                const user = interaction.options.getUser('user', true);
                const reason = interaction.options.getString('reason') ?? undefined;
                try {
                    const caseId = await this.service.unmute(guildId, user.id, interaction.user.id, reason);
                    await interaction.reply({ content: `🔊 Unmuted ${user.tag} (Case: \`${caseId}\`)`, flags: discord_js_1.MessageFlags.Ephemeral });
                }
                catch (error) {
                    this.logger.error('Moderation Commands', 'Failed to unmute user', error);
                    await this.fail(interaction, error);
                }
            },
        };
        this.casesCommand = {
            data: new discord_js_1.SlashCommandBuilder()
                .setName('cases')
                .setDescription('View recent moderation cases')
                .setDefaultMemberPermissions(discord_js_1.PermissionFlagsBits.ModerateMembers)
                .addUserOption((option) => option.setName('user').setDescription('Filter by user'))
                .addIntegerOption((option) => option.setName('page').setDescription('Page number').setMinValue(1)),
            execute: async (interaction) => {
                const guildId = this.requireGuild(interaction);
                if (!guildId)
                    return;
                const user = interaction.options.getUser('user');
                const page = Math.max(1, interaction.options.getInteger('page') ?? 1);
                const pageSize = 10;
                try {
                    const cases = await this.service.getCases(guildId, user?.id, pageSize, (page - 1) * pageSize);
                    const embed = new discord_js_1.EmbedBuilder()
                        .setColor('#5865f2')
                        .setTitle(user ? `Moderation cases — ${user.username}` : 'Recent moderation cases')
                        .setDescription(cases.length === 0
                        ? 'No cases found.'
                        : cases
                            .map((c) => `• \`${c.id}\` **${c.type}** <@${c.user_id}> by <@${c.moderator_id}>\n  ${c.reason ?? 'No reason'} ${timestamp(c.created_at)}`)
                            .join('\n'))
                        .setFooter({ text: `Page ${page}` })
                        .setTimestamp();
                    await interaction.reply({ embeds: [embed], flags: discord_js_1.MessageFlags.Ephemeral });
                }
                catch (error) {
                    this.logger.error('Moderation Commands', 'Failed to fetch cases', error);
                    await this.fail(interaction, error);
                }
            },
        };
        this.service = service;
        this.logger = logger;
    }
    getCommands() {
        return [
            this.warnCommand,
            this.warnRemoveCommand,
            this.warningsCommand,
            this.warningsClearCommand,
            this.kickCommand,
            this.banCommand,
            this.unbanCommand,
            this.muteCommand,
            this.unmuteCommand,
            this.casesCommand,
        ];
    }
    async fail(interaction, error) {
        const message = error instanceof Error ? error.message : 'Something went wrong.';
        const payload = { content: `❌ ${message}`, flags: discord_js_1.MessageFlags.Ephemeral };
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp(payload).catch(() => undefined);
        }
        else {
            await interaction.reply(payload).catch(() => undefined);
        }
    }
    requireGuild(interaction) {
        if (!interaction.guild) {
            void interaction.reply({ content: 'This command can only be used in a server.', flags: discord_js_1.MessageFlags.Ephemeral });
            return null;
        }
        return interaction.guild.id;
    }
}
exports.ModerationCommands = ModerationCommands;
