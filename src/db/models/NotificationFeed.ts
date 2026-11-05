import { model, Schema, Document } from "mongoose";

export type FeedType = 'twitch' | 'youtube' | 'reddit' | 'twitter' | 'rss' | 'steam';

export interface INotificationFeed extends Document {
  guildId: string;
  type: FeedType;
  channelId: string;
  source: string;
  sourceUrl?: string;
  message?: string;
  color?: number;
  roleId?: string;
  pingEveryone: boolean;
  active: boolean;
  lastChecked?: Date;
  lastItemId?: string;
  errorCount: number;
  lastError?: string;
  keywords?: string[];
  excludeKeywords?: string[];
  redditSort?: 'hot' | 'new' | 'top' | 'rising';
  redditTime?: 'hour' | 'day' | 'week' | 'month' | 'year' | 'all';
  rssHeaders?: Record<string, string>;
  createdAt: Date;
  updatedAt: Date;
}

const notificationFeedSchema = new Schema<INotificationFeed>(
  {
    guildId: { type: String, required: true, index: true },
    type: {
      type: String,
      enum: ['twitch', 'youtube', 'reddit', 'twitter', 'rss', 'steam'],
      required: true,
    },
    channelId: { type: String, required: true },
    source: { type: String, required: true },
    sourceUrl: { type: String },
    message: { type: String, maxlength: 2000 },
    color: { type: Number },
    roleId: { type: String },
    pingEveryone: { type: Boolean, default: false },
    active: { type: Boolean, default: true },
    lastChecked: { type: Date },
    lastItemId: { type: String },
    errorCount: { type: Number, default: 0 },
    lastError: { type: String },
    keywords: { type: [String], default: [] },
    excludeKeywords: { type: [String], default: [] },
    redditSort: { type: String, enum: ['hot', 'new', 'top', 'rising'] },
    redditTime: { type: String, enum: ['hour', 'day', 'week', 'month', 'year', 'all'] },
    rssHeaders: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

notificationFeedSchema.index({ guildId: 1, type: 1, source: 1 }, { unique: true });
notificationFeedSchema.index({ active: 1, lastChecked: 1 });

export const NotificationFeed = model<INotificationFeed>("NotificationFeed", notificationFeedSchema);