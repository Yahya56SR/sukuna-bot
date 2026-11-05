import { model, Schema, type Document } from 'mongoose';

export interface IBoosterConfig extends Document {
  guildId: string;
  enabled: boolean;
  channelId?: string;
  roleId?: string;
  pingRoleId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const boosterConfigSchema = new Schema<IBoosterConfig>(
  {
    guildId: { type: String, required: true, unique: true, index: true },
    enabled: { type: Boolean, default: false },
    channelId: { type: String },
    roleId: { type: String },
    pingRoleId: { type: String },
  },
  { timestamps: true },
);

export const BoosterConfig = model<IBoosterConfig>('BoosterConfig', boosterConfigSchema);
