import { model, Schema, Document } from "mongoose";

export interface IGameProfile extends Document {
  userId: string;
  guildId: string;
  /** Casino stats */
  casino: {
    /** Total wagered */
    wagered: number;
    /** Total won */
    won: number;
    /** Total lost */
    lost: number;
    /** Biggest win */
    biggestWin: number;
    /** Biggest loss */
    biggestLoss: number;
    /** Games played */
    gamesPlayed: number;
    /** Slots stats */
    slots: { played: number; won: number; lost: number; jackpots: number };
    /** Blackjack stats */
    blackjack: { played: number; won: number; lost: number; pushed: number; blackjacks: number };
    /** Roulette stats */
    roulette: { played: number; won: number; lost: number; straightWins: number };
    /** Crash stats */
    crash: { played: number; won: number; lost: number; highestMultiplier: number };
    /** Coinflip stats */
    coinflip: { played: number; won: number; lost: number; streak: number; maxStreak: number };
  };
  /** Fishing stats */
  fishing: {
    caught: number;
    sold: number;
    biggestFish: { name: string; weight: number; value: number };
    rareCatches: number;
  };
  /** Mining stats */
  mining: {
    mined: number;
    rareFinds: number;
  };
  /** Hunting stats */
  hunting: {
    hunted: number;
    rareFinds: number;
  };
  /** Work stats */
  work: {
    timesWorked: number;
    totalEarned: number;
    bestJob: string;
  };
  /** Daily streak */
  dailyStreak: number;
  /** Max daily streak */
  maxDailyStreak: number;
  /** Last daily claim */
  lastDaily?: Date;
  /** Achievements unlocked */
  achievements: string[];
  createdAt: Date;
  updatedAt: Date;
}

const gameProfileSchema = new Schema<IGameProfile>(
  {
    userId: { type: String, required: true, index: true },
    guildId: { type: String, required: true, index: true },
    casino: {
      wagered: { type: Number, default: 0 },
      won: { type: Number, default: 0 },
      lost: { type: Number, default: 0 },
      biggestWin: { type: Number, default: 0 },
      biggestLoss: { type: Number, default: 0 },
      gamesPlayed: { type: Number, default: 0 },
      slots: { played: { type: Number, default: 0 }, won: { type: Number, default: 0 }, lost: { type: Number, default: 0 }, jackpots: { type: Number, default: 0 } },
      blackjack: { played: { type: Number, default: 0 }, won: { type: Number, default: 0 }, lost: { type: Number, default: 0 }, pushed: { type: Number, default: 0 }, blackjacks: { type: Number, default: 0 } },
      roulette: { played: { type: Number, default: 0 }, won: { type: Number, default: 0 }, lost: { type: Number, default: 0 }, straightWins: { type: Number, default: 0 } },
      crash: { played: { type: Number, default: 0 }, won: { type: Number, default: 0 }, lost: { type: Number, default: 0 }, highestMultiplier: { type: Number, default: 0 } },
      coinflip: { played: { type: Number, default: 0 }, won: { type: Number, default: 0 }, lost: { type: Number, default: 0 }, streak: { type: Number, default: 0 }, maxStreak: { type: Number, default: 0 } },
    },
    fishing: { caught: { type: Number, default: 0 }, sold: { type: Number, default: 0 }, biggestFish: { name: { type: String }, weight: { type: Number }, value: { type: Number } }, rareCatches: { type: Number, default: 0 } },
    mining: { mined: { type: Number, default: 0 }, rareFinds: { type: Number, default: 0 } },
    hunting: { hunted: { type: Number, default: 0 }, rareFinds: { type: Number, default: 0 } },
    work: { timesWorked: { type: Number, default: 0 }, totalEarned: { type: Number, default: 0 }, bestJob: { type: String } },
    dailyStreak: { type: Number, default: 0 },
    maxDailyStreak: { type: Number, default: 0 },
    lastDaily: { type: Date },
    achievements: { type: [String], default: [] },
  },
  { timestamps: true },
);

gameProfileSchema.index({ guildId: 1, userId: 1 }, { unique: true });

export const GameProfile = model<IGameProfile>("GameProfile", gameProfileSchema);