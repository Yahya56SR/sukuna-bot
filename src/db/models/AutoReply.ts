import { model, Schema, type Document } from 'mongoose';

export interface IAutoReply extends Document {
  guildId: string;
  triggerType: 'keyword' | 'regex' | 'exact';
  triggerValue: string;
  response: string;
  channelId?: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const autoReplySchema = new Schema<IAutoReply>(
  {
    guildId: { type: String, required: true, index: true },
    triggerType: {
      type: String,
      enum: ['keyword', 'regex', 'exact'],
      required: true,
    },
    triggerValue: { type: String, required: true },
    response: { type: String, required: true },
    channelId: { type: String },
    enabled: { type: Boolean, default: true },
  },
  { timestamps: true },
);

autoReplySchema.index({ guildId: 1, enabled: 1, channelId: 1 });

export const AutoReply = model<IAutoReply>('AutoReply', autoReplySchema);
