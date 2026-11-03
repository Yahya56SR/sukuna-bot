/**
 * Ticket system models for button-based support tickets.
 *
 * TicketPanel: a posted panel with a "Create Ticket" button in a channel.
 * OpenTicket: an active ticket channel mapped to its owner.
 */

import { model, Schema, type Document } from 'mongoose';

export interface ITicketPanel extends Document {
  guildId: string;
  channelId: string;
  messageId: string;
  createdAt: Date;
}

const ticketPanelSchema = new Schema<ITicketPanel>(
  {
    guildId: { type: String, required: true, index: true },
    channelId: { type: String, required: true },
    messageId: { type: String, required: true },
  },
  { timestamps: true },
);

export const TicketPanel = model<ITicketPanel>('TicketPanel', ticketPanelSchema);

export interface IOpenTicket extends Document {
  guildId: string;
  channelId: string;
  userId: string;
  createdAt: Date;
  closedAt?: Date;
}

const openTicketSchema = new Schema<IOpenTicket>(
  {
    guildId: { type: String, required: true, index: true },
    channelId: { type: String, required: true, unique: true },
    userId: { type: String, required: true },
    closedAt: { type: Date },
  },
  { timestamps: true },
);

export const OpenTicket = model<IOpenTicket>('OpenTicket', openTicketSchema);
