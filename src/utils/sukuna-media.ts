/**
 * Collect image/GIF attachments from messages as visual input for Sukuna.
 */

import type { Message } from 'discord.js';
import type { SukunaMedia } from '../core/gemini-live.js';

const MAX_MEDIA_PER_MESSAGE = 3;

export async function collectSukunaMedia(messages: Message[]): Promise<SukunaMedia[]> {
  const media: SukunaMedia[] = [];

  for (const message of messages) {
    if (media.length >= MAX_MEDIA_PER_MESSAGE) break;

    for (const attachment of message.attachments.values()) {
      if (media.length >= MAX_MEDIA_PER_MESSAGE) break;

      const type = (attachment.contentType ?? '').toLowerCase();
      const name = attachment.name ?? 'attachment';

      if (!type.startsWith('image/') && !type.startsWith('video/') && !name.toLowerCase().endsWith('.gif')) {
        continue;
      }

      try {
        const response = await fetch(attachment.url, { signal: AbortSignal.timeout(8_000) });
        if (!response.ok) continue;

        const buffer = Buffer.from(await response.arrayBuffer());
        const base64 = buffer.toString('base64');

        media.push({
          mimeType: type,
          data: base64,
          label: name,
        });
      } catch {
        /* skip attachment that fails to fetch */
      }
    }
  }

  return media;
}
