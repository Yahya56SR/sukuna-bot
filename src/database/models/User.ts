import { model, Schema, Document, Types } from "mongoose";

export interface IUser extends Document {
  userId: string;
  balance: number;
  bank: number;
  bankLimit: number;
  xp: number;
  level: number;
  totalXp: number;
  dailyStreak: number;
  lastDaily?: Date;
  lastWork?: Date;
  lastBeg?: Date;
  lastCrime?: Date;
  inventory: Array<{
    itemId: string;
    amount: number;
  }>;
  warnings: Array<{
    guildId: string;
    moderatorId: string;
    reason: string;
    createdAt: Date;
  }>;
  birthday?: Date;
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
    dailyStreak: { type: Number, default: 0 },
    lastDaily: { type: Date },
    lastWork: { type: Date },
    lastBeg: { type: Date },
    lastCrime: { type: Date },
    inventory: [
      {
        itemId: { type: String },
        amount: { type: Number, default: 1 },
      },
    ],
    warnings: [
      {
        guildId: { type: String },
        moderatorId: { type: String },
        reason: { type: String },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    birthday: { type: Date },
  },
  { timestamps: true }
);

export const User = model<IUser>("User", userSchema);
