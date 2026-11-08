import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../database/schema';

export type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>;
