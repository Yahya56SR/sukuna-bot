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
} from '../../db/models/Ticket.js';
import { replyError } from '../../core/respond.js';

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
    const { interaction } = context;
    const channel =
      (interaction.options.getChannel('channel') as any) ??
      (interaction.channel as any);

    // Owner-only check
    const ownerIds = (process.env.OWNER_IDS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!ownerIds.includes(interaction.user.id)) {
      await interaction.reply({
        content: '❌ This command is owner-only.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const guild = interaction.guild!;

    // Ensure default department exists
    const existing = await TicketDepartment.findOne({ guildId: guild.id });
    if (!existing) {
      await TicketDepartment.create({
        guildId: guild.id,
        name: 'Support',
        description: 'General support',
        emoji: '🎫',
        color: 0x5865f2,
        isActive: true,
      });
    }

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('🎫 Quick Ticket Panel')
      .setDescription(
        'Click a department below to open a private support ticket.\n\n' +
          '🎫 **Support** — General support',
      )
      .setThumbnail(guild.iconURL())
      .setFooter({ text: '爱 Doctora • Quick Tickets' })
      .setTimestamp();

    const rows: ActionRowBuilder[] = [];
    const row = new ActionRowBuilder();
    row.addComponents(
      new ButtonBuilder()
        .setCustomId('ticket_create:support')
        .setLabel('Support')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('🎫'),
    );
    rows.push(row);

    const message = await channel.send({
      embeds: [embed],
      components: rows.map((r) => r.toJSON()),
    });

    await TicketPanel.create({
      guildId: guild.id,
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