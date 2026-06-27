import { createHash, randomBytes } from 'node:crypto';

/**
 * Generates an opaque session token that can be stored only in the browser cookie.
 */
export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Hashes the opaque token before it is persisted in the database.
 */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Calculates session expiration from a day-based TTL.
 */
export function createSessionExpiry(ttlDays: number): Date {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + ttlDays);

  return expiresAt;
}

