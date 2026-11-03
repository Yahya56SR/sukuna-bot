/**
 * Sukuna information tools for the Gemini Live session.
 *
 * The decision tools (`send_message`, `send_sticker`, `stay_silent`) live in
 * `core/gemini-live.ts` because they end the turn. Everything here only gathers
 * context or stores memory, then the model is free to decide.
 */

import { Type, type FunctionDeclaration } from '@google/genai';
import { PermissionFlagsBits } from 'discord.js';
import type {
  Client,
  DMChannel,
  Guild,
  GuildMember,
  Message,
  TextChannel,
} from 'discord.js';
import type { SukunaConfig } from '../config/index.js';
import type { SukunaToolCall, SukunaToolExecutor } from '../core/gemini-live.js';
import { addMemory, countMemories, searchMemories } from './sukuna-memory.js';

const DM_MAX_CHARS = 1_500;
const DM_RATE_LIMIT_PER_HOUR = 10;
const DM_MIN_INTERVAL_PER_USER_MS = 60_000;

/** guildId → timestamps of delivered DMs in the last hour. */
const dmTimestamps = new Map<string, number[]>();
/** `${guildId}:${userId}` → when the last DM to that member was delivered. */
const dmPerUser = new Map<string, number>();

export interface SukunaToolContext {
  client: Client;
  /** Null during a DM when the member shares no server with the bot. */
  guild: Guild | null;
  channel: TextChannel | DMChannel;
  trigger?: Message | null;
}

/**
 * Build the information-tool declarations advertised to the Live session.
 * Must stay in sync with `buildSukunaRuntimePrompt` and `handleTool`.
 */
export function buildSukunaToolDeclarations(cfg: SukunaConfig): FunctionDeclaration[] {
  const tools: FunctionDeclaration[] = [
    {
      name: 'get_server_info',
      description: 'Get server information (name, member count, creation date, owner).',
      parameters: { type: Type.OBJECT, properties: {} },
    },
    {
      name: 'get_channel_info',
      description: 'Get information about the current channel (name, topic, category).',
      parameters: { type: Type.OBJECT, properties: {} },
    },
    {
      name: 'get_member_info',
      description:
        'Get display name, roles, join date and account age for a member. Omit "user" to inspect whoever triggered this turn.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          user: {
            type: Type.STRING,
            description: 'A member id, mention or username. Omit for the triggering member.',
          },
        },
      },
    },
    {
      name: 'get_recent_messages',
      description: 'Read recent messages in the current channel.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          limit: { type: Type.INTEGER, description: 'How many messages to read (1-25).' },
        },
      },
    },
    {
      name: 'search_discord_messages',
      description: 'Search recent messages in the current channel for a keyword.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          query: { type: Type.STRING, description: 'Keyword or phrase to look for.' },
          limit: { type: Type.INTEGER, description: 'How many recent messages to scan (1-100).' },
        },
        required: ['query'],
      },
    },
    {
      name: 'get_server_stickers',
      description: 'List this server\'s stickers with their ids, for use with send_sticker.',
      parameters: { type: Type.OBJECT, properties: {} },
    },
    {
      name: 'send_dm',
      description:
        'Send one private direct message to a member of this server. You may only DM the member who triggered this turn, someone they @mentioned, or any member when a moderator asks you to. This is a side effect: the turn still ends with a decision tool (usually stay_silent).',
      parameters: {
        type: Type.OBJECT,
        properties: {
          user: {
            type: Type.STRING,
            description:
              'Member id, @mention or username to message. Omit to DM the member who triggered this turn.',
          },
          message: {
            type: Type.STRING,
            description: 'The exact private message to send (max 1500 characters).',
          },
        },
        required: ['message'],
      },
    },
  ];

  if (cfg.memoryEnabled) {
    tools.push(
      {
        name: 'remember_information',
        description: 'Store a durable note about a member, a running joke or a server event.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            fact: { type: Type.STRING, description: 'Fact to remember (max 400 characters).' },
            about: {
              type: Type.STRING,
              description: 'Member id, mention, username or topic the fact is about.',
            },
          },
          required: ['fact'],
        },
      },
      {
        name: 'search_memory',
        description: 'Search notes previously stored for this server.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            query: { type: Type.STRING, description: 'Keyword to search for.' },
            limit: { type: Type.INTEGER, description: 'How many notes to return (1-100).' },
          },
        },
      },
    );
  }

  return tools;
}

/**
 * Create a tool executor for non-decision tool calls coming from the Live session.
 */
export function createSukunaToolExecutor(context: SukunaToolContext): SukunaToolExecutor {
  return async (call: SukunaToolCall): Promise<Record<string, unknown>> => {
    const name = call.name ?? '';
    const args = call.args ?? {};

    try {
      return await handleTool(name, args, context);
    } catch (error) {
      console.error('[Sukuna Tool] Failed: ' + String(error));
      return { ok: false, error: String(error) };
    }
  };
}

