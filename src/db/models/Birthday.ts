import { model, Schema, Document } from "mongoose";

export interface IBirthday extends Document {
  userId: string;
  guildId: string;
  /** Birth date (month-day, year optional) */
  month: number; // 1-12
  day: number; // 1-31
  year?: number; // optional
  /** Whether to announce on birthday */
  announce: boolean;
  /** Custom announcement message */
  customMessage?: string;
  /** Role to give on birthday (optional) */
  roleId?: string;
  /** Last announced year */
  lastAnnouncedYear?: number;
  /** Timezone for birthday calculation */
  timezone: string;
  createdAt: Date;
  updatedAt: Date;
}

const birthdaySchema = new Schema<IBirthday>(
  {
    userId: { type: String, required: true },
    guildId: { type: String, required: true, index: true },
    month: { type: Number, required: true, min: 1, max: 12 },
    day: { type: Number, required: true, min: 1, max: 31 },
    year: { type: Number, min: 1900, max: new Date().getFullYear() },
    announce: { type: Boolean, default: true },
    customMessage: { type: String, maxlength: 500 },
    roleId: { type: String },
    lastAnnouncedYear: { type: Number },
    timezone: { type: String, default: 'UTC' },
  },
  { timestamps: true },
);

birthdaySchema.index({ guildId: 1, month: 1, day: 1 });
birthdaySchema.index({ guildId: 1, userId: 1 }, { unique: true });

export const Birthday = model<IBirthday>("Birthday", birthdaySchema);