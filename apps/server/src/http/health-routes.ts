import type { FastifyInstance } from 'fastify';

import type { ServerConfig } from '../config.js';

export type HealthResponse = {
  status: 'ok';
  service: 'nothing-chat-server';
  uptimeSeconds: number;
  websocket: {
    path: '/ws';
    maxPayloadBytes: number;
  };
  ts: string;
};

/**
 * Registers lightweight operational endpoints that are safe to expose in local development.
 */
export async function registerHealthRoutes(
  server: FastifyInstance,
  config: ServerConfig
): Promise<void> {
  server.get('/health', async (): Promise<HealthResponse> => {
    return {
      status: 'ok',
      service: 'nothing-chat-server',
      uptimeSeconds: Number(process.uptime().toFixed(3)),
      websocket: {
        path: '/ws',
        maxPayloadBytes: config.websocketMaxPayloadBytes
      },
      ts: new Date().toISOString()
    };
  });
}

