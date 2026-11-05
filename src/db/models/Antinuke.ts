import { model, Schema, type Document } from 'mongoose';

export interface IAntinukeConfig extends Document {
  guildId: string;
  enabled: boolean;
  alertChannelId?: string;
  thresholds: {
    ban: number;
    kick: number;
    channelDelete: number;
    channelOverwrite: number;
    roleDelete: number;
    webhookDelete: number;
    bulkDelete: number;
    everyoneRole: number;
  };
  windowSec: number;
  timeoutMinutes: number;
  autoStrip: boolean;
  exemptRoleIds: string[];
  backup: {
    enabled: boolean;
    intervalMin: number;
    keep: number;
  };
  createdAt: Date;
  updatedAt: Date;
}

const antinukeConfigSchema = new Schema<IAntinukeConfig>(
  {
    guildId: { type: String, required: true, unique: true, index: true },
    enabled: { type: Boolean, default: false },
    alertChannelId: { type: String },
    thresholds: {
      type: Schema.Types.Mixed,
      default: {
        ban: 3, kick: 5, channelDelete: 3, channelOverwrite: 8,
        roleDelete: 3, webhookDelete: 3, bulkDelete: 1, everyoneRole: 1,
      },
    },
    windowSec: { type: Number, default: 60 },
    timeoutMinutes: { type: Number, default: 1440 },
    autoStrip: { type: Boolean, default: true },
    exemptRoleIds: { type: [String], default: [] },
    backup: {
      type: Schema.Types.Mixed,
      default: { enabled: true, intervalMin: 60, keep: 24 },
    },
  },
  { timestamps: true },
);

export const AntinukeConfig = model<IAntinukeConfig>('AntinukeConfig', antinukeConfigSchema);

export interface IAntinukeIncident extends Document {
  guildId: string;
  actorId: string;
  actorTag?: string;
  action: string;
  count: number;
  windowSec: number;
  strippedRoles: string[];
  timeoutMinutes: number;
  status: 'locked' | 'unlocked';
  details: string;
  createdAt: Date;
  updatedAt: Date;
}

const antinukeIncidentSchema = new Schema<IAntinukeIncident>(
  {
    guildId: { type: String, required: true, index: true },
    actorId: { type: String, required: true, index: true },
    actorTag: { type: String },
    action: { type: String, required: true },
    count: { type: Number, required: true },
    windowSec: { type: Number, required: true },
    strippedRoles: { type: [String], default: [] },
    timeoutMinutes: { type: Number, default: 0 },
    status: { type: String, enum: ['locked', 'unlocked'], default: 'locked', index: true },
    details: { type: String },
  },
  { timestamps: true },
);

antinukeIncidentSchema.index({ guildId: 1, actorId: 1, status: 1 });

export const AntinukeIncident = model<IAntinukeIncident>('AntinukeIncident', antinukeIncidentSchema);
