import { model, Schema, Document } from "mongoose";

export interface IUser extends Document {
  userId: string;
  balance: number;
  bank: number;
  bankLimit: number;
  xp: number;
  level: number;
  totalXp: number;
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
    lastDaily: { type: Date },
    lastWork: { type: Date },
  },
  { timestamps: true },
);

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