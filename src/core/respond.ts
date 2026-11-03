import { MessageFlags } from 'discord.js';

export async function replyError(
  interaction: { reply: (opts: any) => Promise<unknown> },
  message: string,
  errorId?: string,
): Promise<void> {
  const content = errorId ? `${message} (ref: ${errorId})` : message;
  await interaction
    .reply({ content, flags: MessageFlags.Ephemeral })
    .catch(() => {});
}
