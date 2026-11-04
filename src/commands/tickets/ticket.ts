import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  SelectMenuBuilder,
  type ChatInputCommandInteraction,
  type Guild,
  type TextChannel,
  type Message,
  type GuildMember,
} from 'discord.js';
import type { Command } from '../../core/commands.js';
import {
  TicketPanel,
  TicketDepartment,
  OpenTicket,
  TicketConfig,
  DEFAULT_DEPARTMENT,
  defaultTicketConfig,
} from '../../db/models/Ticket.js';
import { replyError } from '../../core/respond.js';

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function shortId(): string {
  return Math.random().toString(36).slice(2, 8);
}

function requireStaff(interaction: ChatInputCommandInteraction, guild: Guild): boolean {
  const member = interaction.member as GuildMember;
  if (!member) return false;
  return member.permissions.has('ManageGuild');
}

async function getTicketConfig(guildId: string) {
  let config = await TicketConfig.findOne({ guildId });
  if (!config) {
    config = await TicketConfig.create(defaultTicketConfig(guildId));
  }
  return config;
}

async function getActiveDepartments(guildId: string) {
  return TicketDepartment.find({ guildId, isActive: true }).sort({ createdAt: 1 }).lean();
}

async function userHasOpenTicket(guildId: string, userId: string) {
  return OpenTicket.findOne({ guildId, userId, closedAt: null });
}

/* -------------------------------------------------------------------------- */
/* Command                                                                    */
/* -------------------------------------------------------------------------- */

