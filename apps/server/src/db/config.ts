export type DatabaseConfig = {
  databaseUrl: string;
};

type Environment = Record<string, string | undefined>;

/**
 * Reads database configuration required by Drizzle and seed scripts.
 */
export function readDatabaseConfig(env: Environment = process.env): DatabaseConfig {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl || databaseUrl.trim() === '') {
    throw new Error('DATABASE_URL is required for database operations.');
  }

  return {
    databaseUrl
  };
}

