import { model, Schema, type Document } from 'mongoose';

export interface IVerificationConfig extends Document {
  guildId: string;
  enabled: boolean;
  unverifiedRoleId?: string;
  verifiedRoleId?: string;
  rulesChannelId?: string;
  panelMessageId?: string;
  autoRoleIds: string[];
  requireApproval: boolean;
  logChannelId?: string;
  minAccountAgeDays: number;
  voiceChannelId?: string;
  staffRoleId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const verificationConfigSchema = new Schema<IVerificationConfig>(
  {
    guildId: { type: String, required: true, unique: true, index: true },
    enabled: { type: Boolean, default: false },
    unverifiedRoleId: { type: String },
    verifiedRoleId: { type: String },
    rulesChannelId: { type: String },
    panelMessageId: { type: String },
    autoRoleIds: { type: [String], default: [] },
    requireApproval: { type: Boolean, default: false },
    logChannelId: { type: String },
    minAccountAgeDays: { type: Number, default: 0 },
    voiceChannelId: { type: String },
    staffRoleId: { type: String },
  },
  { timestamps: true },
);

export const VerificationConfig = model<IVerificationConfig>(
  'VerificationConfig',
  verificationConfigSchema,
);

export interface IVerificationRequest extends Document {
  guildId: string;
  userId: string;
  status: 'pending' | 'claimed' | 'approved' | 'denied' | 'revoked';
  reason?: string;
  submittedAt: Date;
  reviewedBy?: string;
  reviewedAt?: Date;
  claimedBy?: string;
  claimedAt?: Date;
  vcInvitedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const verificationRequestSchema = new Schema<IVerificationRequest>(
  {
    guildId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    status: {
      type: String,
      enum: ['pending', 'claimed', 'approved', 'denied', 'revoked'],
      default: 'pending',
      index: true,
    },
    reason: { type: String },
    submittedAt: { type: Date, default: Date.now },
    reviewedBy: { type: String },
    reviewedAt: { type: Date },
    claimedBy: { type: String },
    claimedAt: { type: Date },
    vcInvitedAt: { type: Date },
  },
  { timestamps: true },
);

verificationRequestSchema.index({ guildId: 1, userId: 1, status: 1 });
verificationRequestSchema.index({ guildId: 1, claimedBy: 1, status: 1 });

export const VerificationRequest = model<IVerificationRequest>(
  'VerificationRequest',
  verificationRequestSchema,
);
