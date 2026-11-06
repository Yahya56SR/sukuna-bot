import {
  SlashCommandBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
import type { Command } from '../../core/commands.js';
import {
  TicketPanel,
  TicketDepartment,
  OpenTicket,
  TicketConfig,
  defaultTicketConfig,
  DEFAULT_DEPARTMENT,
} from '../../db/models/Ticket.js';
import { replyError } from '../../core/respond.js';
import { isOwner } from '../../core/owner.js';

export const quickticketCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('quick-ticket')
    .setDescription('Quickly create a ticket panel (owner only).')
    .addChannelOption((option) =>
      option.setName('channel').setDescription('Channel to post the panel (default: current)'),
    )
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  category: 'moderation',
  execute: async (context) => {
    const { interaction, client, guild } = context;
    const channel =
      (interaction.options.getChannel('channel') as any) ??
      (interaction.channel as any);

    // Owner-only check
    if (!isOwner(interaction.user.id)) {
      await interaction.reply({
        content: '❌ This command is owner-only.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const g = guild!;

    // Ensure a default department exists so the button customId points at a
    // real department _id (never a hardcoded string like 'support').
    let department = await TicketDepartment.findOne({ guildId: g.id, isActive: true }).sort({ createdAt: 1 });
    if (!department) {
      department = await TicketDepartment.create({
        guildId: g.id,
        ...DEFAULT_DEPARTMENT,
      });
    }

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('🎫 Quick Ticket Panel')
      .setDescription('Click a department below to open a private support ticket.\n\n🎫 **Support** — General support')
      .setThumbnail(g.iconURL())
      .setFooter({ text: '愛 Bella Star • Quick Tickets' })
      .setTimestamp();

    const row = new ActionRowBuilder();
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`ticket_create:${department._id}`)
        .setLabel(department.name)
        .setStyle(ButtonStyle.Primary)
        .setEmoji(department.emoji),
    );

    const message = await channel.send({
      embeds: [embed],
      components: [row.toJSON()],
    });

    await TicketPanel.create({
      guildId: g.id,
      channelId: channel.id,
      messageId: message.id,
      embedTitle: embed.data.title ?? '🎫 Quick Ticket Panel',
      embedDescription: embed.data.description ?? '',
      embedColor: 0x5865f2,
    });

    await interaction.reply({
      content: `✅ Quick ticket panel posted in ${channel}`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
