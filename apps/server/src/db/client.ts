import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import type { Sql } from 'postgres';

import type { DatabaseConfig } from './config.js';
import * as schema from './schema.js';

export type Database = PostgresJsDatabase<typeof schema>;

export type DatabaseClient = {
  db: Database;
  sql: Sql;
  close: () => Promise<void>;
};

/**
 * Creates a PostgreSQL connection and a typed Drizzle database facade.
 */
export function createDatabaseClient(config: DatabaseConfig): DatabaseClient {
  const sql = postgres(config.databaseUrl, {
    max: 10
  });

  return {
    db: drizzle(sql, { schema }),
    sql,
    close: async () => {
      await sql.end({
        timeout: 5
      });
    }
  };
}