async function handleTool(
  name: string,
  args: Record<string, unknown>,
  context: SukunaToolContext,
): Promise<Record<string, unknown>> {
  const { guild, channel, trigger } = context;

  switch (name) {
    case 'get_server_info':
      if (!guild) {
        return { ok: false, error: 'You are in a direct message, so there is no server context here.' };
      }

      return {
        ok: true,
        name: guild.name,
        id: guild.id,
        memberCount: guild.memberCount,
        createdAt: guild.createdAt.toISOString(),
        ownerId: guild.ownerId,
      };

    case 'get_channel_info':
      if (channel.isDMBased()) {
        return {
          ok: true,
          kind: 'dm',
          with: trigger?.author.tag ?? null,
          id: channel.id,
        };
      }

      return {
        ok: true,
        kind: 'channel',
        id: channel.id,
        name: channel.name,
        topic: channel.topic ?? null,
        category: channel.parent?.name ?? null,
        nsfw: channel.nsfw ?? false,
        position: channel.position ?? null,
      };

    case 'get_member_info': {
      if (!guild) {
        return { ok: false, error: 'Member details need a shared server; this DM has none.' };
      }

      const raw = typeof args.user === 'string' ? args.user : '';
      const member =
        (raw ? await resolveMember(guild, raw) : null) ??
        trigger?.member ??
        (trigger ? guild.members.cache.get(trigger.author.id) ?? null : null);
      if (!member) return { ok: false, error: 'Member not found.' };

      return {
        ok: true,
        id: member.id,
        displayName: member.displayName,
        username: member.user.username,
        bot: member.user.bot,
        roles: member.roles.cache
          .filter((role) => role.id !== guild.id)
          .map((role) => role.name)
          .slice(0, 25),
        joinedAt: member.joinedAt?.toISOString() ?? null,
        accountCreatedAt: member.user.createdAt.toISOString(),
      };
    }

    case 'get_recent_messages': {
      const limit = clampInt(args.limit, 1, 25, 10);
      const messages = await channel.messages.fetch({ limit }).catch(() => null);
      if (!messages) return { ok: false, error: 'Could not read channel history.' };

      return {
        ok: true,
        messages: [...messages.values()].map((m) => ({
          id: m.id,
          authorId: m.author.id,
          authorName: m.member?.displayName ?? m.author.username,
          content: m.content,
          timestamp: m.createdTimestamp,
        })),
      };
    }

    case 'search_discord_messages': {
      const query = typeof args.query === 'string' ? args.query.trim().toLowerCase() : '';
      if (!query) return { ok: false, error: 'A search query is required.' };

      const limit = clampInt(args.limit, 1, 100, 50);
      const messages = await channel.messages.fetch({ limit }).catch(() => null);
      if (!messages) return { ok: false, error: 'Could not read channel history.' };

      const matches = [...messages.values()]
        .filter((m) => m.content.toLowerCase().includes(query))
        .slice(0, 10)
        .map((m) => ({
          id: m.id,
          authorId: m.author.id,
          authorName: m.member?.displayName ?? m.author.username,
          content: m.content.slice(0, 300),
          timestamp: m.createdTimestamp,
        }));

      return { ok: true, query, matches, scanned: messages.size };
    }

    case 'get_server_stickers': {
      if (!guild) {
        return { ok: false, error: 'Stickers belong to a server, and this DM has none.' };
      }

      const stickers = [...guild.stickers.cache.values()].slice(0, 25).map((sticker) => ({
        id: sticker.id,
        name: sticker.name,
        description: sticker.description ?? null,
      }));
      return { ok: true, stickers, total: guild.stickers.cache.size };
    }

    case 'send_dm': {
      if (channel.isDMBased()) {
        return {
          ok: false,
          error: 'You are already in a private DM with this member — just answer with send_message.',
        };
      }
      if (!guild) {
        return { ok: false, error: 'Direct messages need a shared server, and this turn has none.' };
      }

      const text = typeof args.message === 'string' ? args.message.trim() : '';
      if (!text) return { ok: false, error: 'The message argument is required.' };

      const rawTarget = typeof args.user === 'string' ? args.user.trim() : '';
      const member =
        (rawTarget ? await resolveMember(guild, rawTarget) : null) ?? trigger?.member ?? null;

      if (!member) return { ok: false, error: 'Member not found in this server.' };
      if (member.id === context.client.user?.id) {
        return { ok: false, error: 'You cannot DM yourself.' };
      }
      if (member.user.bot) return { ok: false, error: 'Bots cannot receive these DMs.' };

      if (!isDmTargetAllowed(member, trigger)) {
        return {
          ok: false,
          error:
            'You may only DM the member who triggered this turn, someone they mentioned, or a member when a moderator asks. Say it in the channel instead.',
        };
      }

      const blocked = checkDmLimit(guild.id, member.id);
      if (blocked) return { ok: false, error: blocked };

      const content = text.slice(0, DM_MAX_CHARS);

      try {
        await member.send({ content, allowedMentions: { parse: [] } });
      } catch (error) {
        const code = (error as { code?: number }).code;
        console.warn('[Sukuna] DM failed:', member.user.tag, code ?? String(error));

        if (code === 50007) {
          return {
            ok: false,
            error:
              'This member has direct messages closed, so the DM was not delivered. Tell them in the channel instead.',
          };
        }
        return { ok: false, error: 'The DM could not be delivered.' };
      }

      recordDm(guild.id, member.id);

      console.log('[Sukuna] DM sent', {
        guild: guild.name,
        to: member.user.tag,
        chars: content.length,
        text: preview(content, 500),
      });

      return { ok: true, delivered: true, to: member.user.tag, chars: content.length };
    }

    case 'remember_information': {
      if (!guild) {
        return { ok: false, error: 'Memory is stored per server, and this DM has no shared server.' };
      }

      const fact = typeof args.fact === 'string' ? args.fact.trim() : '';
      if (!fact) return { ok: false, error: 'Fact is required' };

      const rawAbout = typeof args.about === 'string' ? args.about.trim() : '';
      const member = rawAbout
        ? await resolveMember(guild, rawAbout)
        : trigger?.member ??
          (trigger ? guild.members.cache.get(trigger.author.id) ?? null : null);
      const aboutName = member?.displayName ?? (rawAbout || undefined);

      const note = await addMemory(guild.id, {
        fact,
        aboutUserId: member?.id,
        aboutName,
      });
      return { ok: true, id: note._id?.toString() ?? String(Date.now()), fact: note.fact };
    }

    case 'search_memory': {
      if (!guild) {
        return { ok: false, error: 'Memory is stored per server, and this DM has no shared server.' };
      }

      const query = typeof args.query === 'string' ? args.query.trim() : '';
      const limit = clampInt(args.limit, 1, 100, 10);
      const memories = await searchMemories(guild.id, query, limit);

      return {
        ok: true,
        notes: memories.map((note) => ({
          fact: note.fact,
          aboutName: note.aboutName ?? null,
          createdAt: new Date(note.createdAt).toISOString(),
        })),
        total: await countMemories(guild.id),
      };
    }

    default:
      return { ok: false, error: 'Unknown tool: ' + name };
  }
}

