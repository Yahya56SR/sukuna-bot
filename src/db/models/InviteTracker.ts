import { model, Schema, Document } from "mongoose";

export interface IInviteTracker extends Document {
  guildId: string;
  code: string;
  inviterId: string;
  /** Total uses */
  uses: number;
  /** Max uses (0 = unlimited) */
  maxUses: number;
  /** Whether invite is temporary (kicks on leave) */
  temporary: boolean;
  /** Expires at */
  expiresAt?: Date;
  /** Channel invite was created in */
  channelId: string;
  /** Whether this is a vanity URL */
  vanity: boolean;
  /** Tracked members who joined via this invite */
  members: Array<{
    userId: string;
    joinedAt: Date;
    leftAt?: Date;
    fake?: boolean;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

const inviteTrackerSchema = new Schema<IInviteTracker>(
  {
    guildId: { type: String, required: true, index: true },
    code: { type: String, required: true },
    inviterId: { type: String, required: true, index: true },
    uses: { type: Number, default: 0 },
    maxUses: { type: Number, default: 0 },
    temporary: { type: Boolean, default: false },
    expiresAt: { type: Date },
    channelId: { type: String },
    vanity: { type: Boolean, default: false },
    members: [{
      userId: { type: String, required: true },
      joinedAt: { type: Date, default: Date.now },
      leftAt: { type: Date },
      fake: { type: Boolean, default: false },
    }],
  },
  { timestamps: true },
);

inviteTrackerSchema.index({ guildId: 1, code: 1 }, { unique: true });
inviteTrackerSchema.index({ guildId: 1, inviterId: 1 });

export const InviteTracker = model<IInviteTracker>("InviteTracker", inviteTrackerSchema);