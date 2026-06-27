import { and, asc, eq } from 'drizzle-orm';

import type { PublicUser } from '@nothing-chat/shared';

import type { Database } from '../../db/client.js';
import { users } from '../../db/schema.js';
import { createServiceUnavailableError, DomainError } from '../common/domain-error.js';

export type AdminService = {
  listPendingUsers: (actor: PublicUser) => Promise<PublicUser[]>;
  approveUser: (actor: PublicUser, userId: string) => Promise<PublicUser>;
  rejectUser: (actor: PublicUser, userId: string) => Promise<PublicUser>;
};

/**
 * Creates the database-backed admin service for pending user moderation.
 */
export function createDatabaseAdminService(db: Database): AdminService {
  return {
    listPendingUsers: async (actor) => listPendingUsers(db, actor),
    approveUser: async (actor, userId) => updatePendingUserStatus(db, actor, userId, 'active'),
    rejectUser: async (actor, userId) => updatePendingUserStatus(db, actor, userId, 'rejected')
  };
}

/**
 * Creates an admin service that fails safely when the database is not configured.
 */
export function createUnavailableAdminService(): AdminService {
  return {
    listPendingUsers: async () => {
      throw createServiceUnavailableError();
    },
    approveUser: async () => {
      throw createServiceUnavailableError();
    },
    rejectUser: async () => {
      throw createServiceUnavailableError();
    }
  };
}

/**
 * Lists all users waiting for administrator approval.
 */
async function listPendingUsers(db: Database, actor: PublicUser): Promise<PublicUser[]> {
  assertAdmin(actor);

  return db
    .select(createPublicUserSelection())
    .from(users)
    .where(eq(users.status, 'pending'))
    .orderBy(asc(users.createdAt));
}

/**
 * Moves a pending user into the selected review status.
 */
async function updatePendingUserStatus(
  db: Database,
  actor: PublicUser,
  userId: string,
  status: 'active' | 'rejected'
): Promise<PublicUser> {
  assertAdmin(actor);

  const [updatedUser] = await db
    .update(users)
    .set({
      status,
      verifiedAt: new Date(),
      verifiedBy: actor.id
    })
    .where(and(eq(users.id, userId), eq(users.status, 'pending')))
    .returning(createPublicUserSelection());

  if (!updatedUser) {
    throw new DomainError({
      code: 'pending_user_not_found',
      statusCode: 404,
      publicMessage: 'Pending user was not found.'
    });
  }

  return updatedUser;
}

/**
 * Ensures that only active admins can perform user review actions.
 */
function assertAdmin(actor: PublicUser): void {
  if (actor.role !== 'admin' || actor.status !== 'active') {
    throw new DomainError({
      code: 'forbidden',
      statusCode: 403,
      publicMessage: 'Forbidden.'
    });
  }
}

/**
 * Defines the public user projection returned by admin queries.
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

