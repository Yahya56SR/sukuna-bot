import { model, Schema, Document } from "mongoose";

export interface IInventoryEntry {
  itemId: string;
  quantity: number;
}

export interface IUser extends Document {
  userId: string;
  balance: number;
  bank: number;
  bankLimit: number;
  /** Purchased shop items. */
  inventory: IInventoryEntry[];
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
  /** Consecutive days `/daily` has been claimed. */
  dailyStreak: number;
  maxDailyStreak: number;
  /** Set by a Streak Freeze; consumed when a daily window is missed. */
  streakFreeze: boolean;
  /** Set by a Lucky Clover; consumed to soften one casino loss. */
  luckyClover: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    userId: { type: String, required: true, unique: true, index: true },
    balance: { type: Number, default: 0 },
    bank: { type: Number, default: 0 },
    bankLimit: { type: Number, default: 1000 },
    inventory: {
      type: [
        {
          _id: false,
          itemId: { type: String, required: true },
          quantity: { type: Number, default: 1, min: 0 },
        },
      ],
      default: [],
    },
    xp: { type: Number, default: 0 },
    level: { type: Number, default: 0 },
    totalXp: { type: Number, default: 0 },
    lastMessageAt: { type: Date },
    voiceMinutes: { type: Number, default: 0 },
    lastDaily: { type: Date },
    lastWork: { type: Date },
    dailyStreak: { type: Number, default: 0 },
    maxDailyStreak: { type: Number, default: 0 },
    streakFreeze: { type: Boolean, default: false },
    luckyClover: { type: Boolean, default: false },
  },
  { timestamps: true },
);

// Leaderboard / rank position scans sort by total XP.
userSchema.index({ totalXp: -1 });
userSchema.index({ xp: -1 });
// Dashboard user list sorts and paginates on these.
userSchema.index({ balance: -1 });
userSchema.index({ level: -1 });
userSchema.index({ createdAt: -1 });

export const User = model<IUser>("User", userSchema);

/**
 * Fetch-or-create a user row in one atomic upsert.
 *
 * The previous `findOne` → `create` pair raced on first use: two commands
 * arriving together both saw `null` and the loser hit the unique index with a
 * duplicate-key error, failing the command.
 */
export async function getUser(userId: string): Promise<IUser> {
  const user = await User.findOneAndUpdate(
    { userId },
    { $setOnInsert: { userId } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return user!;
}
