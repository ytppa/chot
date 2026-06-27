import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';

import type { AuthUserResponse, LoginRequest, RegisterRequest } from '@nothing-chat/shared';

import type { ServerConfig } from '../config.js';
import type { AuthService } from '../modules/auth/auth-service.js';
import { sendApiError } from './api-errors.js';
import { readSessionToken, requireCurrentUser } from './auth-context.js';
import { parseRequestData } from './validation.js';

const registerBodySchema = z.object({
  login: z.string().trim().min(3).max(64),
  password: z.string().min(8).max(256),
  displayName: z.string().trim().min(1).max(120)
});

const loginBodySchema = z.object({
  login: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(256)
});

/**
 * Registers auth HTTP routes for registration, login, logout, and current user lookup.
 */
export async function registerAuthRoutes(
  server: FastifyInstance,
  config: ServerConfig,
  authService: AuthService
): Promise<void> {
  server.post('/api/auth/register', async (request, reply) => {
    try {
      const payload = parseRequestData(registerBodySchema, request.body) satisfies RegisterRequest;
      const user = await authService.register(payload);

      return reply.code(201).send({
        user
      } satisfies AuthUserResponse);
    } catch (error) {
      return sendApiError(reply, error);
    }
  });

  server.post('/api/auth/login', async (request, reply) => {
    try {
      const payload = parseRequestData(loginBodySchema, request.body) satisfies LoginRequest;
      const session = await authService.login(payload);

      setSessionCookie(reply, config, session.token, session.expiresAt);

      return reply.send({
        user: session.user
      } satisfies AuthUserResponse);
    } catch (error) {
      return sendApiError(reply, error);
    }
  });

  server.post('/api/auth/logout', async (request, reply) => {
    try {
      const sessionToken = readSessionToken(request, config);
      if (sessionToken) {
        await authService.logout(sessionToken);
      }

      clearSessionCookie(reply, config);

      return reply.code(204).send();
    } catch (error) {
      return sendApiError(reply, error);
    }
  });

  server.get('/api/auth/me', async (request, reply) => {
    try {
      const user = await requireCurrentUser(request, config, authService);

      return reply.send({
        user
      } satisfies AuthUserResponse);
    } catch (error) {
      return sendApiError(reply, error);
    }
  });
}

/**
 * Writes the opaque session token into an HttpOnly browser cookie.
 */
function setSessionCookie(
  reply: FastifyReply,
  config: ServerConfig,
  token: string,
  expiresAt: Date
): void {
  reply.setCookie(config.sessionCookieName, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProduction,
    expires: expiresAt
  });
}

/**
 * Clears the session cookie after logout or invalidation.
 */
function clearSessionCookie(reply: FastifyReply, config: ServerConfig): void {
  reply.clearCookie(config.sessionCookieName, {
    path: '/'
  });
}