export const ticketCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('愛 Doctora feature-rich ticket system.')
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName('setup')
        .setDescription('Post the live ticket panel in a channel.')
        .addChannelOption((o) =>
          o.setName('channel').setDescription('Channel to post the panel (default: current)'),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('department')
        .setDescription('Manage ticket departments.')
        .addStringOption((o) =>
          o
            .setName('action')
            .setDescription('What to do')
            .setRequired(true)
            .addChoices(
              { name: 'Create', value: 'create' },
              { name: 'Edit', value: 'edit' },
              { name: 'List', value: 'list' },
              { name: 'Delete', value: 'delete' },
            ),
        )
        .addStringOption((o) =>
          o
            .setName('name')
            .setDescription('Department name')
            .setRequired(false),
        )
        .addStringOption((o) =>
          o.setName('description').setDescription('Department description').setRequired(false),
        )
        .addStringOption((o) => o.setName('emoji').setDescription('Department emoji').setRequired(false))
        .addRoleOption((o) =>
          o.setName('staff-role').setDescription('Staff role for this department').setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName('close').setDescription('Close the current ticket channel.'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('claim')
        .setDescription('Claim the current ticket for yourself.'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Add a member to the current ticket.')
        .addUserOption((o) =>
          o.setName('user').setDescription('Member to add').setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Remove a member from the current ticket.')
        .addUserOption((o) =>
          o.setName('user').setDescription('Member to remove').setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('transcript')
        .setDescription('Send the ticket transcript (DM or channel).')
        .addStringOption((o) =>
          o
            .setName('target')
            .setDescription('Where to send')
            .addChoices(
              { name: 'Channel', value: 'channel' },
              { name: 'DM', value: 'dm' },
            ),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('config')
        .setDescription('Configure ticket system settings.')
        .addStringOption((o) =>
          o
            .setName('key')
            .setDescription('Setting to change')
            .setRequired(true)
            .addChoices(
              { name: 'maxTicketsPerUser', value: 'maxTicketsPerUser' },
              { name: 'cooldownSeconds', value: 'cooldownSeconds' },
              { name: 'dmTranscript', value: 'dmTranscript' },
              { name: 'transcriptChannel', value: 'transcriptChannel' },
              { name: 'autoCloseMinutes', value: 'autoCloseMinutes' },
              { name: 'staffRoles', value: 'staffRoles' },
            ),
        )
        .addStringOption((o) =>
          o.setName('value').setDescription('New value').setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName('stats').setDescription('Show ticket system statistics.'),
    ),

  category: 'moderation',
  userPermissions: ['ManageGuild'],
  execute: async (context) => {
    const { interaction, guild } = context;
    const subcommand = interaction.options.getSubcommand(true);

    try {
      switch (subcommand) {
        case 'setup':
          await handleSetup(interaction, guild!);
          break;
        case 'department':
          await handleDepartment(interaction, guild!);
          break;
        case 'close':
          await handleClose(interaction, guild!);
          break;
        case 'claim':
          await handleClaim(interaction, guild!);
          break;
        case 'add':
          await handleAdd(interaction, guild!);
          break;
        case 'remove':
          await handleRemove(interaction, guild!);
          break;
        case 'transcript':
          await handleTranscript(interaction, guild!);
          break;
        case 'config':
          await handleConfig(interaction, guild!);
          break;
        case 'stats':
          await handleStats(interaction, guild!);
          break;
      }
    } catch (error) {
      await replyError(interaction, `❌ Ticket error: ${(error as Error).message}`);
    }
  },
};

/* -------------------------------------------------------------------------- */
/* /ticket setup                                                              */
/* -------------------------------------------------------------------------- */

async function handleSetup(interaction: ChatInputCommandInteraction, guild: Guild) {
  if (!requireStaff(interaction, guild)) {
    await replyError(interaction, '❌ You need `Manage Server` permission.');
    return;
  }

  const channel =
    (interaction.options.getChannel('channel') as TextChannel | null) ??
    (interaction.channel as TextChannel);

  const existing = await TicketPanel.findOne({ guildId: guild.id, channelId: channel.id });
  if (existing) {
    await interaction.reply({
      content: '❌ A ticket panel already exists in this channel.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  let departments = await TicketDepartment.find({ guildId: guild.id, isActive: true }).lean();
  if (departments.length === 0) {
    await TicketDepartment.create({
      guildId: guild.id,
      ...DEFAULT_DEPARTMENT,
    });
    departments = await TicketDepartment.find({ guildId: guild.id, isActive: true }).lean();
  }

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('🎫 愛 Doctora Support Tickets')
    .setDescription(
      'Click a department below to open a private support ticket. A support team member will be with you shortly.\n\n' +
        departments.map((d) => `${d.emoji} **${d.name}** — ${d.description}`).join('\n'),
    )
    .setImage('https://media.giphy.com/media/3oEjI6SIIHBdRxXI40/giphy.gif')
    .setThumbnail(guild.iconURL())
    .setFooter({ text: '愛 Doctora • Tickets' })
    .setTimestamp();

  const rows: ActionRowBuilder[] = [];
  let row = new ActionRowBuilder();
  for (const dept of departments) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`ticket_create:${dept._id}`)
        .setLabel(dept.name)
        .setStyle(ButtonStyle.Primary)
        .setEmoji(dept.emoji),
    );
    if (row.components.length >= 5) {
      rows.push(row);
      row = new ActionRowBuilder();
    }
  }
  if (row.components.length > 0) rows.push(row);

  const message = await channel.send({
    embeds: [embed],
    components: rows.map((r) => r.toJSON()),
  });

  await TicketPanel.create({
    guildId: guild.id,
    channelId: channel.id,
    messageId: message.id,
    embedTitle: embed.data.title ?? '🎫 愛 Doctora Support Tickets',
    embedDescription: embed.data.description ?? '',
    embedColor: 0x5865f2,
    embedImage: embed.data.image?.url ?? undefined,
    embedThumbnail: embed.data.thumbnail?.url ?? undefined,
    embedFooter: '愛 Doctora • Tickets',
  });

  await interaction.reply({
    content: `✅ Live ticket panel posted in ${channel} with ${departments.length} department(s).`,
    flags: MessageFlags.Ephemeral,
  });
}

/* -------------------------------------------------------------------------- */
/* /ticket department                                                         */
/* -------------------------------------------------------------------------- */

async function handleDepartment(interaction: ChatInputCommandInteraction, guild: Guild) {
  if (!requireStaff(interaction, guild)) {
    await replyError(interaction, '❌ You need `Manage Server` permission.');
    return;
  }

  const action = interaction.options.getString('action', true);
  const name = interaction.options.getString('name');

  if (action === 'list') {
    const departments = await TicketDepartment.find({ guildId: guild.id }).lean();
    if (departments.length === 0) {
      await interaction.reply({
        content: '📭 No departments configured.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('📋 Ticket Departments')
      .setDescription(
        departments
          .map(
            (d) =>
              `${d.emoji} **${d.name}**${d.isActive ? '' : ' (inactive)'} — ${d.description}${
                d.staffRoleId ? ` • Staff: <@&${d.staffRoleId}>` : ''
              }`,
          )
          .join('\n'),
      );
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    return;
  }

  if (!name) {
    await replyError(interaction, '❌ A department name is required for this action.');
    return;
  }

  if (action === 'create') {
    const existing = await TicketDepartment.findOne({ guildId: guild.id, name });
    if (existing) {
      await replyError(interaction, '❌ A department with that name already exists.');
      return;
    }
    const description = interaction.options.getString('description') ?? 'General support';
    const emoji = interaction.options.getString('emoji') ?? '🎫';
    const staffRole = interaction.options.getRole('staff-role');
    await TicketDepartment.create({
      guildId: guild.id,
      name,
      description,
      emoji,
      staffRoleId: staffRole?.id,
    });
    await interaction.reply({
      content: `✅ Department **${name}** created.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const dept = await TicketDepartment.findOne({ guildId: guild.id, name });
  if (!dept) {
    await replyError(interaction, '❌ Department not found.');
    return;
  }

  if (action === 'edit') {
    const description = interaction.options.getString('description');
    const emoji = interaction.options.getString('emoji');
    const staffRole = interaction.options.getRole('staff-role');
    if (description) dept.description = description;
    if (emoji) dept.emoji = emoji;
    if (staffRole) dept.staffRoleId = staffRole.id;
    await dept.save();
    await interaction.reply({ content: `✅ Department **${name}** updated.`, flags: MessageFlags.Ephemeral });
    return;
  }

  if (action === 'delete') {
    await TicketDepartment.deleteOne({ _id: dept._id });
    await interaction.reply({ content: `✅ Department **${name}** deleted.`, flags: MessageFlags.Ephemeral });
    return;
  }
}

/* -------------------------------------------------------------------------- */
/* /ticket close                                                              */
/* -------------------------------------------------------------------------- */

async function handleClose(interaction: ChatInputCommandInteraction, guild: Guild) {
  const ticket = await OpenTicket.findOne({
    guildId: guild.id,
    channelId: interaction.channelId,
    closedAt: null,
  });
  if (!ticket) {
    await replyError(interaction, '❌ This is not an open ticket channel.');
    return;
  }

  await OpenTicket.updateOne(
    { _id: ticket._id },
    { closedAt: new Date(), closedBy: interaction.user.id, closeReason: 'Manual close' },
  );

  await interaction.reply('🔒 Closing ticket in 10 seconds... Saving transcript.');
  await sendTranscript(interaction, guild, ticket, 'channel');

  setTimeout(async () => {
    try {
      await (interaction.channel as any).delete();
    } catch {}
  }, 10_000);
}

/* -------------------------------------------------------------------------- */
/* /ticket claim                                                              */
/* -------------------------------------------------------------------------- */

async function handleClaim(interaction: ChatInputCommandInteraction, guild: Guild) {
  const ticket = await OpenTicket.findOne({
    guildId: guild.id,
    channelId: interaction.channelId,
    closedAt: null,
  });
  if (!ticket) {
    await replyError(interaction, '❌ This is not an open ticket channel.');
    return;
  }

  if (ticket.claimedBy) {
    await replyError(interaction, `❌ Already claimed by <@${ticket.claimedBy}>.`);
    return;
  }

  ticket.claimedBy = interaction.user.id;
  ticket.claimedAt = new Date();
  await ticket.save();

  await interaction.reply({
    content: `✅ Ticket claimed by <@${interaction.user.id}>.`,
    flags: MessageFlags.Ephemeral,
  });
}

/* -------------------------------------------------------------------------- */
/* /ticket add                                                                */
/* -------------------------------------------------------------------------- */

async function handleAdd(interaction: ChatInputCommandInteraction, guild: Guild) {
  const ticket = await OpenTicket.findOne({
    guildId: guild.id,
    channelId: interaction.channelId,
    closedAt: null,
  });
  if (!ticket) {
    await replyError(interaction, '❌ This is not an open ticket channel.');
    return;
  }

  const user = interaction.options.getUser('user', true);
  const channel = interaction.channel as TextChannel;

  try {
    await channel.permissionOverwrites.create(user.id, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
      AttachFiles: true,
    });
    await channel.send({
      content: `✅ <@${user.id}> added to the ticket by <@${interaction.user.id}>.`,
    });
    await interaction.reply({ content: `✅ Added ${user.tag} to the ticket.`, flags: MessageFlags.Ephemeral });
  } catch {
    await replyError(interaction, '❌ Failed to add member to the ticket.');
  }
}

/* -------------------------------------------------------------------------- */
/* /ticket remove                                                             */
/* -------------------------------------------------------------------------- */

async function handleRemove(interaction: ChatInputCommandInteraction, guild: Guild) {
  const ticket = await OpenTicket.findOne({
    guildId: guild.id,
    channelId: interaction.channelId,
    closedAt: null,
  });
  if (!ticket) {
    await replyError(interaction, '❌ This is not an open ticket channel.');
    return;
  }

  const user = interaction.options.getUser('user', true);
  if (user.id === ticket.userId) {
    await replyError(interaction, '❌ Cannot remove the ticket owner.');
    return;
  }

  const channel = interaction.channel as TextChannel;
  try {
    await channel.permissionOverwrites.delete(user.id);
    await channel.send({
      content: `✅ <@${user.id}> removed from the ticket by <@${interaction.user.id}>.`,
    });
    await interaction.reply({ content: `✅ Removed ${user.tag} from the ticket.`, flags: MessageFlags.Ephemeral });
  } catch {
    await replyError(interaction, '❌ Failed to remove member from the ticket.');
  }
}

/* -------------------------------------------------------------------------- */
/* /ticket transcript                                                         */
/* -------------------------------------------------------------------------- */

async function handleTranscript(
  interaction: ChatInputCommandInteraction,
  guild: Guild,
) {
  const ticket = await OpenTicket.findOne({
    guildId: guild.id,
    channelId: interaction.channelId,
    closedAt: null,
  });
  if (!ticket) {
    await replyError(interaction, '❌ This is not an open ticket channel.');
    return;
  }

  const target = (interaction.options.getString('target') ?? 'channel') as 'channel' | 'dm';
  await sendTranscript(interaction, guild, ticket, target);
  await interaction.reply({ content: `✅ Transcript sent to ${target}.`, flags: MessageFlags.Ephemeral });
}

async function sendTranscript(
  interaction: ChatInputCommandInteraction,
  guild: Guild,
  ticket: any,
  target: 'channel' | 'dm',
) {
  const channel = guild.channels.cache.get(ticket.channelId) as TextChannel | undefined;
  if (!channel) return;

  const messages = await channel.messages.fetch({ limit: 100 });
  const lines = messages
    .reverse()
    .map((m) => `[${m.createdAt.toISOString()}] ${m.author.tag}: ${m.content}`)
    .join('\n');

  const transcript = `TICKET TRANSCRIPT\nGuild: ${guild.name}\nChannel: #${channel.name}\nOwner: <@${ticket.userId}>\nDepartment: ${ticket.departmentName}\nClaimed by: ${ticket.claimedBy ? `<@${ticket.claimedBy}>` : 'none'}\nClosed by: <@${interaction.user.id}>\n\n${lines}`;

  const attachment = Buffer.from(transcript);
  const fileName = `ticket-${ticket.channelId}-${shortId()}.txt`;

  if (target === 'dm') {
    const user = await guild.members.fetch(ticket.userId).catch(() => null);
    if (user) {
      await user.user.send({
        content: `📄 Transcript for ticket #${channel.name}`,
        files: [{ attachment, name: fileName }],
      }).catch(() => {});
    }
  } else {
    await channel.send({
      content: `📄 Ticket transcript generated by <@${interaction.user.id}>:`,
      files: [{ attachment, name: fileName }],
    });
  }

  // Also post a copy to the configured transcript log channel, if any.
  const config = await TicketConfig.findOne({ guildId: guild.id });
  const logChannelId = config?.transcriptChannelId;
  if (logChannelId) {
    const logChannel = guild.channels.cache.get(logChannelId) as TextChannel | undefined;
    if (logChannel) {
      try {
        await logChannel.send({
          content: `📄 Transcript for ticket #${channel.name} (${ticket.departmentName})`,
          files: [{ attachment, name: fileName }],
        });
      } catch {}
    }
  }

  await OpenTicket.updateOne({ _id: ticket._id }, { transcriptSent: true });
}

/* -------------------------------------------------------------------------- */
/* /ticket config                                                             */
/* -------------------------------------------------------------------------- */

async function handleConfig(interaction: ChatInputCommandInteraction, guild: Guild) {
  if (!requireStaff(interaction, guild)) {
    await replyError(interaction, '❌ You need `Manage Server` permission.');
    return;
  }

  const key = interaction.options.getString('key', true);
  const value = interaction.options.getString('value');

  const config = await getTicketConfig(guild.id);

  if (key === 'maxTicketsPerUser') {
    const n = parseInt(value ?? '', 10);
    if (!Number.isFinite(n) || n < 1) {
      await replyError(interaction, '❌ Provide a positive number.');
      return;
    }
    config.maxTicketsPerUser = n;
  } else if (key === 'cooldownSeconds') {
    const n = parseInt(value ?? '', 10);
    if (!Number.isFinite(n) || n < 0) {
      await replyError(interaction, '❌ Provide a non-negative number.');
      return;
    }
    config.cooldownSeconds = n;
  } else if (key === 'dmTranscript') {
    config.dmTranscript = value?.toLowerCase() === 'true';
  } else if (key === 'transcriptChannel') {
    config.transcriptChannelId = value ?? undefined;
  } else if (key === 'autoCloseMinutes') {
    const n = parseInt(value ?? '', 10);
    if (!Number.isFinite(n) || n < 0) {
      await replyError(interaction, '❌ Provide a non-negative number.');
      return;
    }
    config.autoCloseMinutes = n;
  } else if (key === 'staffRoles') {
    // store comma-separated role IDs
    config.staffRoleIds = value ? value.split(',').map((s) => s.trim()).filter(Boolean) : [];
  }

  await config.save();
  await interaction.reply({ content: `✅ Updated \`${key}\`.`, flags: MessageFlags.Ephemeral });
}

/* -------------------------------------------------------------------------- */
/* /ticket stats                                                              */
/* -------------------------------------------------------------------------- */

async function handleStats(interaction: ChatInputCommandInteraction, guild: Guild) {
  const open = await OpenTicket.countDocuments({ guildId: guild.id, closedAt: null });
  const closed = await OpenTicket.countDocuments({ guildId: guild.id, closedAt: { $ne: null } });
  const panels = await TicketPanel.countDocuments({ guildId: guild.id });
  const departments = await TicketDepartment.countDocuments({ guildId: guild.id, isActive: true });

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('📊 Ticket Statistics')
    .setDescription(`Ticket system overview for **${guild.name}**:`)
    .addFields(
      { name: 'Open tickets', value: String(open), inline: true },
      { name: 'Closed tickets', value: String(closed), inline: true },
      { name: 'Panels posted', value: String(panels), inline: true },
      { name: 'Active departments', value: String(departments), inline: true },
    )
    .setFooter({ text: '愛 Doctora • Tickets' })
    .setTimestamp();

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}
