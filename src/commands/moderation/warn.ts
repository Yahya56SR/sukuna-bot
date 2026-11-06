import {
  SlashCommandBuilder,
  EmbedBuilder,
  Colors,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
import type { Command } from '../../core/commands.js';
import { Infraction } from '../../db/models/Infraction.js';

export const warnCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Warn a member and record the infraction.')
    .setDMPermission(false)
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription('The member to warn')
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('reason')
        .setDescription('Reason for the warning')
        .setRequired(false)
        .setMaxLength(1000),
    ),
  category: 'moderation',
  userPermissions: [PermissionFlagsBits.ModerateMembers],
  botPermissions: [PermissionFlagsBits.ModerateMembers],
  cooldownSeconds: 5,
  execute: async (context) => {
    const { interaction, guild, member } = context;
    const user = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') ?? 'No reason provided';

    if (!user) {
      await interaction.reply({
        embeds: [errorEmbed('User not found')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (user.id === interaction.user.id) {
      await interaction.reply({
        embeds: [errorEmbed('You cannot warn yourself.')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const target =
      guild.members.cache.get(user.id) ??
      (await guild.members.fetch(user.id).catch(() => null));
    if (!target) {
      await interaction.reply({
        embeds: [errorEmbed('That user is not in this server.')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Staff cannot warn someone whose top role is equal to or above their own.
    if (
      target.roles.highest.position >= member.roles.highest.position &&
      !member.permissions.has(PermissionFlagsBits.Administrator)
    ) {
      await interaction.reply({
        embeds: [
          errorEmbed(
            'You cannot warn a member with an equal or higher top role than yours.',
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await Infraction.create({
      guildId: guild.id,
      userId: user.id,
      moderatorId: interaction.user.id,
      type: 'warn',
      reason,
      active: true,
    });

    const embed = new EmbedBuilder()
      .setColor(Colors.Yellow)
      .setTitle('⚠️ Member Warned')
      .addFields(
        { name: 'User', value: `${user.tag} (${user.id})`, inline: true },
        { name: 'Moderator', value: interaction.user.tag, inline: true },
        { name: 'Reason', value: reason, inline: false },
      )
      .setFooter({ text: '愛 Bella Star • Moderation' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
};

function errorEmbed(description: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.Red)
    .setTitle('❌ Warning failed')
    .setDescription(description)
    .setTimestamp();
}
