import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type {
  ChatMessagesResponse,
  CreateDirectChatRequest,
  DirectChatResponse,
  DirectChatsResponse,
  ReadChatResponse
} from '@nothing-chat/shared';

import type { ServerConfig } from '../config.js';
import type { AuthService } from '../modules/auth/auth-service.js';
import type { ChatService } from '../modules/chats/chat-service.js';
import { sendApiError } from './api-errors.js';
import { requireCurrentUser } from './auth-context.js';
import { parseRequestData } from './validation.js';

const createDirectChatBodySchema = z.object({
  userId: z.string().uuid()
});

const chatParamsSchema = z.object({
  id: z.string().uuid()
});

const messageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  beforeSeq: z.coerce.number().int().positive().optional()
});

/**
 * Registers direct chat HTTP routes for the first chat-management milestone.
 */
export async function registerChatRoutes(
  server: FastifyInstance,
  config: ServerConfig,
  authService: AuthService,
  chatService: ChatService
): Promise<void> {
  server.get('/api/chats/direct', async (request, reply) => {
    try {
      const actor = await requireCurrentUser(request, config, authService);
      const chats = await chatService.listDirectChats(actor);

      return reply.send({
        chats
      } satisfies DirectChatsResponse);
    } catch (error) {
      return sendApiError(reply, error);
    }
  });

  server.post('/api/chats/direct', async (request, reply) => {
    try {
      const actor = await requireCurrentUser(request, config, authService);
      const payload = parseRequestData(
        createDirectChatBodySchema,
        request.body
      ) satisfies CreateDirectChatRequest;
      const chat = await chatService.createDirectChat(actor, payload.userId);

      return reply.code(201).send({
        chat
      } satisfies DirectChatResponse);
    } catch (error) {
      return sendApiError(reply, error);
    }
  });

  server.get('/api/chats/:id/messages', async (request, reply) => {
    try {
      const actor = await requireCurrentUser(request, config, authService);
      const params = parseRequestData(chatParamsSchema, request.params);
      const query = parseRequestData(messageQuerySchema, request.query);
      const page = await chatService.listMessages(actor, params.id, {
        limit: query.limit,
        beforeSeq: query.beforeSeq ?? null
      });

      return reply.send({
        messages: page.messages,
        page: {
          limit: query.limit,
          beforeSeq: query.beforeSeq ?? null,
          hasMore: page.hasMore
        }
      } satisfies ChatMessagesResponse);
    } catch (error) {
      return sendApiError(reply, error);
    }
  });

  server.post('/api/chats/:id/read', async (request, reply) => {
    try {
      const actor = await requireCurrentUser(request, config, authService);
      const params = parseRequestData(chatParamsSchema, request.params);
      const readState = await chatService.markChatRead(actor, params.id);

      return reply.send(readState satisfies ReadChatResponse);
    } catch (error) {
      return sendApiError(reply, error);
    }
  });
}
