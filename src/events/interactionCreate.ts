import { Events, type ClientEvents } from 'discord.js';
import { takeCooldown } from '../core/cooldowns.js';
import { newErrorId, UserFacingError } from '../core/errors.js';
import { bumpCounter, recordActivity } from '../core/metrics.js';
import { replyError } from '../core/respond.js';

export const interactionCreate = {
  name: Events.InteractionCreate as keyof ClientEvents,
  execute: async (client: any, interaction: any) => {
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
