import {
  Events,
  type ClientEvents,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type TextChannel,
} from 'discord.js';
import { clearCooldown, takeCooldown } from '../core/cooldowns.js';
import { newErrorId, UserFacingError } from '../core/errors.js';
import { bumpCounter, recordActivity } from '../core/metrics.js';
import { replyError } from '../core/respond.js';
import { TicketPanel, TicketDepartment, OpenTicket, TicketConfig } from '../db/models/Ticket.js';
import { getTicketByChannel, closeTicket, startTicketScheduler, stopTicketScheduler } from '../utils/ticketScheduler.js';
import { Types } from 'mongoose';
import { canCloseTicket } from '../commands/tickets/ticket.js';
import { readVcPanelById } from '../db/models/Vc.js';
import { connectVoice, disconnectVoice, isVoiceConnected } from '../voice/manager.js';
import { handleButtonInteraction as handleReactionRoleButton, handleSelectMenuInteraction as handleReactionRoleSelect } from '../handlers/reactionRoles.js';
import { handleSuggestionVote } from '../commands/utility/suggest.js';
import { handleAutomodConfigModal, handleTagEmbedModal } from '../commands/moderation/automod.js';

/** In-memory ticket creation cooldowns: `${guildId}:${userId}` => last create timestamp. */
const ticketCreateCooldowns = new Map<string, number>();

