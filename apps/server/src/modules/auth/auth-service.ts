import argon2 from 'argon2';
import { and, eq, gt, isNull } from 'drizzle-orm';

import type { LoginRequest, PublicUser, RegisterRequest } from '@nothing-chat/shared';

import type { Database } from '../../db/client.js';
import { sessions, users } from '../../db/schema.js';
import { createServiceUnavailableError, DomainError } from '../common/domain-error.js';
import { createSessionExpiry, generateSessionToken, hashSessionToken } from './session-token.js';

export type AuthSession = {
  user: PublicUser;
  token: string;
  expiresAt: Date;
};

export type AuthService = {
  register: (input: RegisterRequest) => Promise<PublicUser>;
  login: (input: LoginRequest) => Promise<AuthSession>;
  logout: (sessionToken: string) => Promise<void>;
  resolveSession: (sessionToken: string) => Promise<PublicUser | null>;
};

export type DatabaseAuthServiceOptions = {
  sessionTtlDays: number;
};

type UserRow = typeof users.$inferSelect;

/**
 * Creates the database-backed auth service used by HTTP auth routes.
 */
export function createDatabaseAuthService(
  db: Database,
  options: DatabaseAuthServiceOptions
): AuthService {
  return {
    register: async (input) => registerUser(db, input),
    login: async (input) => loginUser(db, options, input),
    logout: async (sessionToken) => revokeSession(db, sessionToken),
    resolveSession: async (sessionToken) => resolveSessionUser(db, sessionToken)
  };
}

/**
 * Creates an auth service that fails safely when the database is not configured.
 */
export function createUnavailableAuthService(): AuthService {
  return {
    register: async () => {
      throw createServiceUnavailableError();
    },
    login: async () => {
      throw createServiceUnavailableError();
    },
    logout: async () => {
      throw createServiceUnavailableError();
    },
    resolveSession: async () => {
      throw createServiceUnavailableError();
    }
  };
}

/**
 * Registers a pending user with an argon2id password hash.
 */
async function registerUser(db: Database, input: RegisterRequest): Promise<PublicUser> {
  const passwordHash = await argon2.hash(input.password, {
    type: argon2.argon2id
  });

  try {
    const [createdUser] = await db
      .insert(users)
      .values({
        login: input.login,
        passwordHash,
        displayName: input.displayName,
        role: 'user',
        status: 'pending'
      })
      .returning(createPublicUserSelection());

    if (!createdUser) {
      throw new DomainError({
        code: 'registration_failed',
        statusCode: 500,
        publicMessage: 'Registration failed.'
      });
    }

    return createdUser;
  } catch (error) {
    if (hasDatabaseCode(error, '23505')) {
      throw new DomainError({
        code: 'login_taken',
        statusCode: 409,
        publicMessage: 'Login is already taken.'
      });
    }

    throw error;
  }
}

/**
 * Validates credentials, rejects inactive accounts, and creates a new session.
 */
async function loginUser(
  db: Database,
  options: DatabaseAuthServiceOptions,
  input: LoginRequest
): Promise<AuthSession> {
  const [user] = await db.select().from(users).where(eq(users.login, input.login)).limit(1);

  // Keep credential failure generic so login probing does not reveal which part failed.
  if (!user || !(await argon2.verify(user.passwordHash, input.password))) {
    throw new DomainError({
      code: 'invalid_credentials',
      statusCode: 401,
      publicMessage: 'Invalid login or password.'
    });
  }

  if (user.status !== 'active') {
    throw new DomainError({
      code: 'account_not_active',
      statusCode: 403,
      publicMessage: 'Account is not active.'
    });
  }

  const token = generateSessionToken();
  const tokenHash = hashSessionToken(token);
  const expiresAt = createSessionExpiry(options.sessionTtlDays);

  await db.insert(sessions).values({
    userId: user.id,
    tokenHash,
    expiresAt
  });

  return {
    user: toPublicUser(user),
    token,
    expiresAt
  };
}

/**
 * Revokes the active session associated with the provided opaque token.
 */
async function revokeSession(db: Database, sessionToken: string): Promise<void> {
  const tokenHash = hashSessionToken(sessionToken);

  await db
    .update(sessions)
    .set({
      revokedAt: new Date()
    })
    .where(and(eq(sessions.tokenHash, tokenHash), isNull(sessions.revokedAt)));
}

/**
 * Resolves a valid session token into an active public user.
 */
async function resolveSessionUser(db: Database, sessionToken: string): Promise<PublicUser | null> {
  const tokenHash = hashSessionToken(sessionToken);

  const [sessionUser] = await db
    .select({
      id: users.id,
      login: users.login,
      displayName: users.displayName,
      role: users.role,
      status: users.status
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(
      and(
        eq(sessions.tokenHash, tokenHash),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
        eq(users.status, 'active')
      )
    )
    .limit(1);

  return sessionUser ?? null;
}

/**
 * Defines the public user projection returned by auth queries.
 */
function createPublicUserSelection() {
  return {
    id: users.id,
    login: users.login,
    displayName: users.displayName,
    role: users.role,
    status: users.status
  };
}

/**
 * Converts a full user row into the public user DTO.
 */
function toPublicUser(user: UserRow): PublicUser {
  return {
    id: user.id,
    login: user.login,
    displayName: user.displayName,
    role: user.role,
    status: user.status
  };
}

/**
 * Checks database error codes without depending on a driver-specific error class.
 */
function hasDatabaseCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  );
}

