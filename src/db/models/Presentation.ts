import { model, Schema, type Document } from 'mongoose';

export interface IPresentationConfig extends Document {
  guildId: string;
  categoryId?: string;
  staffChannelId?: string;
  staffRoleId?: string;
  questions: string[];
  createdAt: Date;
  updatedAt: Date;
}

const presentationConfigSchema = new Schema<IPresentationConfig>(
  {
    guildId: { type: String, required: true, unique: true, index: true },
    categoryId: { type: String },
    staffChannelId: { type: String },
    staffRoleId: { type: String },
    questions: { type: [String], default: [] },
  },
  { timestamps: true },
);

export const PresentationConfig = model<IPresentationConfig>('PresentationConfig', presentationConfigSchema);

export interface IPresentationApplication extends Document {
  guildId: string;
  userId: string;
  answers: Array<{ question: string; answer: string }>;
  status: 'pending' | 'approved' | 'denied' | 'changes_requested';
  reviewedBy?: string;
  reviewedAt?: Date;
  reviewReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const presentationApplicationSchema = new Schema<IPresentationApplication>(
  {
    guildId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    answers: { type: Schema.Types.Mixed, default: [] },
    status: {
      type: String,
      enum: ['pending', 'approved', 'denied', 'changes_requested'],
      default: 'pending',
      index: true,
    },
    reviewedBy: { type: String },
    reviewedAt: { type: Date },
    reviewReason: { type: String },
  },
  { timestamps: true },
);

presentationApplicationSchema.index({ guildId: 1, userId: 1, status: 1 });

export const PresentationApplication = model<IPresentationApplication>(
  'PresentationApplication',
  presentationApplicationSchema,
);
