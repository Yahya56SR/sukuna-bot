import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  type ChatInputCommandInteraction,
  type Guild,
  type TextChannel,
} from 'discord.js';
import type { Command } from '../../core/commands.js';
import { TicketPanel, OpenTicket } from '../../db/models/Ticket.js';

export const ticketCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Manage support tickets (button-based ticket system).')
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName('setup')
        .setDescription('Post a ticket panel in the current channel')
        .addChannelOption((option) =>
          option
            .setName('channel')
            .setDescription('Channel to post the panel in (default: current)')
        ),
    )
    .addSubcommand((sub) =>
      sub.setName('close').setDescription('Close the current ticket channel'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Add a member to the current ticket')
        .addUserOption((option) =>
          option.setName('user').setDescription('The member to add').setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Remove a member from the current ticket')
        .addUserOption((option) =>
          option.setName('user').setDescription('The member to remove').setRequired(true),
        ),
    ),
  category: 'moderation',
  userPermissions: ['ManageGuild'],
  execute: async (context) => {
    const { interaction, guild } = context;
    const subcommand = interaction.options.getSubcommand(true);

    if (subcommand === 'setup') {
      await handleTicketSetup(interaction, guild!);
    } else if (subcommand === 'close') {
      await handleTicketClose(interaction, guild!);
    } else if (subcommand === 'add') {
      await handleTicketAdd(interaction, guild!);
    } else if (subcommand === 'remove') {
      await handleTicketRemove(interaction, guild!);
    }
  },
};

async function handleTicketSetup(
  interaction: ChatInputCommandInteraction,
  guild: Guild,
): Promise<void> {
  const channel = (interaction.options.getChannel('channel') ??
    interaction.channel) as TextChannel;

  const existing = await TicketPanel.findOne({ guildId: guild.id, channelId: channel.id });
  if (existing) {
    await interaction.reply({
      content: '❌ A ticket panel already exists in this channel.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('🎫 Support Tickets')
    .setDescription(
      'Click the button below to open a support ticket. A private channel will be created for you and the support team.'
    )
    .setFooter({ text: '爱 Doctora • Tickets' })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket_create')
      .setLabel('Create Ticket')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🎫'),
  );

  const message = await channel.send({
    embeds: [embed],
    components: [row.toJSON()],
  });

  await TicketPanel.create({
    guildId: guild.id,
    channelId: channel.id,
    messageId: message.id,
  });

  await interaction.reply({
    content: `✅ Ticket panel posted in ${channel}.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleTicketClose(
  interaction: ChatInputCommandInteraction,
  guild: Guild,
): Promise<void> {
  const ticket = await OpenTicket.findOne({
    guildId: guild.id,
    channelId: interaction.channelId,
    closedAt: null,
  });
  if (!ticket) {
    await interaction.reply({
      content: '❌ This is not an open ticket channel.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await OpenTicket.updateOne(
    { guildId: guild.id, channelId: interaction.channelId },
    { closedAt: new Date() },
  );

  const channel = interaction.channel as TextChannel;
  await channel.send(
    '🔒 This ticket is being closed. The channel will be deleted in 10 seconds...',
  );

  setTimeout(async () => {
    try {
      await channel.delete();
    } catch {
      /* channel already deleted or missing permissions */
    }
  }, 10_000);

  await interaction.reply({ content: '✅ Ticket closed.', flags: MessageFlags.Ephemeral });
}

async function handleTicketAdd(
  interaction: ChatInputCommandInteraction,
  guild: Guild,
): Promise<void> {
  const ticket = await OpenTicket.findOne({
    guildId: guild.id,
    channelId: interaction.channelId,
    closedAt: null,
  });
  if (!ticket) {
    await interaction.reply({
      content: '❌ This is not an open ticket channel.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const user = interaction.options.getUser('user', true);
  const member = guild.members.cache.get(user.id) ?? (await guild.members.fetch(user.id).catch(() => null));
  if (!member) {
    await interaction.reply({
      content: '❌ Member not found in this server.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const channel = interaction.channel as TextChannel;
  try {
    await channel.permissionOverwrites.create(member.id, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
      AttachFiles: true,
    });
    await interaction.reply({
      content: `✅ Added ${user.tag} to the ticket.`,
      flags: MessageFlags.Ephemeral,
    });
  } catch {
    await interaction.reply({
      content: '❌ Failed to add member to the ticket.',
      flags: MessageFlags.Ephemeral,
    });
  }
}

async function handleTicketRemove(
  interaction: ChatInputCommandInteraction,
  guild: Guild,
): Promise<void> {
  const ticket = await OpenTicket.findOne({
    guildId: guild.id,
    channelId: interaction.channelId,
    closedAt: null,
  });
  if (!ticket) {
    await interaction.reply({
      content: '❌ This is not an open ticket channel.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const user = interaction.options.getUser('user', true);
  if (user.id === ticket.userId) {
    await interaction.reply({
      content: '❌ Cannot remove the ticket owner.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const channel = interaction.channel as TextChannel;
  try {
    await channel.permissionOverwrites.delete(user.id);
    await interaction.reply({
      content: `✅ Removed ${user.tag} from the ticket.`,
      flags: MessageFlags.Ephemeral,
    });
  } catch {
    await interaction.reply({
      content: '❌ Failed to remove member from the ticket.',
      flags: MessageFlags.Ephemeral,
    });
  }
}
