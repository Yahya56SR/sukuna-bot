import { model, Schema, Document } from "mongoose";

export interface IInfraction extends Document {
  guildId: string;
  userId: string;
  moderatorId: string;
  type: 'warn' | 'timeout' | 'ban' | 'kick' | 'unban' | 'untimeout' | 'note';
  reason: string;
  /** For timeout: duration in seconds */
  duration?: number;
  /** For timeout/ban: when it expires */
  expiresAt?: Date;
  /** Whether the infraction is active (for timeouts/bans) */
  active: boolean;
  /** DM sent to user */
  dmSent: boolean;
  /** Reference to original message/context */
  messageId?: string;
  /** Channel where infraction occurred */
  channelId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const infractionSchema = new Schema<IInfraction>(
  {
    guildId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    moderatorId: { type: String, required: true },
    type: {
      type: String,
      enum: ['warn', 'timeout', 'ban', 'kick', 'unban', 'untimeout', 'note'],
      required: true,
    },
    reason: { type: String, required: true, maxlength: 1000 },
    duration: { type: Number },
    expiresAt: { type: Date, index: true },
    active: { type: Boolean, default: true },
    dmSent: { type: Boolean, default: false },
    messageId: { type: String },
    channelId: { type: String },
  },
  { timestamps: true },
);

infractionSchema.index({ guildId: 1, userId: 1, createdAt: -1 });
infractionSchema.index({ guildId: 1, active: 1, expiresAt: 1 });

export const Infraction = model<IInfraction>("Infraction", infractionSchema);