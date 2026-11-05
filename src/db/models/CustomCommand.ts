import { model, Schema, Document } from "mongoose";

export interface ICustomCommand extends Document {
  guildId: string;
  /** Trigger name (what user types) */
  name: string;
  /** Aliases */
  aliases: string[];
  /** Response content (supports variables) */
  content: string;
  /** Embed data (optional) */
  embed?: {
    title?: string;
    description?: string;
    color?: number;
    fields?: Array<{ name: string; value: string; inline?: boolean }>;
    thumbnail?: string;
    image?: string;
    footer?: string;
    author?: { name: string; icon?: string };
  };
  /** Required permissions to use */
  requiredPermissions?: string[];
  /** Required roles to use */
  requiredRoles?: string[];
  /** Cooldown in seconds */
  cooldown?: number;
  /** Whether command is enabled */
  enabled: boolean;
  /** NSFW only */
  nsfw: boolean;
  /** Creator user ID */
  creatorId: string;
  /** Usage count */
  uses: number;
  createdAt: Date;
  updatedAt: Date;
}

const customCommandSchema = new Schema<ICustomCommand>(
  {
    guildId: { type: String, required: true, index: true },
    name: { type: String, required: true, lowercase: true, maxlength: 100 },
    aliases: { type: [String], default: [] },
    content: { type: String, required: true, maxlength: 4000 },
    embed: {
      type: {
        title: { type: String, maxlength: 256 },
        description: { type: String, maxlength: 4000 },
        color: { type: Number },
        fields: [{
          name: { type: String, maxlength: 256 },
          value: { type: String, maxlength: 1024 },
          inline: { type: Boolean },
        }],
        thumbnail: { type: String },
        image: { type: String },
        footer: { type: String, maxlength: 2048 },
        author: {
          name: { type: String, maxlength: 256 },
          icon: { type: String },
        },
      },
      default: undefined,
    },
    requiredPermissions: { type: [String], default: [] },
    requiredRoles: { type: [String], default: [] },
    cooldown: { type: Number, default: 0, min: 0, max: 86400 },
    enabled: { type: Boolean, default: true },
    nsfw: { type: Boolean, default: false },
    creatorId: { type: String, required: true },
    uses: { type: Number, default: 0 },
  },
  { timestamps: true },
);

customCommandSchema.index({ guildId: 1, name: 1 }, { unique: true });
customCommandSchema.index({ guildId: 1, enabled: 1 });

export const CustomCommand = model<ICustomCommand>("CustomCommand", customCommandSchema);