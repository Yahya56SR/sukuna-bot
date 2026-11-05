import { model, Schema, Document } from "mongoose";

export interface ISuggestion extends Document {
  guildId: string;
  channelId: string;
  messageId?: string;
  /** Suggestion author */
  authorId: string;
  /** Title/summary */
  title: string;
  /** Full description */
  description: string;
  /** Current status */
  status: 'pending' | 'approved' | 'denied' | 'implemented' | 'deferred';
  /** Staff member who reviewed */
  reviewedBy?: string;
  /** Review reason */
  reviewReason?: string;
  /** Review timestamp */
  reviewedAt?: Date;
  /** Upvotes */
  upvotes: string[];
  /** Downvotes */
  downvotes: string[];
  /** Anonymous suggestion */
  anonymous: boolean;
  /** Attachments */
  attachments: string[];
  createdAt: Date;
  updatedAt: Date;
}

const suggestionSchema = new Schema<ISuggestion>(
  {
    guildId: { type: String, required: true, index: true },
    channelId: { type: String, required: true },
    messageId: { type: String },
    authorId: { type: String, required: true, index: true },
    title: { type: String, required: true, maxlength: 256 },
    description: { type: String, required: true, maxlength: 4000 },
    status: {
      type: String,
      enum: ['pending', 'approved', 'denied', 'implemented', 'deferred'],
      default: 'pending',
      index: true,
    },
    reviewedBy: { type: String },
    reviewReason: { type: String, maxlength: 1000 },
    reviewedAt: { type: Date },
    upvotes: { type: [String], default: [] },
    downvotes: { type: [String], default: [] },
    anonymous: { type: Boolean, default: false },
    attachments: { type: [String], default: [] },
  },
  { timestamps: true },
);

suggestionSchema.index({ guildId: 1, status: 1, createdAt: -1 });
suggestionSchema.index({ guildId: 1, channelId: 1 });

export const Suggestion = model<ISuggestion>("Suggestion", suggestionSchema);