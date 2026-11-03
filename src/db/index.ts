import mongoose from "mongoose";

let _conn: typeof mongoose | null = null;

export async function connectDatabase(uri: string): Promise<typeof mongoose> {
  if (_conn) return _conn;
  _conn = await mongoose.connect(uri);
  return _conn;
}

export async function disconnectDatabase(): Promise<void> {
  if (_conn) {
    await _conn.disconnect();
    _conn = null;
  }
}

export { mongoose };
export type Database = typeof mongoose;

export { readGuildConfig, getGuildId, updateGuildConfig } from './models/Guild.js';
export { TicketPanel, OpenTicket } from './models/Ticket.js';
export { getUser, updateUser } from './models/User.js';
export {
  xpForLevel,
  effectiveXp,
  getUserXp,
  addXp,
  setUserXp,
  getLeaderboard,
  countRanked,
  getRankPosition,
} from './utils.js';
export type { AddXpResult, UserXpRow, XpRow } from './utils.js';