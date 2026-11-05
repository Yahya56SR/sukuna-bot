import { model, Schema, Document } from "mongoose";

export interface IAFK extends Document {
  userId: string;
  guildId: string;
  /** AFK reason */
  reason: string;
  /** When AFK was set */
  setAt: Date;
  /** Times mentioned while AFK */
  mentions: number;
  /** Last mentioned at */
  lastMentionedAt?: Date;
  /** Original nickname (to restore) */
  originalNickname?: string;
  createdAt: Date;
  updatedAt: Date;
}

const afkSchema = new Schema<IAFK>(
  {
    userId: { type: String, required: true },
    guildId: { type: String, required: true, index: true },
    reason: { type: String, maxlength: 500, default: 'AFK' },
    setAt: { type: Date, default: Date.now },
    mentions: { type: Number, default: 0 },
    lastMentionedAt: { type: Date },
    originalNickname: { type: String },
  },
  { timestamps: true },
);

afkSchema.index({ guildId: 1, userId: 1 }, { unique: true });

export const AFK = model<IAFK>("AFK", afkSchema);