/**
 * A DM is only allowed to the member who asked, someone they mentioned, or any
 * member when a moderator is the one asking. This stops prompt-injected or
 * history-derived targets from being mass-messaged.
 */
function isDmTargetAllowed(member: GuildMember, trigger?: Message | null): boolean {
  if (!trigger) return false;
  if (trigger.author.id === member.id) return true;
  if (trigger.mentions.members?.has(member.id)) return true;

  const haystack = trigger.content?.toLowerCase() ?? '';
  for (const candidate of [member.user.username, member.displayName]) {
    const needle = candidate.toLowerCase();
    if (needle.length >= 3 && haystack.includes(needle)) return true;
  }

  return trigger.member?.permissions.has(PermissionFlagsBits.ManageGuild) ?? false;
}

/** Returns an error string when a DM must be refused, otherwise null. */
function checkDmLimit(guildId: string, userId: string): string | null {
  const now = Date.now();

  const recent = (dmTimestamps.get(guildId) ?? []).filter((at) => now - at < 60 * 60 * 1000);
  dmTimestamps.set(guildId, recent);
  if (recent.length >= DM_RATE_LIMIT_PER_HOUR) {
    return `DM limit reached (${DM_RATE_LIMIT_PER_HOUR} per hour). Do not retry and do not announce it.`;
  }

  const last = dmPerUser.get(guildId + ':' + userId) ?? 0;
  if (now - last < DM_MIN_INTERVAL_PER_USER_MS) {
    return 'You already DMed this member a moment ago. Do not send another one.';
  }

  return null;
}

function recordDm(guildId: string, userId: string): void {
  const now = Date.now();
  const recent = (dmTimestamps.get(guildId) ?? []).filter((at) => now - at < 60 * 60 * 1000);
  recent.push(now);
  dmTimestamps.set(guildId, recent);
  dmPerUser.set(guildId + ':' + userId, now);
}

/** Flatten and shorten text for console logging. */
function preview(text: string, max = 600): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (!flat) return '(empty)';
  return flat.length <= max ? flat : `${flat.slice(0, max)}… (${flat.length} chars)`;
}

async function resolveMember(guild: Guild, query: string): Promise<GuildMember | null> {
  const cleaned = query.replace(/[<@!>]/g, '').trim();
  if (!cleaned) return null;

  if (/^\d{15,25}$/.test(cleaned)) {
    const cached = guild.members.cache.get(cleaned);
    if (cached) return cached;
    return guild.members.fetch(cleaned).catch(() => null);
  }

  const needle = cleaned.replace(/^@/, '').trim().toLowerCase();
  if (!needle) return null;

  const cached = guild.members.cache.find(
    (member) =>
      member.displayName.toLowerCase() === needle ||
      member.user.username.toLowerCase() === needle ||
      member.displayName.toLowerCase().includes(needle),
  );
  if (cached) return cached;

  const results = await guild.members.fetch({ query: needle, limit: 5 }).catch(() => null);
  return results?.first() ?? null;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Math.floor(Number(value ?? fallback));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}
