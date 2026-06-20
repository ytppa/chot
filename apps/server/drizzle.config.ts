import { defineConfig } from 'drizzle-kit';

/**
 * Points Drizzle Kit at the server schema and migrations folder.
 */
export default defineConfig({
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://nothing_chat:nothing_chat@127.0.0.1:5432/nothing_chat'
  }
});

