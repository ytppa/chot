import type {
  ClientEventEnvelope,
  SendMessageClientEvent,
  SendMessagePayload,
  ServerEventEnvelope
} from '@nothing-chat/shared';

import { createUuid } from '../utils/uuid.js';

type ServerEventListener = (event: ServerEventEnvelope) => void;

type ConnectionStateListener = (state: WebSocketConnectionState) => void;

export type WebSocketConnectionState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

export type WebSocketSendResult = 'sent' | 'queued';

export type WebSocketClientOptions = {
  url?: string;
  reconnectInitialDelayMs?: number;
  reconnectMaxDelayMs?: number;
  maxQueuedEvents?: number;
};

const DEFAULT_RECONNECT_INITIAL_DELAY_MS = 500;
const DEFAULT_RECONNECT_MAX_DELAY_MS = 5000;
const DEFAULT_MAX_QUEUED_EVENTS = 50;

/**
 * Manages the browser WebSocket connection, reconnect, and idempotent message retries.
 */
export class WebSocketClient {
  private readonly url: string;

  private readonly reconnectInitialDelayMs: number;

  private readonly reconnectMaxDelayMs: number;

  private readonly maxQueuedEvents: number;

  private socket: WebSocket | null = null;

  private state: WebSocketConnectionState = 'idle';

  private shouldReconnect = false;

  private reconnectAttempt = 0;

  private reconnectTimer: ReturnType<typeof window.setTimeout> | null = null;

  private readonly queuedEvents: ClientEventEnvelope[] = [];

  private readonly inFlightEvents = new Map<string, ClientEventEnvelope>();

  private readonly listeners = new Set<ServerEventListener>();

  private readonly stateListeners = new Set<ConnectionStateListener>();

  public constructor(options: WebSocketClientOptions = {}) {
    this.url = options.url ?? createDefaultWebSocketUrl();
    this.reconnectInitialDelayMs = options.reconnectInitialDelayMs ?? DEFAULT_RECONNECT_INITIAL_DELAY_MS;
    this.reconnectMaxDelayMs = options.reconnectMaxDelayMs ?? DEFAULT_RECONNECT_MAX_DELAY_MS;
    this.maxQueuedEvents = options.maxQueuedEvents ?? DEFAULT_MAX_QUEUED_EVENTS;
  }

  /**
   * Opens the WebSocket connection and keeps trying after accidental disconnects.
   */
  public connect(): void {
    this.shouldReconnect = true;

    if (this.socket && this.socket.readyState !== WebSocket.CLOSED) {
      return;
    }

    this.openSocket(this.state === 'reconnecting' ? 'reconnecting' : 'connecting');
  }

  /**
   * Closes the current WebSocket connection and drops pending local realtime work.
   */
  public disconnect(): void {
    this.shouldReconnect = false;
    this.clearReconnectTimer();
    this.queuedEvents.length = 0;
    this.inFlightEvents.clear();

    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState !== WebSocket.CLOSED) {
      socket.close(1000, 'Client disconnect');
    }

