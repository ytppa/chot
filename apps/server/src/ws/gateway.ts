import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { RawData, WebSocket } from 'ws';
import { z } from 'zod';

import type {
  ClientEventEnvelope,
  MessageAckPayload,
  MessageCreatedPayload,
  PongServerEvent,
  PublicUser,
  SendMessagePayload,
  ServerEventEnvelope,
  WebSocketErrorPayload
} from '@nothing-chat/shared';

import type { ServerConfig } from '../config.js';
import type { AuthService } from '../modules/auth/auth-service.js';
import type { ChatService } from '../modules/chats/chat-service.js';
import { DomainError } from '../modules/common/domain-error.js';
import { readSessionToken } from '../http/auth-context.js';

type ParsedClientEvent =
  | {
      ok: true;
      event: ClientEventEnvelope;
    }
  | {
      ok: false;
      code: string;
      message: string;
    };

const sendMessagePayloadSchema = z.object({
  chatId: z.string().uuid(),
  body: z.string().trim().min(1).max(5000),
  clientNonce: z.string().uuid()
});

/**
 * Tracks active sockets by user id so chat events can be delivered to online members.
 */
class RealtimeConnections {
  private readonly socketsByUserId = new Map<string, Set<WebSocket>>();

  /**
   * Adds one authenticated socket to the online user index.
   */
  public add(userId: string, socket: WebSocket): void {
    const userSockets = this.socketsByUserId.get(userId) ?? new Set<WebSocket>();
    userSockets.add(socket);
    this.socketsByUserId.set(userId, userSockets);
  }

  /**
   * Removes a closed socket from the online user index.
   */
  public remove(userId: string, socket: WebSocket): void {
    const userSockets = this.socketsByUserId.get(userId);
    if (!userSockets) {
      return;
    }

    userSockets.delete(socket);
    if (userSockets.size === 0) {
      this.socketsByUserId.delete(userId);
    }
  }

  /**
   * Sends one event to all online sockets for the given users except an optional source socket.
   */
  public broadcast<TPayload>(
    userIds: string[],
    event: ServerEventEnvelope<TPayload>,
    exceptSocket?: WebSocket
  ): void {
    for (const userId of userIds) {
      const userSockets = this.socketsByUserId.get(userId);
      if (!userSockets) {
        continue;
      }

      for (const socket of userSockets) {
        if (socket !== exceptSocket) {
          sendServerEvent(socket, event);
        }
      }
    }
  }
}

/**
 * Registers the realtime gateway for authenticated chat message delivery.
 */
export async function registerWebSocketGateway(
  server: FastifyInstance,
  config: ServerConfig,
  authService: AuthService,
  chatService: ChatService
): Promise<void> {
  const connections = new RealtimeConnections();

  server.get('/ws', { websocket: true }, (socket, request) => {
    void handleWebSocketConnection(socket, request, config, authService, chatService, connections);
  });
}

/**
 * Authenticates one WebSocket connection before accepting realtime events.
 */
async function handleWebSocketConnection(
  socket: WebSocket,
  request: FastifyRequest,
  config: ServerConfig,
  authService: AuthService,
  chatService: ChatService,
  connections: RealtimeConnections
): Promise<void> {
  try {
    const actor = await resolveSocketUser(request, config, authService);
    connections.add(actor.id, socket);

    socket.on('message', (rawMessage) => {
      void handleWebSocketMessage(socket, rawMessage, actor, chatService, connections);
    });

    socket.on('close', () => {
      connections.remove(actor.id, socket);
    });

    socket.on('error', () => {
      connections.remove(actor.id, socket);
    });
  } catch (error) {
    sendServerEvent(socket, createErrorEvent(undefined, getErrorCode(error), getErrorMessage(error)));
    socket.close(1008, 'Session required');
  }
}

/**
 * Resolves the current active user from the WebSocket upgrade request cookie.
 */
