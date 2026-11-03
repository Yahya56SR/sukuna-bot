/**
 * Discord voice for the persona.
 *
 * One connection + player per guild, with two possible modes:
 *
 * - `duplex` — the bot hears the voice channel and answers out loud through a
 *   live Gemini session (voice/conversation.ts). Preferred when a Gemini key is
 *   configured.
 * - `tts` — fallback: the bot only reads the replies it posts in text channels
 *   (voice/speech.ts).
 *
 * Opt-in: nothing happens until `/voice join` is used.
 */

import {
  AudioPlayerStatus,
  StreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  getVoiceConnection,
  joinVoiceChannel,
  type AudioPlayer,
  type VoiceConnection,
} from '@discordjs/voice';
import type { Guild } from 'discord.js';
import { DEFAULT_DISPLAY_NAME, getSukunaConfig } from '../config/index.js';
import { buildSukunaVoicePrompt } from '../prompts/sukuna.js';
import { VoiceConversation } from './conversation.js';
import { createSpeechStream, resolveVoiceName, sanitizeForSpeech, type SpeechOptions } from './speech.js';

const MAX_QUEUE = 5;
const READY_TIMEOUT_MS = 30_000;
/** Safety net: a stuck encoder must never block the whole queue forever. */
const PLAYBACK_TIMEOUT_MS = 90_000;

export type VoiceMode = 'duplex' | 'tts';

interface QueuedSpeech {
  text: string;
  options: SpeechOptions;
}

interface GuildVoiceSession {
  channelId: string;
  connection: VoiceConnection;
  player: AudioPlayer;
  mode: VoiceMode;
  conversation?: VoiceConversation;
  queue: QueuedSpeech[];
  draining: boolean;
}

const sessions = new Map<string, GuildVoiceSession>();

export interface VoiceStatus {
  connected: boolean;
  channelId: string | null;
  mode: VoiceMode | null;
  queued: number;
  speaking: boolean;
  listening: number;
}

export function voiceStatus(guildId: string): VoiceStatus {
  const session = sessions.get(guildId);
  return {
    connected: Boolean(session),
    channelId: session?.channelId ?? null,
    mode: session?.mode ?? null,
    queued: session?.queue.length ?? 0,
    speaking: session?.conversation?.speaking ?? Boolean(session?.draining),
    listening: session?.conversation?.listenerCount ?? 0,
  };
}

export function isVoiceConnected(guildId: string): boolean {
  return sessions.has(guildId);
}

/**
 * Joins (or moves to) a voice channel and prepares a fresh player.
 * Throws a user-readable error when Discord refuses the connection.
 */
export async function connectVoice(guild: Guild, channelId: string): Promise<VoiceStatus> {
  const existing = sessions.get(guild.id);
  if (existing && existing.channelId === channelId) {
    return voiceStatus(guild.id);
  }

  if (existing) disconnectVoice(guild.id);
  getVoiceConnection(guild.id)?.destroy();

  const connection = joinVoiceChannel({
    channelId,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
    // Not deafened: the duplex conversation decodes member audio through the
    // receiver, which some hosts skip when the client joins deafened.
    selfDeaf: false,
    selfMute: false,
  });

  const player = createAudioPlayer();
  const session: GuildVoiceSession = {
    channelId,
    connection,
    player,
    mode: 'tts',
    queue: [],
    draining: false,
  };
  sessions.set(guild.id, session);

  connection.subscribe(player);
  connection.on('error', (error) => {
    console.warn('[Voice] Connection error:', error instanceof Error ? error.message : error);
  });

  // Keep the reason around: Discord's voice server closes with a code that says
  // exactly why it refused (4014 = kicked/unauthorised, 4016 = bad session,
  // 4017 = the channel requires DAVE/E2EE, ...).
  let lastFailure = '';
  connection.on('stateChange', (_previous, next) => {
    if (next.status !== VoiceConnectionStatus.Disconnected) return;
    const closeCode = 'closeCode' in next ? `, close code ${next.closeCode}` : '';
    lastFailure = `disconnected (reason: ${next.reason}${closeCode})`;
    console.warn('[Voice] Connection lost:', lastFailure);
  });  connection.on(VoiceConnectionStatus.Destroyed, () => {
    if (sessions.get(guild.id) !== session) return;
    session.conversation?.stop();
    sessions.delete(guild.id);
  });
  // @discordjs/voice recovers from channel moves and websocket resets by itself.
  // If it has not recovered after a grace period, drop the session so the next
  // /voice join starts from a clean state.
  connection.on(VoiceConnectionStatus.Disconnected, () => {
    const timer = setTimeout(() => {
      if (sessions.get(guild.id) !== session) return;
      if (connection.state.status === VoiceConnectionStatus.Ready) return;
      console.warn('[Voice] Connection lost for too long, leaving the channel');
      disconnectVoice(guild.id);
    }, 15_000);
    timer.unref?.();
    connection.once(VoiceConnectionStatus.Ready, () => clearTimeout(timer));
  });
  player.on('error', (error) => {
    console.warn('[Voice] Playback error:', error instanceof Error ? error.message : error);
  });

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, READY_TIMEOUT_MS);
  } catch (error) {
    const stuckAt = connection.state.status;
    connection.destroy();
    if (sessions.get(guild.id) === session) sessions.delete(guild.id);
    throw new Error(
      'Discord refused the voice connection' +
        (lastFailure ? ` — ${lastFailure}` : ` — stuck in "${stuckAt}"`) +
        '. Check the Connect and Speak permissions for that channel.',
      { cause: error },
    );
  }

  session.mode = (await startDuplex(session, guild)) ? 'duplex' : 'tts';
  return voiceStatus(guild.id);
}

