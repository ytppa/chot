import { and, asc, eq, ilike, ne, or } from 'drizzle-orm';

import type { PublicUser } from '@nothing-chat/shared';

import type { Database } from '../../db/client.js';
import { users } from '../../db/schema.js';
import { createServiceUnavailableError, DomainError } from '../common/domain-error.js';

export type UserListOptions = {
  query: string;
  limit: number;
};

export type UserService = {
  listActiveUsers: (actor: PublicUser, options: UserListOptions) => Promise<PublicUser[]>;
};

/**
 * Creates the database-backed user service for people discovery inside chat flows.
 */
export function createDatabaseUserService(db: Database): UserService {
  return {
    listActiveUsers: async (actor, options) => listActiveUsers(db, actor, options)
  };
}

/**
 * Creates a user service that fails safely when the database is not configured.
 */
export function createUnavailableUserService(): UserService {
  return {
    listActiveUsers: async () => {
      throw createServiceUnavailableError();
    }
  };
}

/**
 * Lists active users that the current user can start a direct chat with.
 */
async function listActiveUsers(
  db: Database,
  actor: PublicUser,
  options: UserListOptions
): Promise<PublicUser[]> {
  assertActiveActor(actor);

  const query = options.query.trim();
  const baseFilter = and(eq(users.status, 'active'), ne(users.id, actor.id));
  const searchFilter =
    query === ''
      ? baseFilter
      : and(baseFilter, or(ilike(users.login, `%${query}%`), ilike(users.displayName, `%${query}%`)));

  return db
    .select(createPublicUserSelection())
    .from(users)
    .where(searchFilter)
    .orderBy(asc(users.displayName), asc(users.login))
    .limit(options.limit);
}

/**
 * Ensures user discovery is available only to active authenticated accounts.
 */
function assertActiveActor(actor: PublicUser): void {
  if (actor.status !== 'active') {
    throw new DomainError({
      code: 'forbidden',
      statusCode: 403,
      publicMessage: 'Forbidden.'
    });
  }
}

/**
 * Defines the public user projection returned by user discovery queries.
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
