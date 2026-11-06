import {
  SlashCommandBuilder,
  EmbedBuilder,
  Colors,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
import type { Command } from '../../core/commands.js';
import { Infraction } from '../../db/models/Infraction.js';

export const banCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a member from the server.')
    .setDMPermission(false)
    .addUserOption((option) =>
      option.setName('user').setDescription('The member to ban').setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('reason')
        .setDescription('Reason for the ban')
        .setRequired(false)
        .setMaxLength(1000),
    ),
  category: 'moderation',
  userPermissions: [PermissionFlagsBits.BanMembers],
  botPermissions: [PermissionFlagsBits.BanMembers],
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
        embeds: [errorEmbed('You cannot ban yourself.')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Cache-only lookup previously skipped hierarchy checks on cache miss and
    // let moderators ban higher-role members who simply weren't cached.
    // Fetch on miss so the checks below always see the real target.
    const target =
      guild.members.cache.get(user.id) ??
      (await guild.members.fetch(user.id).catch(() => null));

    if (target) {
      // Staff cannot ban someone whose top role is equal to or above their own.
      if (
        target.roles.highest.position >= member.roles.highest.position &&
        !member.permissions.has(PermissionFlagsBits.Administrator)
      ) {
        await interaction.reply({
          embeds: [
            errorEmbed(
              'You cannot ban a member with an equal or higher top role than yours.',
            ),
          ],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      // The bot must be able to ban the target.
      if (!target.bannable) {
        await interaction.reply({
          embeds: [errorEmbed('I cannot ban this member.')],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }

    try {
      await guild.members.ban(user.id, { reason });
    } catch (err) {
      await interaction.reply({
        embeds: [errorEmbed('I could not ban this member. Check my permissions and role position.')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await Infraction.create({
      guildId: guild.id,
      userId: user.id,
      moderatorId: interaction.user.id,
      type: 'ban',
      reason,
      active: true,
    }).catch(() => undefined);

    const embed = new EmbedBuilder()
      .setColor(Colors.Red)
      .setTitle('🔨 Member Banned')
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
    .setTitle('❌ Ban failed')
    .setDescription(description)
    .setTimestamp();
}
