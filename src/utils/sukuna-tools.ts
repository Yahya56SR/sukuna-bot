/**
 * Sukuna tool declarations for Gemini.
 */

import { Type, type FunctionDeclaration } from '@google/genai';
import type { TextChannel, Guild, Client, Message } from 'discord.js';
import type { SukunaConfig } from '../config/index.js';

const MAX_TOOL_LIMIT = 25;

export interface SukunaToolContext {
  client: Client;
  guild: Guild;
  channel: TextChannel;
  trigger?: Message | null;
}

export interface SukunaToolCall {
  id?: string;
  name?: string;
  args?: Record<string, unknown>;
}

export type SukunaToolExecutor = (
  call: SukunaToolCall,
) => Promise<Record<string, unknown>>;

/**
 * Build the function declarations for Sukuna's toolset.
 */
export function buildSukunaToolDeclarations(
  ctx: SukunaToolContext,
  cfg: SukunaConfig,
): FunctionDeclaration[] {
  const tools: FunctionDeclaration[] = [];

  // Core Discord tools
  tools.push({
    name: 'get_server_info',
    description: 'Get server information (name, member count, creation date, owner).',
    parameters: { type: Type.OBJECT, properties: {} },
  });
  tools.push({
    name: 'get_recent_messages',
    description: 'Read recent messages in the current channel.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        limit: { type: Type.INTEGER },
      },
    },
  });
  tools.push({
    name: 'send_message',
    description: 'Send a Discord message to the current channel.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        content: { type: Type.STRING },
      },
      required: ['content'],
    },
  });
  tools.push({
    name: 'stay_silent',
    description: 'Choose not to respond this turn.',
    parameters: { type: Type.OBJECT, properties: {} },
  });

  // Memory tools
  if (cfg.memoryEnabled) {
    tools.push({
      name: 'remember_information',
      description: 'Store information about members or events.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          fact: { type: Type.STRING, description: 'Fact to remember' },
          about: { type: Type.STRING, description: 'Member or topic' },
        },
        required: ['fact'],
      },
    });
    tools.push({
      name: 'search_memory',
      description: 'Search stored memories.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          query: { type: Type.STRING },
          limit: { type: Type.INTEGER },
        },
      },
    });
  }

  return tools;
}

/**
 * Create a tool executor for handling Gemini tool calls.
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
      return {
        ok: true,
        name: guild.name,
        id: guild.id,
        memberCount: guild.memberCount,
        createdAt: guild.createdAt.toISOString(),
        ownerId: guild.ownerId,
      };

    case 'get_recent_messages': {
      const limit = Math.min(Math.max(Math.floor(Number(args.limit ?? 10)), 1), 25);
      const messages = await channel.messages.fetch({ limit }).catch(() => new Map());
      return {
        ok: true,
        messages: [...messages.values()].map((m) => ({
          id: m.id,
          authorId: m.author.id,
          content: m.content,
          timestamp: m.createdTimestamp,
        })),
      };
    }

    case 'send_message': {
      const content = args.content as string;
      if (!content) return { ok: false, error: 'Content is required' };
      await channel.send({ content });
      return { ok: true, sent: true };
    }

    case 'stay_silent':
      return { ok: true, silent: true };

    case 'remember_information': {
      const fact = args.fact as string;
      if (!fact) return { ok: false, error: 'Fact is required' };
      const about = args.about as string | undefined;
      const memoryModule = await import('./sukuna-memory.js');
      const note = await memoryModule.addMemory(guild.id, { fact, aboutUserId: about, aboutName: about });
      return { ok: true, id: note._id?.toString() ?? String(Date.now()), fact: note.fact };
    }

    case 'search_memory': {
      const query = args.query as string | undefined;
      const limit = Math.min(Math.max(Math.floor(Number(args.limit ?? 10)), 1), 100);
      const memoryModule = await import('./sukuna-memory.js');
      const memories = await memoryModule.recallMemories(guild.id, { about: query, limit });
      return { 
        ok: true, 
        notes: memories.map((n) => ({ fact: n.fact, createdAt: new Date(n.createdAt).toISOString() })),
        total: await memoryModule.countMemories(guild.id)
      };
    }

    default:
      return { ok: false, error: 'Unknown tool: ' + name };
  }
}