import { pathToFileURL } from 'node:url';

import type { FastifyInstance } from 'fastify';

import { buildServer } from './app.js';
import { readServerConfig, type ServerConfig } from './config.js';
import { createDatabaseClient } from './db/client.js';
import { readDatabaseConfig } from './db/config.js';
import { createDatabaseAdminService } from './modules/admin/admin-service.js';
import { createDatabaseAuthService } from './modules/auth/auth-service.js';
import { createDatabaseChatService } from './modules/chats/chat-service.js';
import { createDatabaseUserService } from './modules/users/user-service.js';

/**
 * Starts the HTTP and WebSocket server with the provided runtime configuration.
 */
export async function startServer(config: ServerConfig = readServerConfig()): Promise<FastifyInstance> {
  const database = createDatabaseClient(readDatabaseConfig());
  const server = await buildServer(config, {
    authService: createDatabaseAuthService(database.db, {
      sessionTtlDays: config.sessionTtlDays
    }),
    adminService: createDatabaseAdminService(database.db),
    chatService: createDatabaseChatService(database.db),
    userService: createDatabaseUserService(database.db)
  });

  // Close the database pool together with the HTTP server.
  server.addHook('onClose', async () => {
    await database.close();
  });

  await server.listen({
    host: config.host,
    port: config.port
  });

  return server;
}

/**
 * Detects direct CLI execution without running the server during tests or imports.
 */
function isMainModule(): boolean {
  const entrypoint = process.argv[1];
  return entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href;
}

if (isMainModule()) {
  startServer().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
