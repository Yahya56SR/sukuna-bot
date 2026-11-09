"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.addMemory = addMemory;
exports.recallMemories = recallMemories;
exports.clearMemories = clearMemories;
exports.countMemories = countMemories;
/**
 * Durable notes the Sukuna persona can save about a server and its members.
 * Stored next to the main DB (`data/sukuna-memory.json`) so continuity
 * survives restarts. Writes are synchronous and best-effort.
 */
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
function memoryPath() {
    return path_1.default.join(__dirname, '..', '..', '..', 'data', 'sukuna-memory.json');
}
const MAX_NOTES_PER_GUILD = 300;
const MAX_FACT_LENGTH = 400;
let cache = null;
let sequence = 0;
function load() {
    if (cache)
        return cache;
    try {
        const p = memoryPath();
        if (fs_1.default.existsSync(p)) {
            const parsed = JSON.parse(fs_1.default.readFileSync(p, 'utf8'));
            cache = {
                version: 1,
                guilds: parsed && typeof parsed.guilds === 'object' && parsed.guilds !== null
                    ? parsed.guilds
                    : {},
            };
        }
        else {
            cache = { version: 1, guilds: {} };
        }
    }
    catch {
        cache = { version: 1, guilds: {} };
    }
    return cache;
}
function save(db) {
    try {
        const p = memoryPath();
        fs_1.default.mkdirSync(path_1.default.dirname(p), { recursive: true });
        fs_1.default.writeFileSync(p, `${JSON.stringify(db, null, 2)}\n`, 'utf8');
    }
    catch {
        // never break a reply for memory IO
    }
}
function nextId() {
    sequence = (sequence + 1) % 1000;
    return `m${Date.now().toString(36)}${sequence.toString(36).padStart(2, '0')}`;
}
function addMemory(guildId, input) {
    const fact = String(input.fact || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, MAX_FACT_LENGTH);
    if (!fact)
        return null;
    const db = load();
    const notes = db.guilds[guildId] ?? [];
    const duplicate = notes.find((note) => note.fact.toLowerCase() === fact.toLowerCase() &&
        (note.aboutUserId ?? '') === (input.aboutUserId ?? ''));
    if (duplicate)
        return duplicate;
    const note = {
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
function recallMemories(guildId, options = {}) {
    const db = load();
    const notes = db.guilds[guildId] ?? [];
    const limit = Math.min(Math.max(Math.floor(options.limit ?? 20), 1), 100);
    const about = options.about?.trim().toLowerCase();
    const filtered = about
        ? notes.filter((note) => note.aboutUserId?.toLowerCase() === about ||
            note.aboutName?.toLowerCase() === about ||
            note.aboutName?.toLowerCase().includes(about))
        : notes;
    return [...filtered].sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
}
function clearMemories(guildId) {
    const db = load();
    const notes = db.guilds[guildId] ?? [];
    const count = notes.length;
    delete db.guilds[guildId];
    save(db);
    return count;
}
function countMemories(guildId) {
    return (load().guilds[guildId] ?? []).length;
}
