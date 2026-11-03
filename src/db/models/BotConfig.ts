/**
 * Small key/value collection for runtime configuration that must survive
 * restarts (dashboard edits, feature flags, etc.).
 */

import { model, Schema, type Document } from 'mongoose';

export interface IBotConfig extends Document {
  key: string;
  value: unknown;
  updatedAt: Date;
  createdAt: Date;
}

const botConfigSchema = new Schema<IBotConfig>(
  {
    key: { type: String, required: true, unique: true, index: true },
    value: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, collection: 'bot_configs' },
);

export const BotConfig = model<IBotConfig>('BotConfig', botConfigSchema);

export async function readConfigDocument<T>(key: string): Promise<T | null> {
  const row = await BotConfig.findOne({ key }).lean();
  if (!row) return null;
  return (row.value ?? null) as T | null;
}

export async function writeConfigDocument<T>(key: string, value: T): Promise<void> {
  await BotConfig.updateOne(
    { key },
    { $set: { key, value, updatedAt: new Date() } },
    { upsert: true },
  );
}

export async function deleteConfigDocument(key: string): Promise<boolean> {
  const result = await BotConfig.deleteOne({ key });
  return result.deletedCount === 1;
}
