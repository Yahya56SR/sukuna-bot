import { model, Schema, Document } from "mongoose";

export interface IUser extends Document {
  userId: string;
  balance: number;
  bank: number;
  bankLimit: number;
  /** Total XP (kept in sync with `totalXp` for older dashboard queries). */
  xp: number;
  level: number;
  totalXp: number;
  /** Last message that granted XP — persists the cooldown across restarts. */
  lastMessageAt?: Date;
  /** Lifetime voice minutes that granted XP. */
  voiceMinutes: number;
  lastDaily?: Date;
  lastWork?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    userId: { type: String, required: true, unique: true, index: true },
    balance: { type: Number, default: 0 },
    bank: { type: Number, default: 0 },
    bankLimit: { type: Number, default: 1000 },
    xp: { type: Number, default: 0 },
    level: { type: Number, default: 0 },
    totalXp: { type: Number, default: 0 },
    lastMessageAt: { type: Date },
    voiceMinutes: { type: Number, default: 0 },
    lastDaily: { type: Date },
    lastWork: { type: Date },
  },
  { timestamps: true },
);

// Leaderboard / rank position scans sort by total XP.
userSchema.index({ totalXp: -1 });
userSchema.index({ xp: -1 });

export const User = model<IUser>("User", userSchema);

export async function getUser(userId: string) {
  let user = await User.findOne({ userId });
  if (!user) {
    user = await User.create({ userId });
  }
  return user;
}

export async function updateUser(userId: string, updates: Partial<IUser>): Promise<IUser | null> {
  return User.findOneAndUpdate({ userId }, updates, { new: true }).lean();
}
