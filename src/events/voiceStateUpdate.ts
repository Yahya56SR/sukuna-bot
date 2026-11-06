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
  getCachedTempVCConfig,
  setCachedTempVCConfig,
  readActiveTempVCByOwner,
  readActiveTempVCByChannel,
  getCachedActiveTempVC,
  setCachedActiveTempVC,
  deleteCachedActiveTempVC,
  createActiveTempVC,
  deleteActiveTempVC,
} from '../db/models/TempVC.js';
import { isDuplicateKeyError, withMutex } from '../core/safety.js';
import { recordActivity } from '../core/metrics.js';

/** guildId -> userId -> join timestamp (aligned to minute boundaries as XP is awarded). */
const voiceSessions = new Map<string, Map<string, number>>();

let tickInterval: ReturnType<typeof setInterval> | null = null;
/** In-flight guard: only one voice tick runs at a time. */
let ticking = false;

/** A voice session only earns XP while the member is actually audible. */
function isVoiceActive(state: VoiceState | null | undefined): boolean {
  if (!state) return false;
  return !(state.selfMute || state.serverMute || state.selfDeaf || state.serverDeaf || state.suppress);
}

/**
 * Award random XP for a number of minutes spent in voice.
 * Returns true when XP was actually written (callers advance the session
 * timestamp only on success so a DB failure does not lose minutes).
 */
async function awardVoiceXp(
  client: Client,
  userId: string,
  minutes: number,
  guild?: Guild,
  user?: User,
  settings?: LevelSettings,
  voiceState?: VoiceState | null,
  channelId?: string | null,
): Promise<boolean> {
  if (minutes <= 0 || !guild || !user) return false;
  // Muted / deafened / suppressed members do not earn voice XP.
  if (voiceState && !isVoiceActive(voiceState)) return false;

  let cfg = settings;
  if (!cfg) {
    const row = await loadGuildConfig(client, guild.id);
    cfg = readLevelSettings(row ?? {});
  }
  if (!cfg.enabled) return false;
  if (cfg.ignoreBots && user.bot) return false;
  // Channel gates mirror messageCreate (previously voice bypassed them).
  if (channelId) {
    if (cfg.noXpChannels.includes(channelId)) return false;
    if (cfg.xpChannel && channelId !== cfg.xpChannel) return false;
  }

  const amount = randomXp(cfg.perVoiceMinuteMin, cfg.perVoiceMinuteMax) * minutes;
  if (amount <= 0) return false;

  try {
    const result = await addXp(userId, amount, 'voice', minutes);
    if (result.leveledUp) {
      await handleLevelUp(guild, user, result.newLevel, result.oldLevel, undefined, cfg);
    }
    return true;
  } catch (err) {
    (client as any).logger?.warn({ err, userId }, 'voice XP award failed');
    return false;
  }
}

async function loadGuildConfig(client: Client, guildId: string): Promise<any> {
  const withConfig = client as unknown as { getConfig?: (id: string) => Promise<any> };
  if (typeof withConfig.getConfig === 'function') {
    return withConfig.getConfig(guildId);
  }
  return null;
}

function getUserSession(guildId: string, userId: string): number | undefined {
  return voiceSessions.get(guildId)?.get(userId);
}

function setUserSession(guildId: string, userId: string, ts: number): void {
  let byUser = voiceSessions.get(guildId);
  if (!byUser) {
    byUser = new Map();
    voiceSessions.set(guildId, byUser);
  }
  byUser.set(userId, ts);
}

