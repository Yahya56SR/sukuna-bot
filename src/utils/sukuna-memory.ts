/**
 * Durable notes Sukuna can save about a server and its members.
 * Stored in MongoDB so the character keeps continuity across restarts.
 */

import { SukunaMemory } from '../db/models/SukunaMemory.js';

export interface ISukunaMemory {
  guildId: string;
  fact: string;
  aboutUserId?: string;
  aboutName?: string;
  createdAt: number;
  _id?: any;
}

const MAX_NOTES_PER_GUILD = 300;
const MAX_FACT_LENGTH = 400;

export async function addMemory(guildId: string, input: { fact: string; aboutUserId?: string; aboutName?: string }): Promise<ISukunaMemory> {
  const fact = String(input.fact || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_FACT_LENGTH);
  
  if (!fact) {
    return { guildId, fact: '', createdAt: 0 };
  }

  // Check for exact duplicate
  const duplicate = await SukunaMemory.findOne({
    guildId,
    fact,
    aboutUserId: input.aboutUserId ?? null,
  });
  
  if (duplicate) return duplicate;

  const note = await SukunaMemory.create({
    guildId,
    fact,
    aboutUserId: input.aboutUserId || undefined,
    aboutName: input.aboutName?.slice(0, 80),
    createdAt: Date.now(),
  });

  // Enforce cap
  const count = await SukunaMemory.countDocuments({ guildId });
  if (count > MAX_NOTES_PER_GUILD) {
    const excess = count - MAX_NOTES_PER_GUILD;
    const oldest = await SukunaMemory.find({ guildId })
      .sort({ createdAt: 1 })
      .limit(excess)
      .select('_id');
    const ids = oldest.map((n) => n._id);
    await SukunaMemory.deleteMany({ _id: { $in: ids } });
  }

  return note;
}

export async function recallMemories(
  guildId: string,
  options: { about?: string; limit?: number } = {},
): Promise<ISukunaMemory[]> {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
  const about = options.about?.trim();

  const query: any = { guildId };
  if (about) {
    query.$or = [
      { aboutUserId: about },
      { aboutName: new RegExp(about, 'i') },
    ];
  }

  return SukunaMemory.find(query)
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean() as Promise<ISukunaMemory[]>;
}

export async function countMemories(guildId: string): Promise<number> {
  return SukunaMemory.countDocuments({ guildId });
}

/**
 * Free-text search over stored notes (fact text, member name, member id).
 * `recallMemories` only matches the `about` fields; this is what the
 * `search_memory` tool uses.
 */
export async function searchMemories(
  guildId: string,
  query: string,
  limit = 10,
): Promise<ISukunaMemory[]> {
  const capped = Math.min(Math.max(limit, 1), 100);
  const trimmed = query.trim();

  const filter: any = { guildId };
  if (trimmed) {
    const safe = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(safe, 'i');
    filter.$or = [{ fact: pattern }, { aboutName: pattern }, { aboutUserId: trimmed }];
  }

  return SukunaMemory.find(filter)
    .sort({ createdAt: -1 })
    .limit(capped)
    .lean() as Promise<ISukunaMemory[]>;
}

export async function clearMemories(guildId: string): Promise<number> {
  return SukunaMemory.deleteMany({ guildId }).then((result) => result.deletedCount);
}