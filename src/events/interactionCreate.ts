import {
  Events,
  type ClientEvents,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { takeCooldown } from '../core/cooldowns.js';
import { newErrorId, UserFacingError } from '../core/errors.js';
import { bumpCounter, recordActivity } from '../core/metrics.js';
import { replyError } from '../core/respond.js';
import { TicketPanel, OpenTicket } from '../db/models/Ticket.js';

export const interactionCreate = {
  name: Events.InteractionCreate as keyof ClientEvents,
  execute: async (client: any, interaction: any) => {
    // Handle button interactions (ticket system)
    if (interaction.isButton()) {
      await handleButtonInteraction(client, interaction);
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    const guildId = interaction.guildId;
    if (!guildId) {
      await replyError(interaction, "爱 Doctora only works inside a Discord server.");
      return;
    }

    const errorId = newErrorId();
    const config = await client.getConfig(guildId);
    const premium = false; // kept for parity; premium system not ported yet

    try {
      if (!client.isCategoryEnabled(command.category, config) && !command.allowWhenDisabled) {
        await replyError(interaction, `**/${command.data.name}** is disabled on this server.`);
        return;
      }

      if (command.userPermissions?.length) {
        const missing = interaction.memberPermissions?.missing(command.userPermissions) ?? [];
        if (missing.length > 0) {
          await replyError(
            interaction,
            `You need the following permissions: ${missing.join(", ")}.`,
          );
          return;
        }
      }

      if (command.botPermissions?.length && interaction.appPermissions) {
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
/* Ticket button interactions                                                 */
/* -------------------------------------------------------------------------- */

async function handleButtonInteraction(client: any, interaction: any): Promise<void> {
  const { customId } = interaction;

  if (customId === 'ticket_create') {
    await handleTicketCreate(client, interaction);
    return;
  }

  if (customId === 'ticket_close') {
    await handleTicketCloseButton(interaction);
    return;
  }
}

async function handleTicketCreate(client: any, interaction: any): Promise<void> {
  await interaction.deferReply({ flags: 64 });

  const guild = interaction.guild;
  const user = interaction.user;
  if (!guild) {
    await interaction.editReply({ content: '❌ Server-only.' });
    return;
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

  // Find the panel to confirm this interaction is valid
  const panel = await TicketPanel.findOne({ guildId: guild.id });
  if (!panel) {
    await interaction.editReply({ content: '❌ No ticket panel is configured.' });
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

  // Allow staff with ManageGuild to see all tickets
  for (const role of guild.roles.cache.values()) {
    if (role.permissions.has('ManageGuild') && !role.managed) {
      overwrites[role.id] = { ViewChannel: true, SendMessages: true, ReadMessageHistory: true };
    }
  }

  try {
    const channel = await guild.channels.create({
      name: `ticket-${user.username}`,
      type: 0, // GuildText
      topic: `Support ticket for ${user.tag} (${user.id})`,
      parent: undefined,
      permissionOverwrites: overwrites,
      reason: `Ticket created by ${user.tag}`,
    });

    await OpenTicket.create({
      guildId: guild.id,
      channelId: channel.id,
      userId: user.id,
    });

    const closeButton = new ButtonBuilder()
      .setCustomId('ticket_close')
      .setLabel('Close Ticket')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🔒');

    const closeRow = new ActionRowBuilder().addComponents(closeButton);

    await channel.send({
      content: `<@${user.id}> Your ticket has been opened. Support staff will be with you shortly. Use the button below to close the ticket when done.`,
      components: [closeRow],
    });

    await interaction.editReply({
      content: `✅ Ticket created: ${channel}.`,
    });
  } catch (error) {
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

  const ticket = await OpenTicket.findOne({
    guildId: guild.id,
    channelId: interaction.channelId,
    closedAt: null,
  });
  if (!ticket) {
    await interaction.reply({
      content: '❌ This is not an open ticket channel.',
      flags: 64,
    });
    return;
  }

  await OpenTicket.updateOne(
    { guildId: guild.id, channelId: interaction.channelId },
    { closedAt: new Date() },
  );

  await interaction.reply({
    content: '🔒 This ticket is being closed. The channel will be deleted in 10 seconds...',
  });

  setTimeout(async () => {
    try {
      await (interaction.channel as any).delete();
    } catch {
      /* channel already deleted or missing permissions */
    }
  }, 10_000);
}
