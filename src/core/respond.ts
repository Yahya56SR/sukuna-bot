import { MessageFlags } from 'discord.js';

/** Minimal shape of a Discord interaction that we need to report errors on. */
export interface ErrorTarget {
  reply?: (opts: any) => Promise<unknown>;
  followUp?: (opts: any) => Promise<unknown>;
  editReply?: (opts: any) => Promise<unknown>;
  respond?: (opts: any) => Promise<unknown>;
  deferred?: boolean;
  replied?: boolean;
}

/**
 * Send an ephemeral error message without ever throwing.
 *
 * Discord only allows one initial `reply`, so once the interaction has been
 * acknowledged we switch to `editReply` (deferred) or `followUp` (replied).
 * Previously every post-reply error was silently dropped, which is how ticket
 * close failures ended up with no channel deletion and no log line.
 */
export async function replyError(
  interaction: ErrorTarget,
  message: string,
  errorId?: string,
): Promise<void> {
  const content = errorId ? `${message} (ref: ${errorId})` : message;

  // Autocomplete interactions only support `respond()` — `reply`/`followUp`/
  // `editReply` do not exist on them and the interaction would time out.
  if ((interaction as any).respond) {
    try {
      await (interaction as any).respond([]);
    } catch {
      /* expired */
    }
    return;
  }

  try {
    if (interaction.deferred && !interaction.replied && interaction.editReply) {
      await interaction.editReply({ content });
      return;
    }

    if (interaction.replied && interaction.followUp) {
      await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
      return;
    }

    if (interaction.reply) {
      await interaction.reply({ content, flags: MessageFlags.Ephemeral });
      return;
    }

    if (interaction.editReply) {
      await interaction.editReply({ content });
    }
  } catch {
    /* Interaction already expired or acknowledged elsewhere — nothing left to do. */
  }
}