/**
 * The bot was dragged to another voice channel, or removed from voice, by a
 * member. `@discordjs/voice` keeps the same connection across a move, so the
 * Live conversation would otherwise keep running with the previous channel's
 * context. Restart it for the channel the bot now sits in.
 */
export function handleBotVoiceMove(guild: Guild, channelId: string | null): void {
  const session = sessions.get(guild.id);
  if (!session) return;
  if (session.channelId === channelId) return;

  if (!channelId) {
    // Kicked or disconnected from voice: drop the conversation with it.
    disconnectVoice(guild.id);
    return;
  }

  const previous = session.conversation;
  session.conversation = undefined;
  session.queue.length = 0;
  session.channelId = channelId;
  session.mode = 'tts';
  previous?.stop();

  console.log('[Voice] Moved to another channel — starting a fresh conversation', {
    guildId: guild.id,
    channelId,
  });

  void startDuplex(session, guild)
    .then((ok) => {
      if (sessions.get(guild.id) !== session) return;
      session.mode = ok ? 'duplex' : 'tts';
    })
    .catch(() => {
      if (sessions.get(guild.id) === session) session.mode = 'tts';
    });
}

/** Leaves the channel for this guild. Returns true when a connection existed. */
export function disconnectVoice(guildId: string): boolean {
  const session = sessions.get(guildId);
  if (!session) {
    getVoiceConnection(guildId)?.destroy();
    return false;
  }

  sessions.delete(guildId);
  session.conversation?.stop();
  session.conversation = undefined;
  session.queue.length = 0;
  try {
    session.player.stop(true);
  } catch {
    /* player already gone */
  }
  session.connection.destroy();
  return true;
}

/**
 * Queues one line to be read out loud. Only used in `tts` mode: in duplex mode
 * the model speaks for itself, so text replies stay silent.
 */
export function speakInVoice(guildId: string, text: string, options: SpeechOptions): boolean {
  const session = sessions.get(guildId);
  if (!session || session.mode !== 'tts') return false;

  // Emoji-only or mention-only replies have nothing to say.
  const clean = sanitizeForSpeech(text);
  if (!clean) return false;

  // Newest replies matter most: drop the oldest pending line when saturated.
  if (session.queue.length >= MAX_QUEUE) session.queue.shift();
  session.queue.push({ text: clean, options });
  void drain(guildId);
  return true;
}

/** Destroys every voice connection (shutdown path). */
export function shutdownVoice(): void {
  for (const guildId of [...sessions.keys()]) {
    disconnectVoice(guildId);
  }
}

/**
 * Best effort: open the duplex conversation. A missing key, a non-Live model or
 * a rejected session must not take the voice connection down with it — the bot
 * simply falls back to reading its text replies.
 */
async function startDuplex(session: GuildVoiceSession, guild: Guild): Promise<boolean> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || process.env.SUKUNA_VOICE_DUPLEX === 'false') return false;

  const config = getSukunaConfig();
  const channelName = guild.channels.cache.get(session.channelId)?.name ?? 'voice';

  const conversation = new VoiceConversation({
    connection: session.connection,
    player: session.player,
    apiKey,
    model: config.model,
    voiceName: resolveVoiceName(),
    thinkingLevel: config.thinkingLevel,
    systemPrompt: buildSukunaVoicePrompt({
      displayName: config.displayName || DEFAULT_DISPLAY_NAME,
      guildName: guild.name,
      channelName,
      character: config.systemPrompt,
    }),
    onStopped: () => {
      if (sessions.get(guild.id) !== session) return;
      if (session.conversation !== conversation) return;
      session.conversation = undefined;
      session.mode = 'tts';
      console.warn('[Voice] Live conversation gave up; reading text replies instead');
    },
  });

  try {
    await conversation.start();
  } catch (error) {
    console.warn(
      '[Voice] Live conversation unavailable, falling back to reading replies:',
      error instanceof Error ? error.message : error,
    );
    return false;
  }

  if (sessions.get(guild.id) !== session) {
    conversation.stop();
    return false;
  }

  session.conversation = conversation;
  return true;
}

async function drain(guildId: string): Promise<void> {
  const session = sessions.get(guildId);
  if (!session || session.draining) return;

  session.draining = true;
  try {
    while (sessions.get(guildId) === session && session.queue.length > 0) {
      if (session.connection.state.status === VoiceConnectionStatus.Destroyed) break;

      const item = session.queue.shift();
      if (!item) break;

      let stream;
      try {
        stream = createSpeechStream(item.text, item.options);
      } catch (error) {
        console.warn('[Voice] Could not start speech:', error instanceof Error ? error.message : error);
        continue;
      }

      session.player.play(createAudioResource(stream, { inputType: StreamType.Raw }));

      try {
        await entersState(session.player, AudioPlayerStatus.Idle, PLAYBACK_TIMEOUT_MS);
      } catch {
        // Stuck or failed resource: skip it so the queue can keep moving.
        try {
          session.player.stop(true);
        } catch {
          /* ignore */
        }
      }
    }
  } catch (error) {
    console.warn('[Voice] Playback loop failed:', error instanceof Error ? error.message : error);
  } finally {
    if (sessions.get(guildId) === session) session.draining = false;
  }
}
