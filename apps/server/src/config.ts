export type ServerLogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';

export type ServerConfig = {
  nodeEnv: string;
  isProduction: boolean;
  host: string;
  port: number;
  logLevel: ServerLogLevel;
  websocketMaxPayloadBytes: number;
  sessionCookieName: string;
  sessionTtlDays: number;
};

type Environment = Record<string, string | undefined>;

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3000;
const DEFAULT_LOG_LEVEL: ServerLogLevel = 'info';
const DEFAULT_WEBSOCKET_MAX_PAYLOAD_BYTES = 64 * 1024;
const DEFAULT_SESSION_COOKIE_NAME = 'nothing_chat_session';
const DEFAULT_SESSION_TTL_DAYS = 30;
const LOG_LEVELS = new Set<ServerLogLevel>([
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
  'silent'
]);

/**
 * Reads server configuration from environment variables and applies safe local defaults.
 */
export function readServerConfig(env: Environment = process.env): ServerConfig {
  const nodeEnv = env.NODE_ENV ?? 'development';

  return {
    nodeEnv,
    isProduction: nodeEnv === 'production',
    host: env.HOST ?? DEFAULT_HOST,
    port: readPositiveInteger(env, 'PORT', DEFAULT_PORT),
    logLevel: readLogLevel(env.LOG_LEVEL),
    websocketMaxPayloadBytes: readPositiveInteger(
      env,
      'WS_MAX_PAYLOAD_BYTES',
      DEFAULT_WEBSOCKET_MAX_PAYLOAD_BYTES
    ),
    sessionCookieName: env.SESSION_COOKIE_NAME ?? DEFAULT_SESSION_COOKIE_NAME,
    sessionTtlDays: readPositiveInteger(env, 'SESSION_TTL_DAYS', DEFAULT_SESSION_TTL_DAYS)
  };
}

/**
 * Parses positive integer config values and fails early on invalid environment input.
 */
function readPositiveInteger(env: Environment, key: string, fallback: number): number {
  const rawValue = env[key];
  if (rawValue === undefined || rawValue.trim() === '') {
    return fallback;
  }

  const parsedValue = Number(rawValue);
  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    throw new Error(`${key} must be a positive integer.`);
  }

  return parsedValue;
}

/**
 * Normalizes Fastify logger levels while rejecting misspelled values.
 */
function readLogLevel(rawValue: string | undefined): ServerLogLevel {
  if (rawValue === undefined || rawValue.trim() === '') {
    return DEFAULT_LOG_LEVEL;
  }

  const normalizedValue = rawValue.trim().toLowerCase();
  if (!LOG_LEVELS.has(normalizedValue as ServerLogLevel)) {
    throw new Error(`LOG_LEVEL must be one of: ${Array.from(LOG_LEVELS).join(', ')}.`);
  }

  return normalizedValue as ServerLogLevel;
}
