import { model, Schema, Document } from "mongoose";

export interface IGuild extends Document {
  guildId: string;
  modules: Record<string, boolean>;
  xpEnabled: boolean;
  xpCooldown: number;
  xpMin: number;
  xpMax: number;
  xpVoiceMin: number;
  xpVoiceMax: number;
  xpIgnoreBots: boolean;
  xpChannel: string;
  levelUpChannel?: string;
  levelUpMessage?: string;
  disableXpChannels: string[];
  levelRoles: Record<string, string>;
  liveLeaderboard: {
    enabled: boolean;
    channelId: string;
    messageId: string;
    intervalMinutes: number;
    rows: number;
    title: string;
  };
  sukuna?: any;
  updatedAt: Date;
}

const liveLeaderboardSchema = new Schema(
  {
    enabled: { type: Boolean, default: false },
    channelId: { type: String, default: "" },
    messageId: { type: String, default: "" },
    intervalMinutes: { type: Number, default: 10 },
    rows: { type: Number, default: 25 },
    title: { type: String, default: "" },
  },
  { _id: false },
);

const guildSchema = new Schema<IGuild>(
  {
    guildId: { type: String, required: true, unique: true, index: true },
    modules: { type: Map, of: Boolean, default: new Map() },
    xpEnabled: { type: Boolean, default: true },
    xpCooldown: { type: Number, default: 60 },
    xpMin: { type: Number, default: 15 },
    xpMax: { type: Number, default: 25 },
    xpVoiceMin: { type: Number, default: 5 },
    xpVoiceMax: { type: Number, default: 8 },
    xpIgnoreBots: { type: Boolean, default: true },
    xpChannel: { type: String, default: "" },
    levelUpChannel: { type: String },
    levelUpMessage: { type: String },
    disableXpChannels: { type: [String], default: [] },
    levelRoles: { type: Schema.Types.Mixed, default: {} },
    liveLeaderboard: { type: liveLeaderboardSchema, default: () => ({}) },
    sukuna: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

export const Guild = model<IGuild>("Guild", guildSchema);

export async function readGuildConfig(guildId: string) {
  return Guild.findOne({ guildId }).lean();
}

export function getGuildId(): string {
  return process.env.DEV_GUILD_ID || '';
}

export async function updateGuildConfig(guildId: string, updates: Partial<IGuild>): Promise<IGuild | null> {
  return Guild.findOneAndUpdate({ guildId }, updates, { upsert: true, new: true, setDefaultsOnInsert: true }).lean();
}
