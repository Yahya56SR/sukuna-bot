import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  MessageFlags,
  EmbedBuilder,
  PermissionFlagsBits,
} from 'discord.js';
import { ModerationService } from './ModerationService';
import { Logger } from '../../infrastructure/Logger';
import { brandedEmbed, formatNumber } from '../../utils/embed';

export interface ModerationCommand {
  data: SlashCommandBuilder;
  execute(interaction: ChatInputCommandInteraction, service: ModerationService): Promise<void>;
}

function timestamp(value: Date | string | number | null | undefined): string {
  if (!value) return 'unknown';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? 'unknown' : `<t:${Math.floor(date.getTime() / 1000)}:R>`;
}

export class ModerationCommands {
  private service: ModerationService;
  private logger: Logger;

  constructor(service: ModerationService, logger: Logger) {
    this.service = service;
    this.logger = logger;
  }

  public getCommands(): ModerationCommand[] {
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

  private async fail(interaction: ChatInputCommandInteraction, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : 'Something went wrong.';
    const payload = { content: `❌ ${message}`, flags: MessageFlags.Ephemeral } as const;
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload).catch(() => undefined);
    } else {
      await interaction.reply(payload).catch(() => undefined);
    }
  }

  private requireGuild(interaction: ChatInputCommandInteraction): string | null {
    if (!interaction.guild) {
      void interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
      return null;
    }
    return interaction.guild.id;
  }

  private warnCommand: ModerationCommand = {
    data: new SlashCommandBuilder()
      .setName('warn')
      .setDescription('Warn a user')
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .addUserOption((option) => option.setName('user').setDescription('User to warn').setRequired(true))
      .addStringOption((option) => option.setName('reason').setDescription('Reason for warning').setRequired(true)) as SlashCommandBuilder,
    execute: async (interaction) => {
      const guildId = this.requireGuild(interaction);
      if (!guildId) return;
      const user = interaction.options.getUser('user', true);
      const reason = interaction.options.getString('reason', true);
      try {
        const caseId = await this.service.warn(guildId, user.id, interaction.user.id, reason);
        const active = await this.service.getWarnings(guildId, user.id);
        await interaction.reply({
          embeds: [
            brandedEmbed('#facc15')
              .setTitle(`⚠️ Warned ${user.username}`)
              .setDescription(`**Reason:** ${reason}\n**Active warnings:** ${active.length}\n**Case:** \`${caseId}\``),
          ],
          flags: MessageFlags.Ephemeral,
        });
      } catch (error) {
        this.logger.error('Moderation Commands', 'Failed to warn user', error as Error);
        await this.fail(interaction, error);
      }
    },
  };

  private warnRemoveCommand: ModerationCommand = {
    data: new SlashCommandBuilder()
      .setName('warn-remove')
      .setDescription('Remove a warning by case id')
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .addStringOption((option) => option.setName('case_id').setDescription('Warning / case id').setRequired(true))
      .addStringOption((option) => option.setName('reason').setDescription('Why the warning is being removed')) as SlashCommandBuilder,
    execute: async (interaction) => {
      const guildId = this.requireGuild(interaction);
      if (!guildId) return;
      const warningId = interaction.options.getString('case_id', true).trim();
      const reason = interaction.options.getString('reason') ?? undefined;
      try {
        const removed = await this.service.removeWarning(guildId, warningId, interaction.user.id, reason);
        if (!removed) {
          await interaction.reply({ content: 'No active warning with that id was found.', flags: MessageFlags.Ephemeral });
          return;
        }
        await interaction.reply({ content: `✅ Removed warning \`${warningId}\`.`, flags: MessageFlags.Ephemeral });
      } catch (error) {
        this.logger.error('Moderation Commands', 'Failed to remove warning', error as Error);
        await this.fail(interaction, error);
      }
    },
  };

  private warningsCommand: ModerationCommand = {
    data: new SlashCommandBuilder()
      .setName('warnings')
      .setDescription('View warnings for a user')
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .addUserOption((option) => option.setName('user').setDescription('User to check').setRequired(true))
      .addBooleanOption((option) => option.setName('include_removed').setDescription('Include removed warnings')) as SlashCommandBuilder,
    execute: async (interaction) => {
      const guildId = this.requireGuild(interaction);
      if (!guildId) return;
      const user = interaction.options.getUser('user', true);
      const includeRemoved = interaction.options.getBoolean('include_removed') ?? false;
      try {
        const warnings = await this.service.getWarnings(guildId, user.id, includeRemoved);
        const embed = new EmbedBuilder()
          .setColor(warnings.length ? '#facc15' : '#22c55e')
          .setTitle(`⚠️ Warnings for ${user.username}`)
          .setDescription(
            warnings.length === 0
              ? 'No warnings found.'
              : warnings
                  .slice(0, 20)
                  .map((w) => {
                    const state = w.active ? '' : ' *(removed)*';
                    const by = `<@${w.moderator_id}>`;
                    return `• \`${w.id}\` — ${w.reason}${state}\n  by ${by} ${timestamp(w.created_at)}`;
                  })
                  .join('\n')
          )
          .setFooter({ text: `${formatNumber(warnings.length)} warning(s)` })
          .setTimestamp();
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      } catch (error) {
        this.logger.error('Moderation Commands', 'Failed to get warnings', error as Error);
        await this.fail(interaction, error);
      }
    },
  };

  private warningsClearCommand: ModerationCommand = {
    data: new SlashCommandBuilder()
      .setName('warnings-clear')
      .setDescription('Clear all active warnings for a user')
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .addUserOption((option) => option.setName('user').setDescription('User whose warnings to clear').setRequired(true)) as SlashCommandBuilder,
    execute: async (interaction) => {
      const guildId = this.requireGuild(interaction);
      if (!guildId) return;
      const user = interaction.options.getUser('user', true);
      try {
        const count = await this.service.clearWarnings(guildId, user.id, interaction.user.id);
        await interaction.reply({ content: `✅ Cleared **${count}** warning(s) for ${user.username}.`, flags: MessageFlags.Ephemeral });
      } catch (error) {
        this.logger.error('Moderation Commands', 'Failed to clear warnings', error as Error);
        await this.fail(interaction, error);
      }
    },
  };

  private kickCommand: ModerationCommand = {
    data: new SlashCommandBuilder()
      .setName('kick')
      .setDescription('Kick a user from the server')
      .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
      .addUserOption((option) => option.setName('user').setDescription('User to kick').setRequired(true))
      .addStringOption((option) => option.setName('reason').setDescription('Reason for kick')) as SlashCommandBuilder,
    execute: async (interaction) => {
      const guildId = this.requireGuild(interaction);
      if (!guildId) return;
      const user = interaction.options.getUser('user', true);
      const reason = interaction.options.getString('reason') ?? 'No reason provided';
      try {
        const caseId = await this.service.kick(guildId, user.id, interaction.user.id, reason);
        await interaction.reply({ content: `👢 Kicked ${user.tag} (Case: \`${caseId}\`)\nReason: ${reason}`, flags: MessageFlags.Ephemeral });
      } catch (error) {
        this.logger.error('Moderation Commands', 'Failed to kick user', error as Error);
        await this.fail(interaction, error);
      }
    },
  };

  private banCommand: ModerationCommand = {
    data: new SlashCommandBuilder()
      .setName('ban')
      .setDescription('Ban a user from the server')
      .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
      .addUserOption((option) => option.setName('user').setDescription('User to ban').setRequired(true))
      .addStringOption((option) => option.setName('reason').setDescription('Reason for ban'))
      .addIntegerOption((option) =>
        option.setName('delete_days').setDescription('Delete this many days of messages (0-7)').setMinValue(0).setMaxValue(7)
      ) as SlashCommandBuilder,
    execute: async (interaction) => {
      const guildId = this.requireGuild(interaction);
      if (!guildId) return;
      const user = interaction.options.getUser('user', true);
      const reason = interaction.options.getString('reason') ?? 'No reason provided';
      const days = interaction.options.getInteger('delete_days') ?? 0;
      try {
        const caseId = await this.service.ban(guildId, user.id, interaction.user.id, reason, days);
        await interaction.reply({ content: `🔨 Banned ${user.tag} (Case: \`${caseId}\`)\nReason: ${reason}`, flags: MessageFlags.Ephemeral });
      } catch (error) {
        this.logger.error('Moderation Commands', 'Failed to ban user', error as Error);
        await this.fail(interaction, error);
      }
    },
  };

  private unbanCommand: ModerationCommand = {
    data: new SlashCommandBuilder()
      .setName('unban')
      .setDescription('Unban a user from the server')
      .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
      .addStringOption((option) => option.setName('user_id').setDescription('User id to unban').setRequired(true))
      .addStringOption((option) => option.setName('reason').setDescription('Reason for unban')) as SlashCommandBuilder,
    execute: async (interaction) => {
      const guildId = this.requireGuild(interaction);
      if (!guildId) return;
      const userId = interaction.options.getString('user_id', true).trim();
      const reason = interaction.options.getString('reason') ?? undefined;
      try {
        const caseId = await this.service.unban(guildId, userId, interaction.user.id, reason);
        await interaction.reply({ content: `✅ Unbanned <@${userId}> (Case: \`${caseId}\`)`, flags: MessageFlags.Ephemeral });
      } catch (error) {
        this.logger.error('Moderation Commands', 'Failed to unban user', error as Error);
        await this.fail(interaction, error);
      }
    },
  };

  private muteCommand: ModerationCommand = {
    data: new SlashCommandBuilder()
      .setName('mute')
      .setDescription('Timeout a user for a duration')
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .addUserOption((option) => option.setName('user').setDescription('User to mute').setRequired(true))
      .addIntegerOption((option) =>
        option.setName('duration').setDescription('Duration in minutes (1-40320)').setRequired(true).setMinValue(1).setMaxValue(40320)
      )
      .addStringOption((option) => option.setName('reason').setDescription('Reason for mute')) as SlashCommandBuilder,
    execute: async (interaction) => {
      const guildId = this.requireGuild(interaction);
      if (!guildId) return;
      const user = interaction.options.getUser('user', true);
      const duration = interaction.options.getInteger('duration', true);
      const reason = interaction.options.getString('reason') ?? 'No reason provided';
      try {
        const caseId = await this.service.mute(guildId, user.id, interaction.user.id, reason, duration);
        await interaction.reply({
          content: `🔇 Muted ${user.tag} for ${duration} minutes (Case: \`${caseId}\`)\nReason: ${reason}`,
          flags: MessageFlags.Ephemeral,
        });
      } catch (error) {
        this.logger.error('Moderation Commands', 'Failed to mute user', error as Error);
        await this.fail(interaction, error);
      }
    },
  };

  private unmuteCommand: ModerationCommand = {
    data: new SlashCommandBuilder()
      .setName('unmute')
      .setDescription('Remove a timeout from a user')
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .addUserOption((option) => option.setName('user').setDescription('User to unmute').setRequired(true))
      .addStringOption((option) => option.setName('reason').setDescription('Reason for unmute')) as SlashCommandBuilder,
    execute: async (interaction) => {
      const guildId = this.requireGuild(interaction);
      if (!guildId) return;
      const user = interaction.options.getUser('user', true);
      const reason = interaction.options.getString('reason') ?? undefined;
      try {
        const caseId = await this.service.unmute(guildId, user.id, interaction.user.id, reason);
        await interaction.reply({ content: `🔊 Unmuted ${user.tag} (Case: \`${caseId}\`)`, flags: MessageFlags.Ephemeral });
      } catch (error) {
        this.logger.error('Moderation Commands', 'Failed to unmute user', error as Error);
        await this.fail(interaction, error);
      }
    },
  };

  private casesCommand: ModerationCommand = {
    data: new SlashCommandBuilder()
      .setName('cases')
      .setDescription('View recent moderation cases')
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .addUserOption((option) => option.setName('user').setDescription('Filter by user'))
      .addIntegerOption((option) => option.setName('page').setDescription('Page number').setMinValue(1)) as SlashCommandBuilder,
    execute: async (interaction) => {
      const guildId = this.requireGuild(interaction);
      if (!guildId) return;
      const user = interaction.options.getUser('user');
      const page = Math.max(1, interaction.options.getInteger('page') ?? 1);
      const pageSize = 10;
      try {
        const cases = await this.service.getCases(guildId, user?.id, pageSize, (page - 1) * pageSize);
        const embed = new EmbedBuilder()
          .setColor('#5865f2')
          .setTitle(user ? `Moderation cases — ${user.username}` : 'Recent moderation cases')
          .setDescription(
            cases.length === 0
              ? 'No cases found.'
              : cases
                  .map(
                    (c) =>
                      `• \`${c.id}\` **${c.type}** <@${c.user_id}> by <@${c.moderator_id}>\n  ${c.reason ?? 'No reason'} ${timestamp(c.created_at)}`
                  )
                  .join('\n')
          )
          .setFooter({ text: `Page ${page}` })
          .setTimestamp();
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      } catch (error) {
        this.logger.error('Moderation Commands', 'Failed to fetch cases', error as Error);
        await this.fail(interaction, error);
      }
    },
  };
}
