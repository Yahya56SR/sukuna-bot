import { model, Schema, Document } from "mongoose";

export interface IAutoModRule extends Document {
  guildId: string;
  name: string;
  type: 'spam' | 'links' | 'invites' | 'words' | 'caps' | 'mentions' | 'attachments' | 'newlines' | 'emojis' | 'repeated';
  enabled: boolean;
  /** Action to take: delete, warn, timeout, ban, log */
  actions: ('delete' | 'warn' | 'timeout' | 'ban' | 'log')[];
  /** Timeout duration in seconds (for timeout action) */
  timeoutDuration?: number;
  /** Warning message (for warn action) */
  warnMessage?: string;
  /** Log channel ID */
  logChannel?: string;
  /** Channels to ignore */
  ignoreChannels: string[];
  /** Roles to ignore (users with these roles bypass) */
  ignoreRoles: string[];
  /** Rule-specific configuration */
  config: {
    /** For spam: max messages per window */
    maxMessages?: number;
    /** For spam: window in seconds */
    windowSeconds?: number;
    /** For links: allow list domains */
    allowedDomains?: string[];
    /** For words: list of banned words/phrases */
    bannedWords?: string[];
    /** For words: regex patterns */
    regexPatterns?: string[];
    /** For caps: minimum message length to check */
    minLength?: number;
    /** For caps: max percentage of caps allowed */
    maxCapsPercent?: number;
    /** For mentions: max mentions per message */
    maxMentions?: number;
    /** For attachments: blocked extensions */
    blockedExtensions?: string[];
    /** For newlines: max newlines */
    maxNewlines?: number;
    /** For emojis: max emojis */
    maxEmojis?: number;
    /** For repeated: max similar messages */
    maxRepeated?: number;
  };
  createdAt: Date;
  updatedAt: Date;
}

const autoModRuleSchema = new Schema<IAutoModRule>(
  {
    guildId: { type: String, required: true, index: true },
    name: { type: String, required: true, maxlength: 100 },
    type: {
      type: String,
      enum: ['spam', 'links', 'invites', 'words', 'caps', 'mentions', 'attachments', 'newlines', 'emojis', 'repeated'],
      required: true,
    },
    enabled: { type: Boolean, default: true },
    actions: {
      type: [String],
      enum: ['delete', 'warn', 'timeout', 'ban', 'log'],
      default: ['delete', 'log'],
    },
    timeoutDuration: { type: Number, default: 300 },
    warnMessage: { type: String, maxlength: 500 },
    logChannel: { type: String },
    ignoreChannels: { type: [String], default: [] },
    ignoreRoles: { type: [String], default: [] },
    config: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true },
);

autoModRuleSchema.index({ guildId: 1, type: 1 });

export const AutoModRule = model<IAutoModRule>("AutoModRule", autoModRuleSchema);