import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { UsersResponse } from '@nothing-chat/shared';

import type { ServerConfig } from '../config.js';
import type { AuthService } from '../modules/auth/auth-service.js';
import type { UserService } from '../modules/users/user-service.js';
import { sendApiError } from './api-errors.js';
import { requireCurrentUser } from './auth-context.js';
import { parseRequestData } from './validation.js';

const usersQuerySchema = z.object({
  query: z.string().trim().max(64).optional().default(''),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20)
});

/**
 * Registers user discovery routes used by direct chat creation.
 */
export async function registerUserRoutes(
  server: FastifyInstance,
  config: ServerConfig,
  authService: AuthService,
  userService: UserService
): Promise<void> {
  server.get('/api/users', async (request, reply) => {
    try {
      const actor = await requireCurrentUser(request, config, authService);
      const query = parseRequestData(usersQuerySchema, request.query);
      const users = await userService.listActiveUsers(actor, query);

      return reply.send({
        users
      } satisfies UsersResponse);
    } catch (error) {
      return sendApiError(reply, error);
    }
  });
}
