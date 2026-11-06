import {
  SlashCommandBuilder,
  EmbedBuilder,
  Colors,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
import type { Command } from '../../core/commands.js';
import { Infraction } from '../../db/models/Infraction.js';

export const timeoutCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('Timeout a member.')
    .setDMPermission(false)
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription('The member to timeout')
        .setRequired(true),
    )
    .addIntegerOption((option) =>
      option
        .setName('duration')
        .setDescription('Duration in minutes')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(40320),
    )
    .addStringOption((option) =>
      option
        .setName('reason')
        .setDescription('Reason for the timeout')
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
    const minutes = interaction.options.getInteger('duration')!;
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
        embeds: [errorEmbed('You cannot timeout yourself.')],
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

    // Staff cannot timeout someone whose top role is equal to or above their own.
    if (
      target.roles.highest.position >= member.roles.highest.position &&
      !member.permissions.has(PermissionFlagsBits.Administrator)
    ) {
      await interaction.reply({
        embeds: [
          errorEmbed(
            'You cannot timeout a member with an equal or higher top role than yours.',
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!(target as any).moderatable && !(target as any).timeoutable) {
      await interaction.reply({
        embeds: [errorEmbed('I cannot timeout this member.')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const durationMs = minutes * 60 * 1000;
    try {
      await target.timeout(durationMs, reason);
    } catch (err) {
      await interaction.reply({
        embeds: [errorEmbed('I could not timeout this member. Check my permissions and role position.')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await Infraction.create({
      guildId: guild.id,
      userId: user.id,
      moderatorId: interaction.user.id,
      type: 'timeout',
      reason,
      duration: minutes * 60,
      expiresAt: new Date(Date.now() + durationMs),
      active: true,
    }).catch(() => undefined);

    const embed = new EmbedBuilder()
      .setColor(Colors.Orange)
      .setTitle('⏱️ Member Timed Out')
      .addFields(
        { name: 'User', value: `${user.tag} (${user.id})`, inline: true },
        { name: 'Moderator', value: interaction.user.tag, inline: true },
        { name: 'Duration', value: `${minutes} minute(s)`, inline: true },
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
    .setTitle('❌ Timeout failed')
    .setDescription(description)
    .setTimestamp();
}
