import type { FastifyRequest } from 'fastify';
import type { PublicUser } from '@nothing-chat/shared';

import type { ServerConfig } from '../config.js';
import type { AuthService } from '../modules/auth/auth-service.js';
import { DomainError } from '../modules/common/domain-error.js';

/**
 * Reads the opaque session token from the configured cookie.
 */
export function readSessionToken(request: FastifyRequest, config: ServerConfig): string | null {
  const token = request.cookies[config.sessionCookieName];
  return token && token.trim() !== '' ? token : null;
}

/**
 * Resolves the current active user or rejects the request.
 */
export async function requireCurrentUser(
  request: FastifyRequest,
  config: ServerConfig,
  authService: AuthService
): Promise<PublicUser> {
  const sessionToken = readSessionToken(request, config);
  if (!sessionToken) {
    throw new DomainError({
      code: 'session_required',
      statusCode: 401,
      publicMessage: 'Session is required.'
    });
  }

  const user = await authService.resolveSession(sessionToken);
  if (!user) {
    throw new DomainError({
      code: 'session_required',
      statusCode: 401,
      publicMessage: 'Session is required.'
    });
  }

  return user;
}

