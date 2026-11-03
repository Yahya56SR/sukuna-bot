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

export { readGuildConfig } from './models/Guild.js';
export { getUser } from './models/User.js';
export { xpForLevel } from './utils.js';
