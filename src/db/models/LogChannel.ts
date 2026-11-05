import { model, Schema, Document } from "mongoose";

export interface ILogChannel extends Document {
  guildId: string;
  /** Event type */
  event: LogEventType;
  /** Channel ID to log to */
  channelId: string;
  /** Whether to include message content */
  includeContent: boolean;
  /** Whether to log bot messages */
  logBots: boolean;
  /** Ignored channels */
  ignoredChannels: string[];
  /** Ignored roles (users with these roles won't be logged) */
  ignoredRoles: string[];
  /** Webhook ID for sending (for better formatting) */
  webhookId?: string;
  webhookToken?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type LogEventType =
  | 'messageDelete'
  | 'messageEdit'
  | 'messageDeleteBulk'
  | 'memberJoin'
  | 'memberLeave'
  | 'memberBanAdd'
  | 'memberBanRemove'
  | 'memberUpdate'
  | 'roleCreate'
  | 'roleDelete'
  | 'roleUpdate'
  | 'channelCreate'
  | 'channelDelete'
  | 'channelUpdate'
  | 'voiceStateUpdate'
  | 'inviteCreate'
  | 'inviteDelete'
  | 'guildUpdate'
  | 'emojiCreate'
  | 'emojiDelete'
  | 'emojiUpdate'
  | 'stickerCreate'
  | 'stickerDelete'
  | 'stickerUpdate'
  | 'threadCreate'
  | 'threadDelete'
  | 'threadUpdate'
  | 'moderationWarn'
  | 'moderationTimeout'
  | 'moderationBan'
  | 'moderationKick'
  | 'moderationUnban'
  | 'moderationNote'
  | 'automodTrigger';

const logChannelSchema = new Schema<ILogChannel>(
  {
    guildId: { type: String, required: true, index: true },
    event: {
      type: String,
      enum: [
        'messageDelete', 'messageEdit', 'messageDeleteBulk',
        'memberJoin', 'memberLeave', 'memberBanAdd', 'memberBanRemove', 'memberUpdate',
        'roleCreate', 'roleDelete', 'roleUpdate',
        'channelCreate', 'channelDelete', 'channelUpdate',
        'voiceStateUpdate',
        'inviteCreate', 'inviteDelete',
        'guildUpdate',
        'emojiCreate', 'emojiDelete', 'emojiUpdate',
        'stickerCreate', 'stickerDelete', 'stickerUpdate',
        'threadCreate', 'threadDelete', 'threadUpdate',
        'moderationWarn', 'moderationTimeout', 'moderationBan', 'moderationKick', 'moderationUnban', 'moderationNote',
        'automodTrigger',
      ],
      required: true,
    },
    channelId: { type: String, required: true },
    includeContent: { type: Boolean, default: true },
    logBots: { type: Boolean, default: false },
    ignoredChannels: { type: [String], default: [] },
    ignoredRoles: { type: [String], default: [] },
    webhookId: { type: String },
    webhookToken: { type: String },
  },
  { timestamps: true },
);

logChannelSchema.index({ guildId: 1, event: 1 }, { unique: true });

export const LogChannel = model<ILogChannel>("LogChannel", logChannelSchema);