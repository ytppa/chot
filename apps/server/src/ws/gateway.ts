import type { FastifyInstance } from 'fastify';
import type { RawData, WebSocket } from 'ws';

import type { ClientEventEnvelope, ServerEventEnvelope } from '@nothing-chat/shared';

type WebSocketErrorCode = 'invalid_json' | 'invalid_event' | 'unknown_event';

type WebSocketErrorPayload = {
  code: WebSocketErrorCode;
  message: string;
};

type PongPayload = {
  ok: true;
  receivedAt: string;
};

type ParsedClientEvent =
  | {
      ok: true;
      event: ClientEventEnvelope;
    }
  | {
      ok: false;
      code: WebSocketErrorCode;
      message: string;
    };

/**
 * Registers the initial realtime gateway used by the chat client.
 */
export async function registerWebSocketGateway(server: FastifyInstance): Promise<void> {
  server.get('/ws', { websocket: true }, (socket) => {
    socket.on('message', (rawMessage) => {
      handleWebSocketMessage(socket, rawMessage);
    });
  });
}

/**
 * Handles one client WebSocket envelope and sends the matching server event.
 */
export function handleWebSocketMessage(socket: WebSocket, rawMessage: RawData): void {
  const parsedEvent = parseClientEvent(rawMessage);
  if (!parsedEvent.ok) {
    sendServerEvent(socket, createErrorEvent(undefined, parsedEvent.code, parsedEvent.message));
    return;
  }

  // Keep the first protocol surface tiny: ping proves connectivity and envelope parsing.
  if (parsedEvent.event.type === 'ping') {
    sendServerEvent(socket, createPongEvent(parsedEvent.event));
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
function createPongEvent(event: ClientEventEnvelope): ServerEventEnvelope<PongPayload> {
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
 * Creates a structured protocol error event without leaking server internals.
 */
function createErrorEvent(
  id: string | undefined,
  code: WebSocketErrorCode,
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
 * Sends server events as JSON envelopes over the WebSocket connection.
 */
function sendServerEvent<TPayload>(
  socket: WebSocket,
  event: ServerEventEnvelope<TPayload>
): void {
  socket.send(JSON.stringify(event));
}
