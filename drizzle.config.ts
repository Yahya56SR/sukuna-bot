import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/database/schema/index.ts',
  driver: 'better-sqlite3',
  dialect: 'sqlite',
  dbCredentials: {
    url: './data/sukuna.db',
  },
  verbose: true,
  strict: true,
});