function deleteUserSession(guildId: string, userId: string): void {
  const byUser = voiceSessions.get(guildId);
  if (!byUser) return;
  byUser.delete(userId);
  if (byUser.size === 0) voiceSessions.delete(guildId);
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

  // Temp VC must not abort XP tracking: guard each handler separately.
  // Serialised per owner so duplicate voice events cannot race two creates.
  try {
    const ownerId = newState.member?.user?.id;
    if (ownerId && newState.guild) {
      await withMutex(`tempvc:${newState.guild.id}:${ownerId}`, () => handleTempVCJoin(client, newState));
    } else {
      await handleTempVCJoin(client, newState);
    }
  } catch (err) {
    (client as any).logger?.warn({ err }, 'tempVC join failed');
  }

  // Temp VC: delete the channel when it becomes empty.
  if (oldState.channelId && changedChannel) {
    try {
      await handleTempVCLeave(oldState);
    } catch (err) {
      (client as any).logger?.warn({ err }, 'tempVC leave failed');
    }
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
    const guildId = oldState.guild?.id ?? newState.guild?.id;
    const joinTs = guildId ? getUserSession(guildId, userId) : undefined;
    if (joinTs && guildId) {
      const minutes = Math.floor((now - joinTs) / 60000);
      // Delete *before* the awaited award so a concurrent tick cannot
      // double-count the same minutes. The award is best-effort here — the
      // tick already grants per-minute XP, so losing <1 minute on leave is
      // intentional.
      if (!isVoiceActive(oldState)) {
        deleteUserSession(guildId, userId);
      } else {
        deleteUserSession(guildId, userId);
        await awardVoiceXp(
          client,
          userId,
          minutes,
          newState.guild ?? oldState.guild,
          newState.member?.user ?? oldState.member?.user,
          undefined,
          oldState,
          oldState.channelId,
        );
      }
    }
  }

  // Joined a voice channel, or moved to a new one: start a fresh session.
  // Without this a channel move would end the session and stop all further
  // voice XP until the member left and rejoined.
  if (changedChannel && newState.channelId && newState.member?.user && newState.guild) {
    // Only track audible joins; muted joins start earning when unmuted (the
    // next state update re-seeds via the tick's freshness check).
    if (isVoiceActive(newState)) {
      setUserSession(newState.guild.id, userId, now);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Temp VC (join-to-create)                                                   */
/* -------------------------------------------------------------------------- */

/** When a member joins the configured "create" channel, spin up a temp VC. */
async function handleTempVCJoin(client: Client, newState: VoiceState): Promise<void> {
  const { guild, member, channelId } = newState;
  if (!guild || !member || member.user.bot) return;
  if (!channelId) return;

  // Read from cache first; fall back to DB and warm the cache on a miss.
  let config = getCachedTempVCConfig(guild.id);
  if (config === undefined) {
    config = await readTempVCConfig(guild.id);
    setCachedTempVCConfig(guild.id, config);
  }
  if (!config?.createChannelId) return;
  if (channelId !== config.createChannelId) return;

  // One temp VC per owner: move them to their existing one instead.
  // Self-heal: if the stored channel no longer exists, clear the stale row so
  // the member can get a fresh temp VC.
  const existing = await readActiveTempVCByOwner(guild.id, member.id);
  if (existing) {
    const existingChannel = guild.channels.cache.get(existing.channelId);
    if (existingChannel?.isVoiceBased()) {
      await member.voice.setChannel(existingChannel).catch(() => {});
      return;
    }
    // Stale owner row: the old channel is gone, clear it and fall through to
    // create a brand-new temp VC for this owner.
    await deleteActiveTempVC(existing.channelId).catch(() => {});
    deleteCachedActiveTempVC(existing.channelId);
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
    (client as any).logger?.warn({ err }, 'tempVC create channel failed');
    return;
  }

  try {
    await member.voice.setChannel(newChannel, 'Joined create channel');
  } catch {
    /* Move failed; the empty temp VC will be cleaned up on leave. */
  }

  try {
    await createActiveTempVC({
      guildId: guild.id,
      channelId: newChannel.id,
      ownerId: member.id,
    });
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      // Another handler already owns a VC for this member.
      try { await newChannel.delete('Duplicate temp VC'); } catch { /* gone */ }
      recordActivity('system', 'TempVC duplicate suppressed', { level: 'info', meta: { guildId: guild.id, userId: member.id } });
      return;
    }
    (client as any).logger?.warn({ err }, 'tempVC active row create failed');
    try { await newChannel.delete('Temp VC setup failed'); } catch { /* gone */ }
    return;
  }
  setCachedActiveTempVC(newChannel.id, {
    guildId: guild.id,
    channelId: newChannel.id,
    ownerId: member.id,
    createdAt: new Date(),
  } as any);
}

/** When the last member leaves a temp VC, delete it. */
async function handleTempVCLeave(oldState: VoiceState): Promise<void> {
  const { guild, channelId: oldChannelId } = oldState;
  if (!guild || !oldChannelId) return;

  // Use the cache first; fall back to DB on a miss.
  let active = getCachedActiveTempVC(oldChannelId);
  if (!active) {
    const dbActive = await readActiveTempVCByChannel(oldChannelId);
    if (dbActive) {
      active = dbActive;
      setCachedActiveTempVC(oldChannelId, dbActive);
    }
  }
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
  deleteCachedActiveTempVC(oldChannelId);
}

/**
 * Award XP once per minute to everyone still in voice. Called on a one-minute
 * interval started from the ready handler.
 */
export async function handleVoiceTick(client: Client): Promise<void> {
  if (ticking) return; // in-flight guard: previous tick still running
  ticking = true;
  try {
    const now = Date.now();
    const guildIds = [...voiceSessions.keys()];

    for (const guildId of guildIds) {
      const byUser = voiceSessions.get(guildId);
      if (!byUser) continue;

      const guild = client.guilds.cache.get(guildId);
      if (!guild) {
        // Guild no longer cached (left/deleted): drop its sessions instead
        // of leaking them forever.
        voiceSessions.delete(guildId);
        continue;
      }

      const entries: Array<[string, number]> = [...byUser.entries()];
      for (const [userId, joinTs] of entries) {
        // Skip if the session was already resumed/advanced concurrently.
        if (byUser.get(userId) !== joinTs) continue;
        const minutesElapsed = Math.floor((now - joinTs) / 60000);
        if (minutesElapsed < 1) continue;

        const voiceState = guild.voiceStates.cache.get(userId) ?? null;
        const member = voiceState?.member ?? guild.members.cache.get(userId) ?? null;
        if (!member?.voice?.channelId || !voiceState?.channelId) {
          // User no longer in any voice channel in this guild.
          byUser.delete(userId);
          continue;
        }
        if (!isVoiceActive(voiceState)) continue;

        const awarded = await awardVoiceXp(
          client,
          userId,
          minutesElapsed,
          guild,
          member.user,
          undefined,
          voiceState,
          voiceState.channelId,
        );
        if (!awarded) continue; // keep joinTs so minutes accrue for next tick

        // Advance the session timestamp so XP is awarded once per minute going
        // forward, aligned to the minute boundary to prevent drift. Only
        // advance when the session is still the one we awarded for — a
        // concurrent leave/move owns the newer timestamp.
        if (byUser.get(userId) === joinTs) {
          setUserSession(guildId, userId, now - ((now - joinTs) % 60000));
        }
      }

      if (byUser.size === 0) voiceSessions.delete(guildId);
    }
  } catch (err) {
    (client as any).logger?.warn({ err }, 'voice XP tick error');
  } finally {
    ticking = false;
  }
}

/** Seed sessions and start the one-minute voice XP tick. Idempotent. */
export function startVoiceTracking(client: Client): void {
  seedVoiceSessions(client);
  stopVoiceTracking();
  tickInterval = setInterval(() => {
    void handleVoiceTick(client);
  }, 60_000);
  tickInterval.unref?.();
}

export function stopVoiceTracking(): void {
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
  ticking = false;
}

/**
 * Start tracking members who were already in voice before this login. Without
 * this a restart would ignore them until they switch channels, because no
 * voiceStateUpdate fires for an unchanged state. Keyed by guild so a member in
 * voice on two guilds is tracked in both.
 */
export function seedVoiceSessions(client: Client): void {
  const now = Date.now();
  voiceSessions.clear();
  for (const guild of client.guilds.cache.values()) {
    const byUser = new Map<string, number>();
    for (const state of guild.voiceStates.cache.values()) {
      if (!state.channelId || !state.member?.user) continue;
      if (state.member.user.bot) continue;
      if (!isVoiceActive(state)) continue;
      if (!byUser.has(state.id)) byUser.set(state.id, now);
    }
    if (byUser.size > 0) voiceSessions.set(guild.id, byUser);
  }
}

export function getVoiceSessions(): Map<string, Map<string, number>> {
  return voiceSessions;
}

export const voiceStateUpdate = {
  name: Events.VoiceStateUpdate as keyof ClientEvents,
  execute: async (client: Client, oldState: VoiceState, newState: VoiceState) => {
    await handleVoiceStateUpdate(client, oldState, newState);
  },
};