    this.setState('closed');
  }

  /**
   * Sends a ping envelope through the active connection or queues it during reconnect.
   */
  public sendPing(): WebSocketSendResult {
    return this.send({
      id: createUuid(),
      type: 'ping',
      payload: {}
    });
  }

  /**
   * Sends one plain text chat message and tracks it until the server acknowledges it.
   */
  public sendMessage(payload: SendMessagePayload): WebSocketSendResult {
    const event: SendMessageClientEvent = {
      id: createUuid(),
      type: 'message.send',
      payload
    };

    return this.send(event);
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
   * Subscribes to connection state changes for compact UI status updates.
   */
  public subscribeState(listener: ConnectionStateListener): () => void {
    this.stateListeners.add(listener);
    listener(this.state);

    return () => {
      this.stateListeners.delete(listener);
    };
  }

  /**
   * Serializes and sends a client envelope, queueing it if reconnect is in progress.
   */
  private send(event: ClientEventEnvelope): WebSocketSendResult {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.writeEvent(event);
      this.trackInFlightEvent(event);
      return 'sent';
    }

    this.enqueueEvent(event);
    this.connect();

    return 'queued';
  }

  /**
   * Opens a new socket and binds handlers that ignore stale socket instances.
   */
  private openSocket(nextState: WebSocketConnectionState): void {
    this.clearReconnectTimer();
    this.setState(nextState);

    const socket = new WebSocket(this.url);
    this.socket = socket;

    socket.addEventListener('open', () => {
      if (this.socket !== socket) {
        return;
      }

      this.reconnectAttempt = 0;
      this.setState('open');
      this.flushPendingEvents();
    });

    socket.addEventListener('message', (event) => {
      if (this.socket !== socket) {
        return;
      }

      this.handleMessage(event);
    });

    socket.addEventListener('close', () => {
      if (this.socket !== socket) {
        return;
      }

      this.socket = null;
      this.handleClosedSocket();
    });

    socket.addEventListener('error', () => {
      if (this.socket === socket && socket.readyState !== WebSocket.CLOSED) {
        socket.close();
      }
    });
  }

  /**
   * Schedules the next reconnect attempt with a bounded exponential delay.
   */
  private handleClosedSocket(): void {
    if (!this.shouldReconnect) {
      this.setState('closed');
      return;
    }

    this.setState('reconnecting');
    this.reconnectAttempt += 1;

    const delay = Math.min(
      this.reconnectMaxDelayMs,
      this.reconnectInitialDelayMs * 2 ** Math.max(0, this.reconnectAttempt - 1)
    );

    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket('reconnecting');
    }, delay);
  }

  /**
   * Sends unacknowledged messages first, then events queued while offline.
   */
  private flushPendingEvents(): void {
    for (const event of this.inFlightEvents.values()) {
      this.writeEvent(event);
    }

    while (this.queuedEvents.length > 0 && this.socket?.readyState === WebSocket.OPEN) {
      const event = this.queuedEvents.shift();
      if (!event) {
        return;
      }

      this.writeEvent(event);
      this.trackInFlightEvent(event);
    }
  }

  /**
   * Adds an event to the bounded reconnect queue.
   */
  private enqueueEvent(event: ClientEventEnvelope): void {
    this.queuedEvents.push(event);

    while (this.queuedEvents.length > this.maxQueuedEvents) {
      this.queuedEvents.shift();
    }
  }

  /**
   * Stores message sends until the matching acknowledgement arrives.
   */
  private trackInFlightEvent(event: ClientEventEnvelope): void {
    if (event.type === 'message.send') {
      this.inFlightEvents.set(event.id, event);
    }
  }

  /**
   * Sends a serialized event through the current open socket.
   */
  private writeEvent(event: ClientEventEnvelope): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(event));
    }
  }

  /**
   * Parses incoming server events, clears acknowledged sends, and notifies listeners.
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

    if (parsedEvent.type === 'message.ack' && typeof parsedEvent.id === 'string') {
      this.inFlightEvents.delete(parsedEvent.id);
    }

    for (const listener of this.listeners) {
      listener(parsedEvent);
    }
  }

  /**
   * Updates connection state and notifies subscribers only when it changes.
   */
  private setState(state: WebSocketConnectionState): void {
    if (this.state === state) {
      return;
    }

    this.state = state;
    for (const listener of this.stateListeners) {
      listener(state);
    }
  }

  /**
   * Clears any pending reconnect timer before a manual state transition.
   */
  private clearReconnectTimer(): void {
    if (this.reconnectTimer === null) {
      return;
    }

    window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }
}

/**
 * Creates a WebSocket URL that follows the current page protocol.
 */
function createDefaultWebSocketUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;

  return `${protocol}//${host}/ws`;
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
