import { model, Schema, Document } from "mongoose";

export interface IReactionRoleOption {
  roleId: string;
  /** Emoji (unicode or custom <:name:id>) */
  emoji: string;
  /** Label for button/select menu */
  label?: string;
  /** Description for select menu */
  description?: string;
}

export interface IReactionRolePanel extends Document {
  guildId: string;
  channelId: string;
  messageId?: string;
  /** Panel title */
  title: string;
  /** Panel description */
  description?: string;
  /** Color for embed */
  color?: number;
  /** Image URL for embed */
  image?: string;
  /** Thumbnail URL */
  thumbnail?: string;
  /** Mode: unique (one role), verify (button), reversed (remove on react), binding (require role), temporary (time-limited) */
  mode: 'unique' | 'verify' | 'reversed' | 'binding' | 'temporary';
  /** For temporary mode: role duration in seconds */
  temporaryDuration?: number;
  /** For binding mode: required role ID */
  bindingRoleId?: string;
  /** Options */
  options: IReactionRoleOption[];
  /** Use buttons instead of reactions */
  useButtons: boolean;
  /** For buttons: style (1=primary, 2=secondary, 3=success, 4=danger) */
  buttonStyle?: 1 | 2 | 3 | 4;
  /** For select menu: placeholder */
  selectPlaceholder?: string;
  /** For select menu: min/max selections */
  minSelect?: number;
  maxSelect?: number;
  /** Whether panel is active */
  active: boolean;
  /** DM user when role added/removed */
  dmUser: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const reactionRoleOptionSchema = new Schema<IReactionRoleOption>(
  {
    roleId: { type: String, required: true },
    emoji: { type: String, required: true },
    label: { type: String, maxlength: 80 },
    description: { type: String, maxlength: 100 },
  },
  { _id: false },
);

const reactionRolePanelSchema = new Schema<IReactionRolePanel>(
  {
    guildId: { type: String, required: true, index: true },
    channelId: { type: String, required: true },
    messageId: { type: String },
    title: { type: String, required: true, maxlength: 256 },
    description: { type: String, maxlength: 4000 },
    color: { type: Number },
    image: { type: String },
    thumbnail: { type: String },
    mode: {
      type: String,
      enum: ['unique', 'verify', 'reversed', 'binding', 'temporary'],
      default: 'unique',
    },
    temporaryDuration: { type: Number },
    bindingRoleId: { type: String },
    options: { type: [reactionRoleOptionSchema], default: [] },
    useButtons: { type: Boolean, default: false },
    buttonStyle: { type: Number, enum: [1, 2, 3, 4] },
    selectPlaceholder: { type: String, maxlength: 150 },
    minSelect: { type: Number, default: 1, min: 1, max: 25 },
    maxSelect: { type: Number, default: 1, min: 1, max: 25 },
    active: { type: Boolean, default: true },
    dmUser: { type: Boolean, default: false },
  },
  { timestamps: true },
);

reactionRolePanelSchema.index({ guildId: 1, channelId: 1 });
reactionRolePanelSchema.index({ messageId: 1 });

export const ReactionRolePanel = model<IReactionRolePanel>("ReactionRolePanel", reactionRolePanelSchema);