import { model, Schema, type Document } from 'mongoose';

export interface IWelcomerConfig extends Document {
  guildId: string;
  welcomeChannelId?: string;
  goodbyeChannelId?: string;
  welcomeMessage?: string;
  goodbyeMessage?: string;
  welcomeImageEnabled: boolean;
  goodbyeImageEnabled: boolean;
  backgroundImagePath?: string;
  goodbyeBackgroundImagePath?: string;
  createdAt: Date;
  updatedAt: Date;
}

const welcomerConfigSchema = new Schema<IWelcomerConfig>(
  {
    guildId: { type: String, required: true, unique: true, index: true },
    welcomeChannelId: { type: String },
    goodbyeChannelId: { type: String },
    welcomeMessage: { type: String },
    goodbyeMessage: { type: String },
    welcomeImageEnabled: { type: Boolean, default: true },
    goodbyeImageEnabled: { type: Boolean, default: true },
    backgroundImagePath: { type: String },
    goodbyeBackgroundImagePath: { type: String },
  },
  { timestamps: true },
);

export const WelcomerConfig = model<IWelcomerConfig>('WelcomerConfig', welcomerConfigSchema);
