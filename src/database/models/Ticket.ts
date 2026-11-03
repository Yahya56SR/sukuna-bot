import { model, Schema, Document } from "mongoose";

export interface ITicket extends Document {
  ticketId: string;
  guildId: string;
  channelId: string;
  userId: string;
  status: "open" | "closed" | "claimed";
  claimedBy?: string;
  topic?: string;
  createdAt: Date;
  closedAt?: Date;
}

const ticketSchema = new Schema<ITicket>(
  {
    ticketId: { type: String, required: true, unique: true },
    guildId: { type: String, required: true },
    channelId: { type: String, required: true },
    userId: { type: String, required: true },
    status: { type: String, default: "open" },
    claimedBy: { type: String },
    topic: { type: String },
  },
  { timestamps: true }
);

export const Ticket = model<ITicket>("Ticket", ticketSchema);
