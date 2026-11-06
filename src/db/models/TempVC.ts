import { model, Schema, type Document } from 'mongoose';

/* -------------------------------------------------------------------------- */
/* TempVCConfig — per-guild join-to-create settings                           */
/* -------------------------------------------------------------------------- */

export interface ITempVCConfig extends Document {
  guildId: string;
  createChannelId?: string; // the "join to create" trigger voice channel
  categoryId?: string; // category temp VCs are created under
  nameTemplate: string; // e.g. "{user}'s VC", default below
  bitrate?: number;
  userLimit?: number;
  createdAt: Date;
  updatedAt: Date;
}

const tempVCConfigSchema = new Schema<ITempVCConfig>(
  {
    guildId: { type: String, required: true, unique: true, index: true },
    createChannelId: { type: String },
    categoryId: { type: String },
    nameTemplate: {
      type: String,
      required: true,
      default: "{user}'s VC",
    },
    bitrate: { type: Number },
    userLimit: { type: Number },
  },
  { timestamps: true },
);

export const TempVCConfig = model<ITempVCConfig>('TempVCConfig', tempVCConfigSchema);

/* -------------------------------------------------------------------------- */
/* ActiveTempVC — currently open temporary voice channels                     */
/* -------------------------------------------------------------------------- */

export interface IActiveTempVC extends Document {
  guildId: string;
  channelId: string;
  ownerId: string;
  createdAt: Date;
}

const activeTempVCSchema = new Schema<IActiveTempVC>(
  {
    guildId: { type: String, required: true, index: true },
    channelId: { type: String, required: true, unique: true },
    ownerId: { type: String, required: true },
  },
  { timestamps: true },
);

// One active temp VC per owner — DB-guard against duplicate handlers.
activeTempVCSchema.index({ guildId: 1, ownerId: 1 }, { unique: true });

export const ActiveTempVC = model<IActiveTempVC>('ActiveTempVC', activeTempVCSchema);

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

export async function readTempVCConfig(guildId: string) {
  return TempVCConfig.findOne({ guildId }).lean();
}

export async function upsertTempVCConfig(
  guildId: string,
  updates: Partial<ITempVCConfig>,
) {
  return TempVCConfig.findOneAndUpdate(
    { guildId },
    { $set: updates },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();
}

export async function deleteTempVCConfig(guildId: string) {
  return TempVCConfig.deleteOne({ guildId });
}

export async function readActiveTempVCsByGuild(guildId: string) {
  return ActiveTempVC.find({ guildId }).lean();
}

export async function readActiveTempVCByChannel(channelId: string) {
  return ActiveTempVC.findOne({ channelId }).lean();
}

export async function readActiveTempVCByOwner(guildId: string, ownerId: string) {
  return ActiveTempVC.findOne({ guildId, ownerId }).lean();
}

export async function createActiveTempVC(data: {
  guildId: string;
  channelId: string;
  ownerId: string;
}) {
  return ActiveTempVC.create(data);
}

export async function deleteActiveTempVC(channelId: string) {
  return ActiveTempVC.deleteOne({ channelId });
}

export async function deleteActiveTempVCsByGuild(guildId: string) {
  return ActiveTempVC.deleteMany({ guildId });
}

/* -------------------------------------------------------------------------- */
/* In-memory cache — kills the per-voice-event findOne on the hot path        */
/* -------------------------------------------------------------------------- */

/** guildId -> resolved config (null means "not configured"). */
const _configCache = new Map<string, ITempVCConfig | null>();
/** channelId -> active temp VC row. */
const _activeCache = new Map<string, IActiveTempVC>();

/**
 * undefined = cache miss (caller must read DB then warm).
 * null = not configured. Older code returned null for both, which made the
 * DB fallback in voiceStateUpdate unreachable.
 */
export function getCachedTempVCConfig(guildId: string): ITempVCConfig | null | undefined {
  if (!_configCache.has(guildId)) return undefined;
  return _configCache.get(guildId) ?? null;
}

export function setCachedTempVCConfig(guildId: string, config: ITempVCConfig | null): void {
  _configCache.set(guildId, config);
}

export function clearTempVCConfigCache(guildId?: string): void {
  if (guildId) _configCache.delete(guildId);
  else _configCache.clear();
}

export function getCachedActiveTempVC(channelId: string): IActiveTempVC | undefined {
  return _activeCache.get(channelId);
}

export function setCachedActiveTempVC(channelId: string, row: IActiveTempVC): void {
  _activeCache.set(channelId, row);
}

export function deleteCachedActiveTempVC(channelId: string): void {
  _activeCache.delete(channelId);
}

export function clearActiveTempVCCache(): void {
  _activeCache.clear();
}

/** Warm the active cache from the DB (called once at startup reconciliation). */
export async function warmActiveTempVCCache(): Promise<void> {
  _activeCache.clear();
  const rows = await ActiveTempVC.find().lean();
  for (const row of rows) _activeCache.set(row.channelId, row);
}
