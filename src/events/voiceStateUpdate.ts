import {
  Events,
  type ClientEvents,
  type VoiceState,
  type Client,
  type Guild,
  type User,
  ChannelType,
} from 'discord.js';
import { addXp } from '../db/utils.js';
import { handleLevelUp } from '../handlers/levelUp.js';
import { randomXp } from '../utils/level.js';
import { readLevelSettings, type LevelSettings } from '../utils/levelSettings.js';
import { handleBotVoiceMove } from '../voice/manager.js';
import {
  readTempVCConfig,
  readActiveTempVCByOwner,
  createActiveTempVC,
  readActiveTempVCByChannel,
  deleteActiveTempVC,
} from '../db/models/TempVC.js';

/** userId -> join timestamp (aligned to minute boundaries as XP is awarded). */
const voiceSessions = new Map<string, number>();

let tickInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Award random XP for a number of minutes spent in voice.
 */
async function awardVoiceXp(
  client: Client,
  userId: string,
  minutes: number,
  guild?: Guild,
  user?: User,
  settings?: LevelSettings,
): Promise<void> {
  if (minutes <= 0 || !guild || !user) return;

  let cfg = settings;
  if (!cfg) {
    const row = await loadGuildConfig(client, guild.id);
    cfg = readLevelSettings(row ?? {});
  }
  if (!cfg.enabled) return;
  if (cfg.ignoreBots && user.bot) return;

  const amount = randomXp(cfg.perVoiceMinuteMin, cfg.perVoiceMinuteMax) * minutes;
  if (amount <= 0) return;

  try {
    const result = await addXp(userId, amount, 'voice', minutes);
    if (result.leveledUp) {
      await handleLevelUp(guild, user, result.newLevel, result.oldLevel, undefined, cfg);
    }
  } catch (err) {
    console.error(`Failed to award voice XP to ${userId}:`, err);
  }
}

async function loadGuildConfig(client: Client, guildId: string): Promise<any> {
  const withConfig = client as unknown as { getConfig?: (id: string) => Promise<any> };
  if (typeof withConfig.getConfig === 'function') {
    return withConfig.getConfig(guildId);
  }
  return null;
}

/**
 * Voice-state listener: track sessions, award on leave/channel move, and seed a
 * fresh session when a member joins.
 */
export async function handleVoiceStateUpdate(
  client: Client,
  oldState: VoiceState,
  newState: VoiceState,
): Promise<void> {
  const userId = newState.member?.user?.id ?? oldState.member?.user?.id;
  if (!userId) return;

  const now = Date.now();
  const changedChannel = oldState.channelId !== newState.channelId;

  // Temp VC: create a channel when a member joins the "create" channel.
  await handleTempVCJoin(newState);

  // Temp VC: delete the channel when it becomes empty.
  if (oldState.channelId && changedChannel) {
    await handleTempVCLeave(oldState);
  }

  // The bot itself was moved to another voice channel (or disconnected): the
  // Live conversation belongs to the old channel, so restart it. Otherwise the
  // two channels would share one conversation.
  const selfId = client.user?.id;
  if (selfId && userId === selfId && changedChannel) {
    const guild = newState.guild ?? oldState.guild;
    if (guild) handleBotVoiceMove(guild, newState.channelId);
  }

  // Left a voice channel, or moved to a different one.
  if (oldState.channelId && changedChannel) {
    const joinTs = voiceSessions.get(userId);
    if (joinTs) {
      const minutes = Math.floor((now - joinTs) / 60000);
      voiceSessions.delete(userId);
      await awardVoiceXp(
        client,
        userId,
        minutes,
        newState.guild ?? oldState.guild,
        newState.member?.user ?? oldState.member?.user,
      );
    }
  }

  // Joined a voice channel, or moved to a new one: start a fresh session.
  // Without this a channel move would end the session and stop all further
  // voice XP until the member left and rejoined.
  if (changedChannel && newState.channelId && newState.member?.user) {
    voiceSessions.set(userId, now);
  }
}

/* -------------------------------------------------------------------------- */
/* Temp VC (join-to-create)                                                   */
/* -------------------------------------------------------------------------- */