async function resolveSocketUser(
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

/**
 * Handles one client WebSocket envelope and sends the matching server event.
 */
async function handleWebSocketMessage(
  socket: WebSocket,
  rawMessage: RawData,
  actor: PublicUser,
  chatService: ChatService,
  connections: RealtimeConnections
): Promise<void> {
  const parsedEvent = parseClientEvent(rawMessage);
  if (!parsedEvent.ok) {
    sendServerEvent(socket, createErrorEvent(undefined, parsedEvent.code, parsedEvent.message));
    return;
  }

  try {
    if (parsedEvent.event.type === 'ping') {
      sendServerEvent(socket, createPongEvent(parsedEvent.event));
      return;
    }

    if (parsedEvent.event.type === 'message.send') {
      await handleSendMessage(socket, parsedEvent.event, actor, chatService, connections);
      return;
    }

    sendServerEvent(
      socket,
      createErrorEvent(
        parsedEvent.event.id,
        'unknown_event',
        `Unsupported client event type: ${parsedEvent.event.type}.`
      )
    );
  } catch (error) {
    sendServerEvent(
      socket,
      createErrorEvent(parsedEvent.event.id, getErrorCode(error), getErrorMessage(error))
    );
  }
}

/**
 * Persists a chat message and fans it out to online chat participants.
 */
async function handleSendMessage(
  socket: WebSocket,
  event: ClientEventEnvelope,
  actor: PublicUser,
  chatService: ChatService,
  connections: RealtimeConnections
): Promise<void> {
  const payload = parseEventPayload(sendMessagePayloadSchema, event.payload) satisfies SendMessagePayload;
  const delivery = await chatService.sendMessage(actor, payload);

  sendServerEvent(socket, createMessageAckEvent(event.id, payload.clientNonce, delivery.message));
  connections.broadcast(
    delivery.participantUserIds,
    createMessageCreatedEvent(delivery.message),
    socket
  );
}

/**
 * Parses raw WebSocket data into the common client event envelope.
 */
function parseClientEvent(rawMessage: RawData): ParsedClientEvent {
  let decodedMessage: string;
  let parsedMessage: unknown;

  // Decode before JSON parsing so Buffer and ArrayBuffer payloads behave the same.
  try {
    decodedMessage = decodeRawMessage(rawMessage);
  } catch {
    return {
      ok: false,
      code: 'invalid_event',
      message: 'WebSocket message must be text or UTF-8 data.'
    };
  }

  // Treat malformed JSON as a protocol error rather than letting it escape the gateway.
  try {
    parsedMessage = JSON.parse(decodedMessage) as unknown;
  } catch {
    return {
      ok: false,
      code: 'invalid_json',
      message: 'WebSocket message must be valid JSON.'
    };
  }

  if (!isClientEventEnvelope(parsedMessage)) {
    return {
      ok: false,
      code: 'invalid_event',
      message: 'WebSocket message must match the client event envelope.'
    };
  }

  return {
    ok: true,
    event: parsedMessage
  };
}

/**
 * Validates one event payload and maps invalid data to a safe protocol error.
 */
function parseEventPayload<TSchema extends z.ZodType>(
  schema: TSchema,
  payload: unknown
): z.infer<TSchema> {
  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new DomainError({
      code: 'validation_error',
      statusCode: 400,
      publicMessage: 'Invalid event payload.'
    });
  }

  return result.data;
}

/**
 * Decodes the raw WebSocket message formats supported by `ws` into text.
 */
function decodeRawMessage(rawMessage: RawData): string {
  if (typeof rawMessage === 'string') {
    return rawMessage;
  }

  if (Buffer.isBuffer(rawMessage)) {
    return rawMessage.toString('utf8');
  }

  if (rawMessage instanceof ArrayBuffer) {
    return Buffer.from(rawMessage).toString('utf8');
  }

  if (ArrayBuffer.isView(rawMessage)) {
    return Buffer.from(rawMessage.buffer, rawMessage.byteOffset, rawMessage.byteLength).toString('utf8');
  }

  if (Array.isArray(rawMessage)) {
    const chunks = rawMessage.filter(Buffer.isBuffer);
    if (chunks.length === rawMessage.length) {
      return Buffer.concat(chunks).toString('utf8');
    }
  }

  throw new Error('Unsupported WebSocket message type.');
}

/**
 * Checks that unknown JSON has the required client envelope shape.
 */
function isClientEventEnvelope(value: unknown): value is ClientEventEnvelope {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.type === 'string' &&
    value.type.length > 0 &&
    Object.hasOwn(value, 'payload')
  );
}

/**
 * Narrows unknown data to a plain object record for protocol checks.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Creates a pong event that mirrors the client event id for request/response matching.
 */
function createPongEvent(event: ClientEventEnvelope): PongServerEvent {
  const timestamp = new Date().toISOString();

  return {
    id: event.id,
    type: 'pong',
    payload: {
      ok: true,
      receivedAt: timestamp
    },
    ts: timestamp
  };
}

/**
 * Creates an acknowledgement event for the socket that submitted the message.
 */
function createMessageAckEvent(
  id: string,
  clientNonce: string,
  message: MessageAckPayload['message']
): ServerEventEnvelope<MessageAckPayload> {
  return {
    id,
    type: 'message.ack',
    payload: {
      clientNonce,
      message
    },
    ts: new Date().toISOString()
  };
}

/**
 * Creates a broadcast event for chat participants that did not submit this socket event.
 */
function createMessageCreatedEvent(
  message: MessageCreatedPayload['message']
): ServerEventEnvelope<MessageCreatedPayload> {
  return {
    type: 'message.created',
    payload: {
      message
    },
    ts: new Date().toISOString()
  };
}

/**
 * Creates a structured protocol error event without leaking server internals.
 */
function createErrorEvent(
  id: string | undefined,
  code: string,
  message: string
): ServerEventEnvelope<WebSocketErrorPayload> {
  const event: ServerEventEnvelope<WebSocketErrorPayload> = {
    type: 'error',
    payload: {
      code,
      message
    },
    ts: new Date().toISOString()
  };

  if (id !== undefined) {
    event.id = id;
  }

  return event;
}

/**
 * Converts known domain errors into stable WebSocket error codes.
 */
function getErrorCode(error: unknown): string {
  return error instanceof DomainError ? error.code : 'internal_error';
}

/**
 * Converts known domain errors into safe WebSocket error messages.
 */
function getErrorMessage(error: unknown): string {
  return error instanceof DomainError ? error.publicMessage : 'Internal server error.';
}

/**
 * Sends server events as JSON envelopes over an open WebSocket connection.
 */
function sendServerEvent<TPayload>(
  socket: WebSocket,
  event: ServerEventEnvelope<TPayload>
): void {
  if (socket.readyState !== 1) {
    return;
  }

  socket.send(JSON.stringify(event));
}
