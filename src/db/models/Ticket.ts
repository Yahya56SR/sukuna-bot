/**
 * Ticket system models for the 愛 Bella Star feature-rich ticket system.
 *
 * TicketPanel: a posted, decorated panel with per-department "Create Ticket" buttons.
 * TicketDepartment: a ticket category with its own staff role, welcome message and styling.
 * OpenTicket: an active (or closed) ticket channel mapped to its owner and department.
 * TicketConfig: per-guild ticketing settings (limits, cooldowns, transcripts, staff roles).
 */

import { model, Schema, type Document } from 'mongoose';

/* -------------------------------------------------------------------------- */
/* TicketPanel                                                                */
/* -------------------------------------------------------------------------- */

export interface ITicketPanel extends Document {
  guildId: string;
  channelId: string;
  messageId: string;
  embedTitle: string;
  embedDescription: string;
  embedColor: number;
  embedImage?: string;     // animated gif / image url (the "live" decoration)
  embedThumbnail?: string;
  embedFooter?: string;
  createdAt: Date;
}

const ticketPanelSchema = new Schema<ITicketPanel>(
  {
    guildId: { type: String, required: true, index: true },
    channelId: { type: String, required: true },
    messageId: { type: String, required: true },
    embedTitle: { type: String, required: true, default: '🎫 Support Tickets' },
    embedDescription: {
      type: String,
      required: true,
      default:
        'Click a department below to open a private support ticket. A support team member will be with you shortly.',
    },
    embedColor: { type: Number, required: true, default: 0x5865f2 },
    embedImage: { type: String },
    embedThumbnail: { type: String },
    embedFooter: { type: String, default: '愛 Bella Star • Tickets' },
  },
  { timestamps: true },
);

ticketPanelSchema.index({ guildId: 1, channelId: 1 }, { unique: true });

export const TicketPanel = model<ITicketPanel>('TicketPanel', ticketPanelSchema);

/* -------------------------------------------------------------------------- */
/* TicketDepartment                                                           */
/* -------------------------------------------------------------------------- */

export interface ITicketDepartment extends Document {
  guildId: string;
  name: string;
  description: string;
  emoji: string;
  color: number;
  staffRoleId?: string;   // role that gets access to this department's tickets
  welcomeMessage: string; // posted in the ticket when it is opened
  isActive: boolean;
  createdAt: Date;
}

const ticketDepartmentSchema = new Schema<ITicketDepartment>(
  {
    guildId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    description: { type: String, required: true, default: 'General support' },
    emoji: { type: String, required: true, default: '🎫' },
    color: { type: Number, required: true, default: 0x5865f2 },
    staffRoleId: { type: String },
    welcomeMessage: {
      type: String,
      required: true,
      default: 'Hello {user}! Your ticket has been opened. Support staff will be with you shortly.',
    },
    isActive: { type: Boolean, required: true, default: true },
  },
  { timestamps: true },
);

ticketDepartmentSchema.index({ guildId: 1, name: 1 }, { unique: true });

export const TicketDepartment = model<ITicketDepartment>(
  'TicketDepartment',
  ticketDepartmentSchema,
);

/* -------------------------------------------------------------------------- */
/* OpenTicket                                                                 */
/* -------------------------------------------------------------------------- */

export interface IOpenTicket extends Document {
  guildId: string;
  channelId: string;
  userId: string;
  departmentId: string;
  departmentName: string;
  claimedBy?: string;
  claimedAt?: Date;
  closedAt?: Date;
  closedBy?: string;
  closeReason?: string;
  transcriptSent: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const openTicketSchema = new Schema<IOpenTicket>(
  {
    guildId: { type: String, required: true, index: true },
    channelId: { type: String, required: true, unique: true },
    userId: { type: String, required: true },
    departmentId: { type: String, required: true },
    departmentName: { type: String, required: true },
    claimedBy: { type: String },
    claimedAt: { type: Date },
    closedAt: { type: Date },
    closedBy: { type: String },
    closeReason: { type: String },
    transcriptSent: { type: Boolean, default: false },
  },
  { timestamps: true },
);

// One open ticket per user per guild (partial unique on open rows only).
// This is the DMCA-grade guard against double-click / duplicate event fan-out.
openTicketSchema.index({ guildId: 1, userId: 1 }, { unique: true, partialFilterExpression: { closedAt: null } });
openTicketSchema.index({ guildId: 1, userId: 1, closedAt: 1 });
// Partial indexes: only open (non-closed) tickets are queried hot-path, so
// index only those rows to keep writes cheap and lookups indexed (no COLLSCAN).
openTicketSchema.index({ closedAt: 1 }, { partialFilterExpression: { closedAt: null } });
openTicketSchema.index({ guildId: 1 }, { partialFilterExpression: { closedAt: null } });
openTicketSchema.index({ channelId: 1 }, { unique: true, partialFilterExpression: { closedAt: null } });

export const OpenTicket = model<IOpenTicket>('OpenTicket', openTicketSchema);

/* -------------------------------------------------------------------------- */
/* TicketConfig                                                               */
/* -------------------------------------------------------------------------- */

export interface ITicketConfig extends Document {
  guildId: string;
  transcriptChannelId?: string;
  maxTicketsPerUser: number;
  cooldownSeconds: number;
  autoCloseMinutes: number; // 0 = disabled
  dmTranscript: boolean;    // DM the transcript to the ticket owner on close
  staffRoleIds: string[];   // roles that can manage every ticket in the guild
  createdAt: Date;
  updatedAt: Date;
}

const ticketConfigSchema = new Schema<ITicketConfig>(
  {
    guildId: { type: String, required: true, unique: true, index: true },
    transcriptChannelId: { type: String },
    maxTicketsPerUser: { type: Number, required: true, default: 3 },
    cooldownSeconds: { type: Number, required: true, default: 60 },
    autoCloseMinutes: { type: Number, required: true, default: 0 },
    dmTranscript: { type: Boolean, required: true, default: true },
    staffRoleIds: { type: [String], required: true, default: [] },
  },
  { timestamps: true },
);

export const TicketConfig = model<ITicketConfig>('TicketConfig', ticketConfigSchema);

/* -------------------------------------------------------------------------- */
/* Defaults                                                                   */
/* -------------------------------------------------------------------------- */

export const DEFAULT_DEPARTMENT = {
  name: 'Support',
  description: 'General support and questions',
  emoji: '🎫',
  color: 0x5865f2,
  welcomeMessage:
    'Hello {user}! Your ticket has been opened. Our support team will be with you shortly. Please describe your issue and attach any relevant screenshots.',
};

export function defaultTicketConfig(guildId: string): Partial<ITicketConfig> {
  return {
    guildId,
    maxTicketsPerUser: 3,
    cooldownSeconds: 60,
    autoCloseMinutes: 0,
    dmTranscript: true,
    staffRoleIds: [],
  };
}
