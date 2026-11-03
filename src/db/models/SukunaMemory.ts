/**
 * SukunaMemory Mongoose model for persona memory storage.
 */

import { model, Schema, Document } from 'mongoose';

export interface ISukunaMemory extends Document {
  guildId: string;
  fact: string;
  aboutUserId?: string;
  aboutName?: string;
  createdAt: number;
}

const memorySchema = new Schema<ISukunaMemory>({
  guildId: { type: String, required: true, index: true },
  fact: { type: String, required: true },
  aboutUserId: { type: String, default: null },
  aboutName: { type: String, default: null },
  createdAt: { type: Number, required: true, default: Date.now },
});

memorySchema.index({ guildId: 1, fact: 1, aboutUserId: 1 }, { unique: true });

export const SukunaMemory = model<ISukunaMemory>('SukunaMemory', memorySchema);