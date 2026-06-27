import cookiePlugin from '@fastify/cookie';
import websocketPlugin from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';

import type { ServerConfig } from './config.js';
import { registerAdminRoutes } from './http/admin-routes.js';
import { registerAuthRoutes } from './http/auth-routes.js';
import { registerChatRoutes } from './http/chat-routes.js';
import { registerHealthRoutes } from './http/health-routes.js';
import { registerUserRoutes } from './http/user-routes.js';
import { createUnavailableAdminService, type AdminService } from './modules/admin/admin-service.js';
import { createUnavailableAuthService, type AuthService } from './modules/auth/auth-service.js';
import { createUnavailableChatService, type ChatService } from './modules/chats/chat-service.js';
import { createUnavailableUserService, type UserService } from './modules/users/user-service.js';
import { registerWebSocketGateway } from './ws/gateway.js';

export type AppServices = {
  authService: AuthService;
  adminService: AdminService;
  chatService: ChatService;
  userService: UserService;
};

/**
 * Builds the Fastify application with all HTTP and WebSocket routes registered.
 */
export async function buildServer(
  config: ServerConfig,
  services: AppServices = createUnavailableServices()
): Promise<FastifyInstance> {
  const server = Fastify({
    logger: {
      level: config.logLevel
    }
  });

  // Register cookie support before auth routes so session cookies are parsed and writable.
  await server.register(cookiePlugin);

  // Register the WebSocket plugin before routes so `/ws` can use Fastify's websocket handler.
  await server.register(websocketPlugin, {
    options: {
      maxPayload: config.websocketMaxPayloadBytes
    }
  });

  // Keep HTTP and realtime boundaries explicit from the first backend milestone.
  await registerHealthRoutes(server, config);
  await registerAuthRoutes(server, config, services.authService);
  await registerAdminRoutes(server, config, services.authService, services.adminService);
  await registerUserRoutes(server, config, services.authService, services.userService);
  await registerChatRoutes(server, config, services.authService, services.chatService);
  await registerWebSocketGateway(server, config, services.authService, services.chatService);

  return server;
}

/**
 * Provides route-safe fallback services for tests that do not need a live database.
 */
function createUnavailableServices(): AppServices {
  return {
    authService: createUnavailableAuthService(),
    adminService: createUnavailableAdminService(),
    chatService: createUnavailableChatService(),
    userService: createUnavailableUserService()
  };
}
