import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { AuthUserResponse, PendingUsersResponse } from '@nothing-chat/shared';

import type { ServerConfig } from '../config.js';
import type { AdminService } from '../modules/admin/admin-service.js';
import type { AuthService } from '../modules/auth/auth-service.js';
import { sendApiError } from './api-errors.js';
import { requireCurrentUser } from './auth-context.js';
import { parseRequestData } from './validation.js';

const userParamsSchema = z.object({
  id: z.string().uuid()
});

/**
 * Registers administrator routes for reviewing pending users.
 */
export async function registerAdminRoutes(
  server: FastifyInstance,
  config: ServerConfig,
  authService: AuthService,
  adminService: AdminService
): Promise<void> {
  server.get('/api/admin/pending-users', async (request, reply) => {
    try {
      const actor = await requireCurrentUser(request, config, authService);
      const users = await adminService.listPendingUsers(actor);

      return reply.send({
        users
      } satisfies PendingUsersResponse);
    } catch (error) {
      return sendApiError(reply, error);
    }
  });

  server.post('/api/admin/users/:id/approve', async (request, reply) => {
    try {
      const actor = await requireCurrentUser(request, config, authService);
      const params = parseRequestData(userParamsSchema, request.params);
      const user = await adminService.approveUser(actor, params.id);

      return reply.send({
        user
      } satisfies AuthUserResponse);
    } catch (error) {
      return sendApiError(reply, error);
    }
  });

  server.post('/api/admin/users/:id/reject', async (request, reply) => {
    try {
      const actor = await requireCurrentUser(request, config, authService);
      const params = parseRequestData(userParamsSchema, request.params);
      const user = await adminService.rejectUser(actor, params.id);

      return reply.send({
        user
      } satisfies AuthUserResponse);
    } catch (error) {
      return sendApiError(reply, error);
    }
  });
}

