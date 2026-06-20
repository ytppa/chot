import websocketPlugin from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';

import type { ServerConfig } from './config.js';
import { registerHealthRoutes } from './http/health-routes.js';
import { registerWebSocketGateway } from './ws/gateway.js';

/**
 * Builds the Fastify application with all HTTP and WebSocket routes registered.
 */
export async function buildServer(config: ServerConfig): Promise<FastifyInstance> {
  const server = Fastify({
    logger: {
      level: config.logLevel
    }
  });

  // Register the WebSocket plugin before routes so `/ws` can use Fastify's websocket handler.
  await server.register(websocketPlugin, {
    options: {
      maxPayload: config.websocketMaxPayloadBytes
    }
  });

  // Keep HTTP and realtime boundaries explicit from the first backend milestone.
  await registerHealthRoutes(server, config);
  await registerWebSocketGateway(server);

  return server;
}