/** When a member joins the configured "create" channel, spin up a temp VC. */
async function handleTempVCJoin(newState: VoiceState): Promise<void> {
  const { guild, member, channelId } = newState;
  if (!guild || !member || member.user.bot) return;
  if (!channelId) return;

  const config = await readTempVCConfig(guild.id);
  if (!config?.createChannelId) return;
  if (channelId !== config.createChannelId) return;

  // One temp VC per owner: move them to their existing one instead.
  const existing = await readActiveTempVCByOwner(guild.id, member.id);
  if (existing) {
    const existingChannel = guild.channels.cache.get(existing.channelId);
    if (existingChannel?.isVoiceBased()) {
      await member.voice.setChannel(existingChannel).catch(() => {});
    }
    return;
  }

  const createChannel = guild.channels.cache.get(config.createChannelId);
  const category =
    config.categoryId &&
    guild.channels.cache.get(config.categoryId)?.type === ChannelType.GuildCategory
      ? guild.channels.cache.get(config.categoryId)
      : createChannel?.parent;

  const name = config.nameTemplate
    .replace(/\{user\}/g, member.user.username)
    .replace(/\{guild\}/g, guild.name);

  let newChannel;
  try {
    newChannel = await guild.channels.create({
      name,
      type: ChannelType.GuildVoice,
      parent: category?.id ?? undefined,
      bitrate: config.bitrate ?? undefined,
      userLimit: config.userLimit ?? undefined,
      reason: `Temp VC created by ${member.user.tag}`,
    });
  } catch (err) {
    console.error('[TempVC] Failed to create channel:', err);
    return;
  }

  try {
    await member.voice.setChannel(newChannel, 'Joined create channel');
  } catch {
    /* Move failed; the empty temp VC will be cleaned up on leave. */
  }

  await createActiveTempVC({
    guildId: guild.id,
    channelId: newChannel.id,
    ownerId: member.id,
  });
}

/** When the last member leaves a temp VC, delete it. */
async function handleTempVCLeave(oldState: VoiceState): Promise<void> {
  const { guild, channelId: oldChannelId } = oldState;
  if (!guild || !oldChannelId) return;

  const active = await readActiveTempVCByChannel(oldChannelId);
  if (!active) return;

  const channel = guild.channels.cache.get(oldChannelId);
  if (!channel || !channel.isVoiceBased()) return;
  if (channel.members.size > 0) return; // still in use

  try {
    await channel.delete('Temp VC is empty');
  } catch {
    /* already deleted or missing permissions */
  }
  await deleteActiveTempVC(oldChannelId);
}

/**
 * Start tracking members who were already in voice before this login. Without
 * this a restart would ignore them until they switch channels, because no
 * voiceStateUpdate fires for an unchanged state.
 */
export function seedVoiceSessions(client: Client): void {
  const now = Date.now();
  for (const guild of client.guilds.cache.values()) {
    for (const state of guild.voiceStates.cache.values()) {
      if (!state.channelId || !state.member?.user) continue;
      if (!voiceSessions.has(state.id)) voiceSessions.set(state.id, now);
    }
  }
}

/**
 * Award XP once per minute to everyone still in voice. Called on a one-minute
 * interval started from the ready handler.
 */
export async function handleVoiceTick(client: Client): Promise<void> {
  const now = Date.now();
  const entries: Array<[string, number]> = [...voiceSessions.entries()];

  for (const [userId, joinTs] of entries) {
    const minutesElapsed = Math.floor((now - joinTs) / 60000);
    if (minutesElapsed < 1) continue;

    let found = false;
    for (const guild of client.guilds.cache.values()) {
      // Voice states are always cached for guilds, so this is more reliable than
      // scanning the member cache (which may not hold every voice member).
      const member =
        guild.voiceStates.cache.get(userId)?.member ?? guild.members.cache.get(userId) ?? null;
      if (!member?.voice?.channelId) continue;

      found = true;
      await awardVoiceXp(client, userId, minutesElapsed, guild, member.user);
      break;
    }

    if (found) {
      // Advance the session timestamp so XP is awarded once per minute going
      // forward, aligned to the minute boundary to prevent drift.
      voiceSessions.set(userId, now - ((now - joinTs) % 60000));
    } else {
      // User no longer in any voice channel in any guild we can see.
      voiceSessions.delete(userId);
    }
  }
}

/** Seed sessions and start the one-minute voice XP tick. Idempotent. */
export function startVoiceTracking(client: Client): void {
  seedVoiceSessions(client);
  stopVoiceTracking();
  tickInterval = setInterval(() => {
    void handleVoiceTick(client).catch((err) => {
      console.error('Voice XP tick error:', err);
    });
  }, 60_000);
}

export function stopVoiceTracking(): void {
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
}

export function getVoiceSessions(): Map<string, number> {
  return voiceSessions;
}

export const voiceStateUpdate = {
  name: Events.VoiceStateUpdate as keyof ClientEvents,
  execute: async (client: Client, oldState: VoiceState, newState: VoiceState) => {
    await handleVoiceStateUpdate(client, oldState, newState);
  },
};
