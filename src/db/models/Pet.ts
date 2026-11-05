import { model, Schema, Document } from "mongoose";

export type PetType = 'dog' | 'cat' | 'fox' | 'dragon' | 'phoenix' | 'unicorn' | 'slime' | 'robot' | 'ghost' | 'bunny';

export interface IPet extends Document {
  userId: string;
  guildId: string;
  /** Pet name */
  name: string;
  /** Pet type */
  type: PetType;
  /** Pet level */
  level: number;
  /** Experience points */
  xp: number;
  /** Hunger (0-100) */
  hunger: number;
  /** Happiness (0-100) */
  happiness: number;
  /** Health (0-100) */
  health: number;
  /** Energy (0-100) */
  energy: number;
  /** Last fed */
  lastFed?: Date;
  /** Last played */
  lastPlayed?: Date;
  /** Last trained */
  lastTrained?: Date;
  /** Last battled */
  lastBattled?: Date;
  /** Battle wins */
  wins: number;
  /** Battle losses */
  losses: number;
  /** Battle draws */
  draws: number;
  /** Coins earned */
  coinsEarned: number;
  /** Accessories/items equipped */
  accessories: string[];
  /** Evolution stage */
  evolution: number;
  /** Custom description */
  description?: string;
  createdAt: Date;
  updatedAt: Date;
}

const petSchema = new Schema<IPet>(
  {
    userId: { type: String, required: true, index: true },
    guildId: { type: String, required: true, index: true },
    name: { type: String, required: true, maxlength: 32 },
    type: {
      type: String,
      enum: ['dog', 'cat', 'fox', 'dragon', 'phoenix', 'unicorn', 'slime', 'robot', 'ghost', 'bunny'],
      required: true,
    },
    level: { type: Number, default: 1, min: 1, max: 100 },
    xp: { type: Number, default: 0 },
    hunger: { type: Number, default: 100, min: 0, max: 100 },
    happiness: { type: Number, default: 100, min: 0, max: 100 },
    health: { type: Number, default: 100, min: 0, max: 100 },
    energy: { type: Number, default: 100, min: 0, max: 100 },
    lastFed: { type: Date },
    lastPlayed: { type: Date },
    lastTrained: { type: Date },
    lastBattled: { type: Date },
    wins: { type: Number, default: 0 },
    losses: { type: Number, default: 0 },
    draws: { type: Number, default: 0 },
    coinsEarned: { type: Number, default: 0 },
    accessories: { type: [String], default: [] },
    evolution: { type: Number, default: 0 },
    description: { type: String, maxlength: 500 },
  },
  { timestamps: true },
);

petSchema.index({ guildId: 1, userId: 1 }, { unique: true });

export const Pet = model<IPet>("Pet", petSchema);