import { pathToFileURL } from 'node:url';

import type { FastifyInstance } from 'fastify';

import { buildServer } from './app.js';
import { readServerConfig, type ServerConfig } from './config.js';

/**
 * Starts the HTTP and WebSocket server with the provided runtime configuration.
 */
export async function startServer(config: ServerConfig = readServerConfig()): Promise<FastifyInstance> {
  const server = await buildServer(config);
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
