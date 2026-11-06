import {
  SlashCommandBuilder,
  EmbedBuilder,
  Colors,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
import type { Command } from '../../core/commands.js';
import { Infraction } from '../../db/models/Infraction.js';

export const kickCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick a member from the server.')
    .setDMPermission(false)
    .addUserOption((option) =>
      option.setName('user').setDescription('The member to kick').setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('reason')
        .setDescription('Reason for the kick')
        .setRequired(false)
        .setMaxLength(1000),
    ),
  category: 'moderation',
  userPermissions: [PermissionFlagsBits.KickMembers],
  botPermissions: [PermissionFlagsBits.KickMembers],
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
        embeds: [errorEmbed('You cannot kick yourself.')],
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

    // Staff cannot kick someone whose top role is equal to or above their own.
    if (
      target.roles.highest.position >= member.roles.highest.position &&
      !member.permissions.has(PermissionFlagsBits.Administrator)
    ) {
      await interaction.reply({
        embeds: [
          errorEmbed(
            'You cannot kick a member with an equal or higher top role than yours.',
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (!target.kickable) {
      await interaction.reply({
        embeds: [errorEmbed('I cannot kick this member.')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      await target.kick(reason);
    } catch (err) {
      await interaction.reply({
        embeds: [errorEmbed('I could not kick this member. Check my permissions and role position.')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await Infraction.create({
      guildId: guild.id,
      userId: user.id,
      moderatorId: interaction.user.id,
      type: 'kick',
      reason,
      active: true,
    }).catch(() => undefined);

    const embed = new EmbedBuilder()
      .setColor(Colors.Orange)
      .setTitle('👢 Member Kicked')
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
    .setTitle('❌ Kick failed')
    .setDescription(description)
    .setTimestamp();
}
