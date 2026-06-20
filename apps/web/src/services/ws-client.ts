import type { ClientEventEnvelope, ServerEventEnvelope } from '@nothing-chat/shared';

type ServerEventListener = (event: ServerEventEnvelope) => void;

export type WebSocketClientOptions = {
  url?: string;
};

/**
 * Manages the browser WebSocket connection behind a tiny event API.
 */
export class WebSocketClient {
  private readonly url: string;

  private socket: WebSocket | null = null;

  private readonly listeners = new Set<ServerEventListener>();

  public constructor(options: WebSocketClientOptions = {}) {
    this.url = options.url ?? createDefaultWebSocketUrl();
  }

  /**
   * Opens the WebSocket connection if it is not already open.
   */
  public connect(): void {
    if (this.socket && this.socket.readyState !== WebSocket.CLOSED) {
      return;
    }

    this.socket = new WebSocket(this.url);
    this.socket.addEventListener('message', (event) => {
      this.handleMessage(event);
    });
  }

  /**
   * Sends a ping envelope through the active connection.
   */
  public sendPing(): void {
    this.send({
      id: crypto.randomUUID(),
      type: 'ping',
      payload: {}
    });
  }

  /**
   * Subscribes to parsed server envelopes.
   */
  public subscribe(listener: ServerEventListener): () => void {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Serializes and sends a client envelope when the socket is open.
   */
  private send(event: ClientEventEnvelope): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    this.socket.send(JSON.stringify(event));
  }

  /**
   * Parses incoming server events and ignores malformed messages for now.
   */
  private handleMessage(event: MessageEvent<string>): void {
    let parsedEvent: unknown;

    // Ignore malformed server messages until protocol validation is added in shared.
    try {
      parsedEvent = JSON.parse(event.data) as unknown;
    } catch {
      return;
    }

    if (!isServerEventEnvelope(parsedEvent)) {
      return;
    }

    for (const listener of this.listeners) {
      listener(parsedEvent);
    }
  }
}

/**
 * Creates a WebSocket URL that follows the current page protocol.
 */
function createDefaultWebSocketUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.hostname;

  return `${protocol}//${host}:3000/ws`;
}

/**
 * Checks the minimal server event shape before notifying listeners.
 */
function isServerEventEnvelope(value: unknown): value is ServerEventEnvelope {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;

  return (
    typeof record.type === 'string' &&
    Object.hasOwn(record, 'payload') &&
    typeof record.ts === 'string'
  );
}

