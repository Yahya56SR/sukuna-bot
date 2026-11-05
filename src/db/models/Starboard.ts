import { model, Schema, Document } from "mongoose";

export interface IStarboardConfig extends Document {
  guildId: string;
  /** Channel to post starred messages */
  channelId: string;
  /** Minimum stars required */
  threshold: number;
  /** Emoji to use for starring (default ⭐) */
  emoji: string;
  /** Whether to allow self-star */
  allowSelfStar: boolean;
  /** Whether to star bot messages */
  allowBotMessages: boolean;
  /** Whether to star messages with attachments only */
  requireAttachment: boolean;
  /** Whether to star messages with embeds only */
  requireEmbed: boolean;
  /** Ignored channels */
  ignoredChannels: string[];
  /** Ignored roles */
  ignoredRoles: string[];
  /** Custom color for starboard embeds */
  color?: number;
  /** Whether to include jump link */
  includeJumpLink: boolean;
  /** Whether to show star count on original message */
  showCountOnOriginal: boolean;
  /** Max age of message to be starred (days, 0 = no limit) */
  maxAgeDays: number;
  /** Whether to allow multiple stars per message (creates new entry each threshold) */
  allowMultiple: boolean;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const starboardConfigSchema = new Schema<IStarboardConfig>(
  {
    guildId: { type: String, required: true, unique: true, index: true },
    channelId: { type: String, required: true },
    threshold: { type: Number, required: true, min: 1, max: 1000, default: 5 },
    emoji: { type: String, default: '⭐' },
    allowSelfStar: { type: Boolean, default: false },
    allowBotMessages: { type: Boolean, default: false },
    requireAttachment: { type: Boolean, default: false },
    requireEmbed: { type: Boolean, default: false },
    ignoredChannels: { type: [String], default: [] },
    ignoredRoles: { type: [String], default: [] },
    color: { type: Number },
    includeJumpLink: { type: Boolean, default: true },
    showCountOnOriginal: { type: Boolean, default: false },
    maxAgeDays: { type: Number, default: 0, min: 0 },
    allowMultiple: { type: Boolean, default: false },
    enabled: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export interface IStarboardEntry extends Document {
  guildId: string;
  /** Original message ID */
  messageId: string;
  /** Starboard message ID */
  starboardMessageId: string;
  /** Channel ID of original message */
  channelId: string;
  /** Author of original message */
  authorId: string;
  /** Current star count */
  stars: number;
  /** Users who starred */
  starredBy: string[];
  createdAt: Date;
  updatedAt: Date;
}

const starboardEntrySchema = new Schema<IStarboardEntry>(
  {
    guildId: { type: String, required: true, index: true },
    messageId: { type: String, required: true },
    starboardMessageId: { type: String, required: true },
    channelId: { type: String, required: true },
    authorId: { type: String, required: true },
    stars: { type: Number, default: 1 },
    starredBy: { type: [String], default: [] },
  },
  { timestamps: true },
);

starboardEntrySchema.index({ guildId: 1, messageId: 1 }, { unique: true });
starboardEntrySchema.index({ guildId: 1, starboardMessageId: 1 });

export const StarboardConfig = model<IStarboardConfig>("StarboardConfig", starboardConfigSchema);
export const StarboardEntry = model<IStarboardEntry>("StarboardEntry", starboardEntrySchema);