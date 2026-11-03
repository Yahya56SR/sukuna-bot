/**
 * Sukuna storage module - MongoDB-backed storage for announcements, FAQ, events, scheduled messages, rules.
 */

import { model, Schema, Document } from 'mongoose';

const MAX_ENTRIES = 500;

// Announcements
export interface IAnnouncement extends Document {
  guildId: string;
  title: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}

const announcementSchema = new Schema<IAnnouncement>({
  guildId: { type: String, required: true, index: true },
  title: { type: String, required: true },
  content: { type: String, required: true },
  createdAt: { type: Number, required: true },
  updatedAt: { type: Number, required: true },
});

export const SukunaAnnouncement = model<IAnnouncement>('SukunaAnnouncement', announcementSchema);

// FAQ entries
export interface IFaqEntry extends Document {
  guildId: string;
  question: string;
  answer: string;
  tags?: string[];
  createdAt: number;
  updatedAt: number;
}

const faqSchema = new Schema<IFaqEntry>({
  guildId: { type: String, required: true },
  question: { type: String, required: true, index: 'text' },
  answer: { type: String, required: true },
  tags: { type: [String], default: [] },
  createdAt: { type: Number, required: true },
  updatedAt: { type: Number, required: true },
});

export const SukunaFaq = model<IFaqEntry>('SukunaFaq', faqSchema);

// Server events
export interface IServerEvent extends Document {
  guildId: string;
  title: string;
  description: string;
  startsAt: number;
  endsAt?: number;
  pinned?: boolean;
  createdAt: number;
}

const eventSchema = new Schema<IServerEvent>({
  guildId: { type: String, required: true, index: true },
  title: { type: String, required: true },
  description: { type: String },
  startsAt: { type: Number, required: true, index: true },
  endsAt: { type: Number },
  pinned: { type: Boolean, default: false },
  createdAt: { type: Number, required: true },
});

export const SukunaEvent = model<IServerEvent>('SukunaEvent', eventSchema);

// Scheduled messages
export interface IScheduledMessage extends Document {
  guildId: string;
  channelId: string;
  content: string;
  scheduledAt: number;
  sentAt?: number;
  messageId?: string;
  createdAt: number;
}

const scheduledSchema = new Schema<IScheduledMessage>({
  guildId: { type: String, required: true, index: true },
  channelId: { type: String, required: true },
  content: { type: String, required: true },
  scheduledAt: { type: Number, required: true, index: true },
  sentAt: { type: Number },
  messageId: { type: String },
  createdAt: { type: Number, required: true },
});

export const SukunaScheduled = model<IScheduledMessage>('SukunaScheduled', scheduledSchema);

// Server rules
export interface IServerRule extends Document {
  guildId: string;
  rules: string[];
  updatedAt: number;
}

const rulesSchema = new Schema<IServerRule>({
  guildId: { type: String, required: true, unique: true },
  rules: { type: [String], required: true },
  updatedAt: { type: Number, required: true },
});

export const SukunaRules = model<IServerRule>('SukunaRules', rulesSchema);

// API functions

export async function createAnnouncement(
  guildId: string,
  input: { title: string; content: string },
): Promise<IAnnouncement> {
  return SukunaAnnouncement.create({
    guildId,
    title: input.title,
    content: input.content,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
}

export async function listAnnouncements(guildId: string, limit = 20): Promise<IAnnouncement[]> {
  return SukunaAnnouncement.find({ guildId }).sort({ createdAt: -1 }).limit(limit).lean();
}

export function deleteAnnouncement(guildId: string, entryId: string): Promise<boolean> {
  return SukunaAnnouncement.deleteOne({ guildId, _id: entryId }).then(
    (result) => result.deletedCount === 1,
  );
}

export function getServerRules(guildId: string): Promise<IServerRule | null> {
  return SukunaRules.findOne({ guildId }).lean();
}

export async function upsertServerRules(
  guildId: string,
  rules: string[],
): Promise<IServerRule> {
  return SukunaRules.findOneAndUpdate(
    { guildId },
    { rules, updatedAt: Date.now() },
    { upsert: true, new: true },
  ).lean().then((doc) => doc!);
}

export async function createFaqEntry(
  guildId: string,
  input: { question: string; answer: string; tags?: string[] },
): Promise<IFaqEntry> {
  return SukunaFaq.create({
    guildId,
    question: input.question,
    answer: input.answer,
    tags: input.tags ?? [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
}

export async function listFaq(guildId: string, limit = 50): Promise<IFaqEntry[]> {
  return SukunaFaq.find({ guildId }).sort({ createdAt: -1 }).limit(limit).lean();
}

export async function searchFaq(guildId: string, query: string, limit = 10): Promise<IFaqEntry[]> {
  return SukunaFaq.find({ guildId, $text: { $search: query } })
    .sort({ score: { $meta: 'textScore' } })
    .limit(limit)
    .lean();
}

export function deleteFaqEntry(guildId: string, entryId: string): Promise<boolean> {
  return SukunaFaq.deleteOne({ guildId, _id: entryId }).then((result) => result.deletedCount === 1);
}

export function updateFaqEntry(
  guildId: string,
  entryId: string,
  update: { question?: string; answer?: string; tags?: string[] },
): Promise<boolean> {
  return SukunaFaq.updateOne({ guildId, _id: entryId }, { ...update, updatedAt: Date.now() }).then(
    (result) => result.modifiedCount === 1,
  );
}

export async function createServerEvent(
  guildId: string,
  input: { title: string; description?: string; startsAt: number; endsAt?: number; pinned?: boolean },
): Promise<IServerEvent> {
  return SukunaEvent.create({
    guildId,
    title: input.title,
    description: input.description,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    pinned: input.pinned ?? false,
    createdAt: Date.now(),
  });
}

export async function listServerEvents(guildId: string, limit = 50): Promise<IServerEvent[]> {
  return SukunaEvent.find({ guildId }).sort({ startsAt: 1 }).limit(limit).lean();
}

export function cancelScheduledMessage(guildId: string, messageId: string): Promise<boolean> {
  return SukunaScheduled.deleteOne({ guildId, _id: messageId }).then((result) => result.deletedCount === 1);
}

export async function createScheduledMessage(
  guildId: string,
  input: { channelId: string; content: string; scheduledAt: number },
): Promise<IScheduledMessage> {
  return SukunaScheduled.create({
    guildId,
    channelId: input.channelId,
    content: input.content,
    scheduledAt: input.scheduledAt,
    createdAt: Date.now(),
  });
}

export async function dueScheduledMessages(guildId: string, limit = 10): Promise<IScheduledMessage[]> {
  const now = Date.now();
  return SukunaScheduled.find({ guildId, sentAt: { $exists: false }, scheduledAt: { $lte: now } })
    .sort({ scheduledAt: 1 })
    .limit(limit)
    .lean();
}

export async function markScheduledMessageSent(guildId: string, messageId: string, discordMessageId: string): Promise<boolean> {
  return SukunaScheduled.updateOne(
    { guildId, _id: messageId },
    { sentAt: Date.now(), messageId: discordMessageId },
  ).then((result) => result.modifiedCount === 1);
}

export function countScheduled(guildId: string): Promise<number> {
  return SukunaScheduled.countDocuments({ guildId, sentAt: { $exists: false } });
}