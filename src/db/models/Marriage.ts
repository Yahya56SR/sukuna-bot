import { model, Schema, Document } from "mongoose";

export interface IMarriage extends Document {
  /** First partner */
  userId1: string;
  /** Second partner */
  userId2: string;
  guildId: string;
  /** Proposer */
  proposerId: string;
  /** When married */
  marriedAt: Date;
  /** Custom marriage message */
  message?: string;
  /** Divorced */
  divorced: boolean;
  /** Divorce timestamp */
  divorcedAt?: Date;
  /** Divorce initiator */
  divorceInitiatorId?: string;
  /** Relationship stats */
  stats: {
    hugs: number;
    kisses: number;
    gifts: number;
  };
  createdAt: Date;
  updatedAt: Date;
}

const marriageSchema = new Schema<IMarriage>(
  {
    userId1: { type: String, required: true, index: true },
    userId2: { type: String, required: true, index: true },
    guildId: { type: String, required: true, index: true },
    proposerId: { type: String, required: true },
    marriedAt: { type: Date, default: Date.now },
    message: { type: String, maxlength: 500 },
    divorced: { type: Boolean, default: false },
    divorcedAt: { type: Date },
    divorceInitiatorId: { type: String },
    stats: {
      hugs: { type: Number, default: 0 },
      kisses: { type: Number, default: 0 },
      gifts: { type: Number, default: 0 },
    },
  },
  { timestamps: true },
);

marriageSchema.index({ guildId: 1, userId1: 1 }, { unique: true });
marriageSchema.index({ guildId: 1, userId2: 1 }, { unique: true });

export const Marriage = model<IMarriage>("Marriage", marriageSchema);