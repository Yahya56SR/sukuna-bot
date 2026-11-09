/**
 * Durable notes the Sukuna persona can save about a server and its members.
 * Stored next to the main DB (`data/sukuna-memory.json`) so continuity
 * survives restarts. Writes are synchronous and best-effort.
 */
import fs from 'fs';
import path from 'path';

export interface SukunaMemoryNote {
  id: string;
  fact: string;
  aboutUserId?: string | undefined;
  aboutName?: string | undefined;
  createdAt: number;
}

interface MemoryDb {
  version: number;
  guilds: Record<string, SukunaMemoryNote[]>;
}

function memoryPath(): string {
  return path.join(__dirname, '..', '..', '..', 'data', 'sukuna-memory.json');
}

const MAX_NOTES_PER_GUILD = 300;
const MAX_FACT_LENGTH = 400;

let cache: MemoryDb | null = null;
let sequence = 0;

function load(): MemoryDb {
  if (cache) return cache;
  try {
    const p = memoryPath();
    if (fs.existsSync(p)) {
      const parsed = JSON.parse(fs.readFileSync(p, 'utf8')) as Partial<MemoryDb>;
      cache = {
        version: 1,
        guilds:
          parsed && typeof parsed.guilds === 'object' && parsed.guilds !== null
            ? (parsed.guilds as Record<string, SukunaMemoryNote[]>)
            : {},
      };
    } else {
      cache = { version: 1, guilds: {} };
    }
  } catch {
    cache = { version: 1, guilds: {} };
  }
  return cache;
}

function save(db: MemoryDb): void {
  try {
    const p = memoryPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, `${JSON.stringify(db, null, 2)}\n`, 'utf8');
  } catch {
    // never break a reply for memory IO
  }
}

function nextId(): string {
  sequence = (sequence + 1) % 1000;
  return `m${Date.now().toString(36)}${sequence.toString(36).padStart(2, '0')}`;
}

export interface AddMemoryInput {
  fact: string;
  aboutUserId?: string;
  aboutName?: string;
}

export function addMemory(guildId: string, input: AddMemoryInput): SukunaMemoryNote | null {
  const fact = String(input.fact || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_FACT_LENGTH);
  if (!fact) return null;

  const db = load();
  const notes = db.guilds[guildId] ?? [];

  const duplicate = notes.find(
    (note) =>
      note.fact.toLowerCase() === fact.toLowerCase() &&
      (note.aboutUserId ?? '') === (input.aboutUserId ?? ''),
  );
  if (duplicate) return duplicate;

  const note: SukunaMemoryNote = {
    id: nextId(),
    fact,
    aboutUserId: input.aboutUserId || undefined,
    aboutName: input.aboutName ? input.aboutName.slice(0, 80) : undefined,
    createdAt: Date.now(),
  };

  notes.push(note);
  if (notes.length > MAX_NOTES_PER_GUILD) {
    notes.splice(0, notes.length - MAX_NOTES_PER_GUILD);
  }
  db.guilds[guildId] = notes;
  save(db);
  return note;
}

export interface RecallOptions {
  about?: string;
  limit?: number;
}

export function recallMemories(guildId: string, options: RecallOptions = {}): SukunaMemoryNote[] {
  const db = load();
  const notes = db.guilds[guildId] ?? [];
  const limit = Math.min(Math.max(Math.floor(options.limit ?? 20), 1), 100);
  const about = options.about?.trim().toLowerCase();
  const filtered = about
    ? notes.filter(
        (note) =>
          note.aboutUserId?.toLowerCase() === about ||
          note.aboutName?.toLowerCase() === about ||
          note.aboutName?.toLowerCase().includes(about),
      )
    : notes;
  return [...filtered].sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
}

export function clearMemories(guildId: string): number {
  const db = load();
  const notes = db.guilds[guildId] ?? [];
  const count = notes.length;
  delete db.guilds[guildId];
  save(db);
  return count;
}

export function countMemories(guildId: string): number {
  return (load().guilds[guildId] ?? []).length;
}
