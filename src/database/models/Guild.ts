import { model, Schema, Document, Types } from "mongoose";

export interface IGuild extends Document {
  guildId: string;
  prefix: string;
  language: string;
  modules: {
    moderation: boolean;
    economy: boolean;
    leveling: boolean;
    tickets: boolean;
    music: boolean;
    fun: boolean;
    utility: boolean;
    logging: boolean;
    welcome: boolean;
    autorole: boolean;
    reactionroles: boolean;
    giveaways: boolean;
  };
  modRole?: string;
  adminRole?: string;
  logChannel?: string;
  welcomeChannel?: string;
  welcomeMessage?: string;
  leaveChannel?: string;
  leaveMessage?: string;
  autoRole?: string[];
  xpEnabled: boolean;
  xpCooldown: number;
  xpMin: number;
  xpMax: number;
  levelUpChannel?: string;
  levelUpMessage?: string;
  disableXpChannels: string[];
  createdAt: Date;
  updatedAt: Date;
}

const guildSchema = new Schema<IGuild>(
  {
    guildId: { type: String, required: true, unique: true, index: true },
    prefix: { type: String, default: "!" },
    language: { type: String, default: "en" },
    modules: {
      moderation: { type: Boolean, default: true },
      economy: { type: Boolean, default: true },
      leveling: { type: Boolean, default: true },
      tickets: { type: Boolean, default: true },
      music: { type: Boolean, default: true },
      fun: { type: Boolean, default: true },
      utility: { type: Boolean, default: true },
      logging: { type: Boolean, default: true },
      welcome: { type: Boolean, default: true },
      autorole: { type: Boolean, default: true },
      reactionroles: { type: Boolean, default: true },
      giveaways: { type: Boolean, default: true },
    },
    modRole: { type: String },
    adminRole: { type: String },
    logChannel: { type: String },
    welcomeChannel: { type: String },
    welcomeMessage: {
      type: String,
      default: "Welcome {user} to {guild}! 🎉",
    },
    leaveChannel: { type: String },
    leaveMessage: {
      type: String,
      default: "Goodbye {user} from {guild}. We'll miss you! 👋",
    },
    autoRole: { type: [String], default: [] },
    xpEnabled: { type: Boolean, default: true },
    xpCooldown: { type: Number, default: 60 },
    xpMin: { type: Number, default: 15 },
    xpMax: { type: Number, default: 25 },
    levelUpChannel: { type: String },
    levelUpMessage: {
      type: String,
      default: "Congrats {user}! You reached level {level} in {guild}! 🎊",
    },
    disableXpChannels: { type: [String], default: [] },
  },
  { timestamps: true }
);

export const Guild = model<IGuild>("Guild", guildSchema);
