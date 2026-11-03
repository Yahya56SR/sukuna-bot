import { model, Schema, Document } from "mongoose";

export interface IGuild extends Document {
  guildId: string;
  modules: Record<string, boolean>;
  xpEnabled: boolean;
  xpCooldown: number;
  xpMin: number;
  xpMax: number;
  levelUpChannel?: string;
  levelUpMessage?: string;
  disableXpChannels: string[];
  updatedAt: Date;
}

const guildSchema = new Schema<IGuild>(
  {
    guildId: { type: String, required: true, unique: true, index: true },
    modules: { type: Map, of: Boolean, default: new Map() },
    xpEnabled: { type: Boolean, default: true },
    xpCooldown: { type: Number, default: 60 },
    xpMin: { type: Number, default: 15 },
    xpMax: { type: Number, default: 25 },
    levelUpChannel: { type: String },
    levelUpMessage: { type: String },
    disableXpChannels: { type: [String], default: [] },
  },
  { timestamps: true },
);

export const Guild = model<IGuild>("Guild", guildSchema);

export async function readGuildConfig(guildId: string) {
  return Guild.findOne({ guildId }).lean();
}
