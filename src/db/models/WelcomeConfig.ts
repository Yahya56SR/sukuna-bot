import { model, Schema, Document } from "mongoose";

export interface IWelcomeConfig extends Document {
  guildId: string;
  /** Welcome channel */
  welcomeChannelId?: string;
  /** Welcome message (supports variables) */
  welcomeMessage?: string;
  /** Welcome embed */
  welcomeEmbed?: {
    title?: string;
    description?: string;
    color?: number;
    thumbnail?: string;
    image?: string;
    footer?: string;
    fields?: Array<{ name: string; value: string; inline?: boolean }>;
  };
  /** DM welcome message */
  dmMessage?: string;
  /** DM welcome embed */
  dmEmbed?: {
    title?: string;
    description?: string;
    color?: number;
    thumbnail?: string;
    image?: string;
    footer?: string;
  };
  /** Leave channel */
  leaveChannelId?: string;
  /** Leave message */
  leaveMessage?: string;
  /** Leave embed */
  leaveEmbed?: {
    title?: string;
    description?: string;
    color?: number;
    thumbnail?: string;
    image?: string;
    footer?: string;
  };
  /** Auto-role on join */
  autoRoleId?: string;
  /** Auto-role for bots */
  botAutoRoleId?: string;
  /** Ban announcement channel */
  banChannelId?: string;
  /** Ban announcement message */
  banMessage?: string;
  /** Member count channel name template */
  memberCountChannelName?: string;
  /** Member count channel ID */
  memberCountChannelId?: string;
  /** Whether to update member count channel */
  updateMemberCount: boolean;
  /** Vanity URL role */
  vanityRoleId?: string;
  /** Vanity URL code (e.g., discord.gg/vanity) */
  vanityCode?: string;
  /** Welcome image settings */
  welcomeImage?: {
    enabled: boolean;
    background?: string;
    avatarBorder?: boolean;
    avatarBorderColor?: number;
    textColor?: number;
    font?: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

const welcomeConfigSchema = new Schema<IWelcomeConfig>(
  {
    guildId: { type: String, required: true, unique: true, index: true },
    welcomeChannelId: { type: String },
    welcomeMessage: { type: String, maxlength: 2000 },
    welcomeEmbed: {
      title: { type: String, maxlength: 256 },
      description: { type: String, maxlength: 4000 },
      color: { type: Number },
      thumbnail: { type: String },
      image: { type: String },
      footer: { type: String, maxlength: 2048 },
      fields: [{
        name: { type: String, maxlength: 256 },
        value: { type: String, maxlength: 1024 },
        inline: { type: Boolean },
      }],
    },
    dmMessage: { type: String, maxlength: 2000 },
    dmEmbed: {
      title: { type: String, maxlength: 256 },
      description: { type: String, maxlength: 4000 },
      color: { type: Number },
      thumbnail: { type: String },
      image: { type: String },
      footer: { type: String, maxlength: 2048 },
    },
    leaveChannelId: { type: String },
    leaveMessage: { type: String, maxlength: 2000 },
    leaveEmbed: {
      title: { type: String, maxlength: 256 },
      description: { type: String, maxlength: 4000 },
      color: { type: Number },
      thumbnail: { type: String },
      image: { type: String },
      footer: { type: String, maxlength: 2048 },
    },
    autoRoleId: { type: String },
    botAutoRoleId: { type: String },
    banChannelId: { type: String },
    banMessage: { type: String, maxlength: 1000 },
    memberCountChannelName: { type: String, maxlength: 100 },
    memberCountChannelId: { type: String },
    updateMemberCount: { type: Boolean, default: false },
    vanityRoleId: { type: String },
    vanityCode: { type: String },
    welcomeImage: {
      enabled: { type: Boolean, default: false },
      background: { type: String },
      avatarBorder: { type: Boolean, default: true },
      avatarBorderColor: { type: Number },
      textColor: { type: Number },
      font: { type: String },
    },
  },
  { timestamps: true },
);

export const WelcomeConfig = model<IWelcomeConfig>("WelcomeConfig", welcomeConfigSchema);