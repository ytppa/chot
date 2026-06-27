export type DatabaseConfig = {
  databaseUrl: string;
};

type Environment = Record<string, string | undefined>;

const DEFAULT_LOCAL_DATABASE_URL = 'postgres://nothing_chat:nothing_chat@127.0.0.1:5432/nothing_chat';

/**
 * Reads database configuration required by Drizzle and seed scripts.
 */
export function readDatabaseConfig(env: Environment = process.env): DatabaseConfig {
  const databaseUrl = env.DATABASE_URL;
  if ((!databaseUrl || databaseUrl.trim() === '') && env.NODE_ENV === 'production') {
    throw new Error('DATABASE_URL is required for database operations.');
  }

  return {
    databaseUrl: databaseUrl && databaseUrl.trim() !== '' ? databaseUrl : DEFAULT_LOCAL_DATABASE_URL
  };
}
