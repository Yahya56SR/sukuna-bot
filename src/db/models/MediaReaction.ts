import { model, Schema, type Document } from 'mongoose';

export type MediaKind = 'memes' | 'images';
export type EnforceMode = 'off' | 'warn' | 'delete';

export interface IMediaChannelConfig {
  id: string;
  kind: MediaKind;
  reactions?: string[];
  enforce?: EnforceMode;
}

export interface IMediaReactionConfig extends Document {
  guildId: string;
  enabled: boolean;
  memeChannels: IMediaChannelConfig[];
  imageChannels: IMediaChannelConfig[];
  memeReactions: string[];
  imageReactions: string[];
  enforceMode: EnforceMode;
  createdAt: Date;
  updatedAt: Date;
}

const mediaChannelConfigSchema = new Schema<IMediaChannelConfig>(
  {
    id: { type: String, required: true },
    kind: { type: String, enum: ['memes', 'images'], required: true },
    reactions: { type: [String], default: [] },
    enforce: { type: String, enum: ['off', 'warn', 'delete'] },
  },
  { _id: false },
);

const mediaReactionConfigSchema = new Schema<IMediaReactionConfig>(
  {
    guildId: { type: String, required: true, unique: true, index: true },
    enabled: { type: Boolean, default: false },
    memeChannels: { type: [mediaChannelConfigSchema], default: [] },
    imageChannels: { type: [mediaChannelConfigSchema], default: [] },
    memeReactions: { type: [String], default: ['⭐', '😂'] },
    imageReactions: { type: [String], default: ['📸'] },
    enforceMode: { type: String, enum: ['off', 'warn', 'delete'], default: 'warn' },
  },
  { timestamps: true },
);

export const MediaReactionConfig = model<IMediaReactionConfig>(
  'MediaReactionConfig',
  mediaReactionConfigSchema,
);
