import { model, Schema, Document } from "mongoose";

export interface IReminder extends Document {
  userId: string;
  guildId?: string;
  channelId?: string;
  /** Reminder text */
  text: string;
  /** When to remind (timestamp) */
  remindAt: Date;
  /** Whether reminder has been sent */
  sent: boolean;
  /** Recurring pattern (cron-like) */
  recurring?: {
    pattern: string; // e.g., "0 * * * *" for hourly
    timezone: string;
    nextRun: Date;
  };
  /** Original message reference */
  messageId?: string;
  /** DM instead of channel mention */
  dm: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const reminderSchema = new Schema<IReminder>(
  {
    userId: { type: String, required: true, index: true },
    guildId: { type: String, index: true },
    channelId: { type: String },
    text: { type: String, required: true, maxlength: 2000 },
    remindAt: { type: Date, required: true, index: true },
    sent: { type: Boolean, default: false, index: true },
    recurring: {
      pattern: { type: String },
      timezone: { type: String, default: 'UTC' },
      nextRun: { type: Date },
    },
    messageId: { type: String },
    dm: { type: Boolean, default: false },
  },
  { timestamps: true },
);

reminderSchema.index({ sent: 1, remindAt: 1 });

export const Reminder = model<IReminder>("Reminder", reminderSchema);