export const interactionCreate = {
  name: Events.InteractionCreate as keyof ClientEvents,
  execute: async (client: any, interaction: any) => {
    // Restrict the bot to a single guild when GUILD_ID is set.
    const allowedGuildId = client.env?.GUILD_ID;
    if (allowedGuildId && interaction.guildId && interaction.guildId !== allowedGuildId) {
      return;
    }

    // Autocomplete must be answered within 3 seconds and never touches the
    // database, so it is dispatched before the slash-command pipeline.
    if (interaction.isAutocomplete()) {
      await runSafely(client, interaction, 'autocomplete', () => handleAutocomplete(client, interaction));
      return;
    }

    // Handle modal submissions
    if (interaction.isModalSubmit()) {
      await runSafely(client, interaction, 'modal submit', () => handleModalSubmit(client, interaction));
      return;
    }

    // Handle button interactions
    if (interaction.isButton()) {
      await runSafely(client, interaction, 'button', () => handleButtonInteraction(client, interaction));
      return;
    }

    // Handle select menu interactions
    if (interaction.isStringSelectMenu()) {
      await runSafely(client, interaction, 'select menu', () => handleSelectMenuInteraction(client, interaction));
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    const guildId = interaction.guildId;
    if (!guildId) {
      await replyError(interaction, "愛 Bella Star only works inside a Discord server.");
      return;
    }

    const errorId = newErrorId();
    const premium = false; // kept for parity; premium system not ported yet
    let config: any = null;

    try {
      config = await client.getConfig(guildId);
      if (!client.isCategoryEnabled(command.category, config) && !command.allowWhenDisabled) {
        await replyError(interaction, `**/${command.data.name}** is disabled on this server.`);
        return;
      }

      if (command.userPermissions?.length) {
        // `memberPermissions` is null for uncached/partial members — fail
        // closed instead of treating "unknown" as "allowed".
        if (!interaction.memberPermissions) {
          await replyError(
            interaction,
            'I could not verify your permissions. Please try again.',
          );
          return;
        }
        const missing = interaction.memberPermissions.missing(command.userPermissions);
        if (missing.length > 0) {
          await replyError(
            interaction,
            `You need the following permissions: ${missing.join(", ")}.`,
          );
          return;
        }
      }

      if (command.botPermissions?.length) {
        if (!interaction.appPermissions) {
          await replyError(
            interaction,
            'I could not verify my own permissions. Please try again.',
          );
          return;
        }
        const missing = interaction.appPermissions.missing(command.botPermissions);
        if (missing.length > 0) {
          await replyError(
            interaction,
            `I am missing permissions: ${missing.join(", ")}.`,
          );
          return;
        }
      }

      const remaining = takeCooldown(
        guildId,
        interaction.user.id,
        command.data.name,
        command.cooldownSeconds ?? 1,
      );
      if (remaining > 0) {
        await replyError(interaction, `Slow down - try again in ${(remaining / 1000).toFixed(1)}s.`);
        return;
      }

      client.logger.info(
        { command: interaction.commandName, userId: interaction.user.id, guildId },
        "command",
      );

      await command.execute({
        client,
        interaction,
        guild: interaction.guild,
        member: interaction.member,
        settings: config,
        premium,
      });

      bumpCounter('commandsRun');
      recordActivity('command', '/' + command.data.name + ' used', {
        level: 'success',
        meta: {
          command: command.data.name,
          guildId,
          userId: interaction.user.id,
        },
      });
    } catch (error) {
      // The command never completed, so hand the cooldown back — otherwise a
      // transient failure silently burns e.g. a 24h /daily window.
      clearCooldown(guildId, interaction.user.id, command.data.name);

      bumpCounter('errors');
      recordActivity('error', '/' + command.data.name + ' failed', {
        level: 'error',
        meta: { command: command.data.name, guildId, userId: interaction.user.id, errorId },
      });
      client.logger.error(
        {
          err: error,
          errorId,
          command: interaction.commandName,
          userId: interaction.user.id,
          guildId,
        },
        "command failed",
      );

      const message =
        error instanceof UserFacingError
          ? error.message
          : "Something went wrong while running that command.";

      await replyError(interaction, message, errorId);
    }
  },
};

/* -------------------------------------------------------------------------- */
/* Autocomplete                                                               */
/* -------------------------------------------------------------------------- */

async function handleAutocomplete(client: any, interaction: any): Promise<void> {
  const command = client.commands.get(interaction.commandName);
  if (!command?.autocomplete) {
    await interaction.respond([]).catch(() => {});
    return;
  }
  await command.autocomplete(interaction);
}

/**
 * Component, modal and autocomplete interactions are dispatched outside the
 * slash-command try/catch. Guard them so a rejection is logged and the user
 * still gets an acknowledgement instead of Discord's "This interaction failed".
 */
async function runSafely(
  client: any,
  interaction: any,
  label: string,
  run: () => Promise<void>,
): Promise<void> {
  const errorId = newErrorId();
  try {
    await run();
  } catch (error) {
    bumpCounter('errors');
    recordActivity('error', `${label} interaction failed`, {
      level: 'error',
      meta: { customId: interaction.customId, errorId, guildId: interaction.guildId },
    });
    client.logger?.error(
      { err: error, errorId, customId: interaction.customId, guildId: interaction.guildId },
      `${label} interaction failed`,
    );
    await replyError(interaction, 'Something went wrong while handling that.', errorId);
  }
}

/* -------------------------------------------------------------------------- */
/* Modal submissions                                                          */
/* -------------------------------------------------------------------------- */

async function handleModalSubmit(client: any, interaction: any): Promise<void> {
  const { customId } = interaction;

  if (customId.startsWith('automod_config:')) {
    await handleAutomodConfigModal(interaction);
    return;
  }

  if (customId.startsWith('tag_embed:')) {
    await handleTagEmbedModal(interaction);
    return;
  }
}

/* -------------------------------------------------------------------------- */
/* Button interactions                                                        */
/* -------------------------------------------------------------------------- */

async function handleButtonInteraction(client: any, interaction: any): Promise<void> {
  const { customId } = interaction;

  // Reaction roles
  if (customId.startsWith('rr:')) {
    await handleReactionRoleButton(interaction);
    return;
  }

  // Suggestion votes
  if (customId.startsWith('suggest_')) {
    await handleSuggestionVote(interaction);
    return;
  }

  // Ticket system
  if (customId.startsWith('ticket_create:')) {
    await handleTicketCreate(client, interaction);
    return;
  }

  if (customId === 'ticket_close') {
    await handleTicketCloseButton(interaction);
    return;
  }

  if (customId.startsWith('vc_join:')) {
    await handleVcJoin(client, interaction);
    return;
  }
}

/* -------------------------------------------------------------------------- */
/* Select menu interactions                                                   */
/* -------------------------------------------------------------------------- */

async function handleSelectMenuInteraction(client: any, interaction: any): Promise<void> {
  const { customId } = interaction;

  // Reaction roles
  if (customId.startsWith('rr_select:')) {
    await handleReactionRoleSelect(interaction);
    return;
  }
}

/* -------------------------------------------------------------------------- */
/* Ticket button interactions                                                 */
/* -------------------------------------------------------------------------- */

async function handleTicketCreate(client: any, interaction: any): Promise<void> {
  await interaction.deferReply({ flags: 64 });

  const guild = interaction.guild;
  const user = interaction.user;
  if (!guild) {
    await interaction.editReply({ content: '❌ Server-only.' });
    return;
  }

  // Parse department id from custom id: ticket_create:<departmentId>
  const deptId = interaction.customId.split(':')[1];
  if (!deptId || !Types.ObjectId.isValid(deptId)) {
    await interaction.editReply({ content: '❌ Invalid ticket department.' });
    return;
  }

  const department = await TicketDepartment.findOne({
    _id: deptId,
    guildId: guild.id,
    isActive: true,
  }).catch(() => null);
  if (!department) {
    await interaction.editReply({ content: '❌ That department is not available.' });
    return;
  }

  const config = await TicketConfig.findOne({ guildId: guild.id });
  const maxTickets = config?.maxTicketsPerUser ?? 3;
  const cooldownSeconds = config?.cooldownSeconds ?? 0;

  // Cooldown per user per guild.
  if (cooldownSeconds > 0) {
    const key = `${guild.id}:${user.id}`;
    const last = ticketCreateCooldowns.get(key) ?? 0;
    const remaining = last + cooldownSeconds * 1000 - Date.now();
    if (remaining > 0) {
      await interaction.editReply({
        content: `❌ Slow down. You can open another ticket in ${(remaining / 1000).toFixed(0)}s.`,
      });
      return;
    }
  }

  // Check if user already has an open ticket in this guild
  const existing = await OpenTicket.findOne({
    guildId: guild.id,
    userId: user.id,
    closedAt: null,
  });
  if (existing) {
    const channel = guild.channels.cache.get(existing.channelId);
    await interaction.editReply({
      content: `❌ You already have an open ticket: ${channel?.toString() ?? 'a channel'}.`,
    });
    return;
  }

  const totalOpen = await OpenTicket.countDocuments({
    guildId: guild.id,
    userId: user.id,
    closedAt: null,
  });
  if (totalOpen >= maxTickets) {
    await interaction.editReply({
      content: `❌ You already have the maximum of ${maxTickets} open ticket(s). Close one before opening another.`,
    });
    return;
  }

  const overwrites: Record<string, any> = {
    [guild.id]: { ViewChannel: false }, // hide from @everyone
    [user.id]: {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
      AttachFiles: true,
    },
    [client.user.id]: {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
      ManageChannels: true,
    },
  };

  // Department staff role gets access
  if (department.staffRoleId) {
    overwrites[department.staffRoleId] = {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
    };
  }

  // Allow staff with ManageGuild to see all tickets
  for (const role of guild.roles.cache.values()) {
    if (role.permissions.has('ManageGuild') && !role.managed) {
      overwrites[role.id] = { ViewChannel: true, SendMessages: true, ReadMessageHistory: true };
    }
  }

  let channel: TextChannel | null = null;
  let ticketCreated = false;
  try {
    // Sanitize the channel name: Discord limits (100 chars, lowercase,
    // [a-z0-9-]) apply to the *whole* name, not just the department part —
    // a raw username with spaces/unicode would 400 the create.
    const safeDept = department.name
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 30);
    const safeUser = user.username
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '')
      .slice(0, 20);
    const channelName = `ticket-${safeDept || 'support'}-${safeUser || 'user'}`.slice(0, 100);
    channel = (await guild.channels.create({
      name: channelName,
      type: 0, // GuildText
      topic: `Support ticket for ${user.tag} (${user.id}) • ${department.name}`,
      permissionOverwrites: overwrites,
      reason: `Ticket created by ${user.tag} in ${department.name}`,
    })) as TextChannel;

    // Roll back the channel if the DB write fails so we never orphan a
    // channel without a ticket row (which would permanently lock the user out).
    await OpenTicket.create({
      guildId: guild.id,
      channelId: channel!.id,
      userId: user.id,
      departmentId: department._id.toString(),
      departmentName: department.name,
    });
    ticketCreated = true;

    // Record the cooldown timestamp only after a successful create.
    if (cooldownSeconds > 0) {
      ticketCreateCooldowns.set(`${guild.id}:${user.id}`, Date.now());
    }

    const closeButton = new ButtonBuilder()
      .setCustomId('ticket_close')
      .setLabel('Close Ticket')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🔒');

    const closeRow = new ActionRowBuilder().addComponents(closeButton);

    // Department welcome message, with {user} placeholder
    const welcome = (department.welcomeMessage ?? '').replace(/\{user\}/g, `<@${user.id}>`);

    const welcomeEmbed = new EmbedBuilder()
      .setColor(department.color ?? 0x5865f2)
      .setTitle(`${department.emoji ?? '🎫'} Ticket Opened — ${department.name}`)
      .setDescription(welcome || `Ticket # opened for ${user.tag}.`)
      .setFooter({ text: '愛 Bella Star • Tickets' })
      .setTimestamp();

    await channel!.send({
      content: `<@${user.id}> Your ticket has been opened. Support staff will be with you shortly.`,
      embeds: [welcomeEmbed],
      components: [closeRow.toJSON()],
    });

    await interaction.editReply({
      content: `✅ Ticket created: ${channel} (${department.name}).`,
    });
  } catch (error) {
    if (channel) {
      try {
        await (channel as any).delete();
      } catch {}
    }
    // If the ticket row was created but channel send failed afterwards,
    // delete the row too — otherwise the user is permanently locked out
    // ("already have an open ticket" with no visible channel).
    if (ticketCreated && channel) {
      await OpenTicket.deleteOne({
        guildId: guild.id,
        channelId: channel.id,
        closedAt: null,
      }).catch(() => undefined);
    }
    await interaction.editReply({
      content: '❌ Failed to create ticket channel.',
    });
  }
}

async function handleTicketCloseButton(interaction: any): Promise<void> {
  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({ content: '❌ Server-only.', flags: 64 });
    return;
  }

  await interaction.deferReply({ flags: 64 });

  const ticket = await getTicketByChannel(guild.id, interaction.channelId);
  if (!ticket) {
    await interaction.editReply({ content: '❌ This is not an open ticket channel.', flags: 64 });
    return;
  }

  const config = await TicketConfig.findOne({ guildId: guild.id });
  // Same gate as `/ticket close`: only the owner or staff may close.
  const member = interaction.member as any;
  if (!canCloseTicket(member, ticket, config?.staffRoleIds ?? [])) {
    await interaction.editReply({
      content: '❌ Only the ticket owner or support staff can close this ticket.',
      flags: 64,
    });
    return;
  }

  await closeTicket(interaction.client, ticket, {
    reason: 'Manual close',
    closedBy: interaction.user.id,
    closeReason: 'manual',
    sendTranscript: true,
    dmTranscript: config?.dmTranscript ?? false,
  });

  await interaction.editReply({ content: '🔒 Closing ticket and saving transcript.', flags: 64 });
}

async function handleVcJoin(client: any, interaction: any): Promise<void> {
  await interaction.deferReply({ flags: 64 });

  const guild = interaction.guild;
  const member = interaction.member as any;
  const user = interaction.user;
  if (!guild) {
    await interaction.editReply({ content: '❌ Server-only.' });
    return;
  }

  const panelId = interaction.customId.split(':')[1];
  if (!panelId) {
    await interaction.editReply({ content: '❌ Invalid VC panel.' });
    return;
  }

  const panel = await readVcPanelById(panelId);
  if (!panel || panel.guildId !== guild.id) {
    await interaction.editReply({ content: '❌ That VC panel no longer exists.' });
    return;
  }

  // One panel serves all voice channels: join the tapping user's current VC.
  const channelId = member?.voice?.channel?.id ?? null;
  if (!channelId) {
    await interaction.editReply({
      content: '❌ You are not in a voice channel. Join one first, then tap again.',
    });
    return;
  }

  const channel = guild.channels.cache.get(channelId);
  if (!channel || !channel.isVoiceBased()) {
    await interaction.editReply({ content: '❌ Your voice channel could not be found.' });
    return;
  }

  const me = guild.members.me;
  const permissions = me ? channel.permissionsFor(me) : null;
  if (permissions && !permissions.has(['Connect', 'Speak'])) {
    await interaction.editReply({
      content: `❌ I need **Connect** and **Speak** permissions in ${channel}.`,
    });
    return;
  }

  // Disconnect any existing voice session for this guild (one connection at a time).
  if (isVoiceConnected(guild.id)) {
    disconnectVoice(guild.id);
  }

  try {
    await connectVoice(guild as any, channelId);
    await interaction.editReply({
      content: `🔊 愛 Bella Star has joined **${channel.name}**! Use \`/voice leave\` to disconnect.`,
    });
  } catch (error) {
    await interaction.editReply({
      content: '❌ Could not join the voice channel: ' + (error instanceof Error ? error.message : String(error)),
    });
  }
}