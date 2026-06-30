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
  reconnectJitterRatio?: number;
  maxReconnectAttempts?: number;
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
  maxQueuedEvents?: number;
};

const DEFAULT_RECONNECT_INITIAL_DELAY_MS = 500;
const DEFAULT_RECONNECT_MAX_DELAY_MS = 5000;
const DEFAULT_RECONNECT_JITTER_RATIO = 0.25;
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 120;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 25000;
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 10000;
const DEFAULT_MAX_QUEUED_EVENTS = 50;
const HEARTBEAT_CLOSE_CODE = 4000;

/**
 * Manages the browser WebSocket connection, reconnect, and idempotent message retries.
 */
export class WebSocketClient {
  private readonly url: string;

  private readonly reconnectInitialDelayMs: number;

  private readonly reconnectMaxDelayMs: number;

  private readonly reconnectJitterRatio: number;

  private readonly maxReconnectAttempts: number;

  private readonly heartbeatIntervalMs: number;

  private readonly heartbeatTimeoutMs: number;

  private readonly maxQueuedEvents: number;

  private socket: WebSocket | null = null;

  private state: WebSocketConnectionState = 'idle';

  private shouldReconnect = false;

  private reconnectAttempt = 0;

  private reconnectTimer: ReturnType<typeof window.setTimeout> | null = null;

  private heartbeatTimer: ReturnType<typeof window.setTimeout> | null = null;

  private heartbeatTimeoutTimer: ReturnType<typeof window.setTimeout> | null = null;

  private heartbeatPingId: string | null = null;

  private isBrowserOnline = navigator.onLine;

  private readonly queuedEvents: ClientEventEnvelope[] = [];

  private readonly inFlightEvents = new Map<string, ClientEventEnvelope>();

  private readonly listeners = new Set<ServerEventListener>();

  private readonly stateListeners = new Set<ConnectionStateListener>();

  public constructor(options: WebSocketClientOptions = {}) {
    this.url = options.url ?? createDefaultWebSocketUrl();
    this.reconnectInitialDelayMs = options.reconnectInitialDelayMs ?? DEFAULT_RECONNECT_INITIAL_DELAY_MS;
    this.reconnectMaxDelayMs = options.reconnectMaxDelayMs ?? DEFAULT_RECONNECT_MAX_DELAY_MS;
    this.reconnectJitterRatio = options.reconnectJitterRatio ?? DEFAULT_RECONNECT_JITTER_RATIO;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? DEFAULT_MAX_RECONNECT_ATTEMPTS;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS;
    this.maxQueuedEvents = options.maxQueuedEvents ?? DEFAULT_MAX_QUEUED_EVENTS;

    window.addEventListener('online', this.handleBrowserOnline);
    window.addEventListener('offline', this.handleBrowserOffline);
  }

  /**
   * Opens the WebSocket connection and keeps trying after accidental disconnects.
   */
  public connect(): void {
    this.shouldReconnect = true;

    if (!this.isBrowserOnline) {
      this.setState('reconnecting');
      return;
    }

    if (this.socket && this.socket.readyState !== WebSocket.CLOSED) {
      return;
    }

    if (this.state === 'closed' || this.state === 'idle') {
      this.reconnectAttempt = 0;
    }

    this.openSocket(this.state === 'reconnecting' ? 'reconnecting' : 'connecting');
  }

  /**
   * Closes the current WebSocket connection and drops pending local realtime work.
   */
  public disconnect(): void {
    this.shouldReconnect = false;
    this.clearReconnectTimer();
    this.clearHeartbeat();
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
   * Fully tears down the client when the owning shell is removed.
   */
  public dispose(): void {
    this.disconnect();
    window.removeEventListener('online', this.handleBrowserOnline);
    window.removeEventListener('offline', this.handleBrowserOffline);
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
    if (!this.isBrowserOnline) {
      this.setState('reconnecting');
      return;
    }

    this.clearReconnectTimer();
    this.clearHeartbeat();
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
      this.startHeartbeat();
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
      this.clearHeartbeat();
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
    this.clearHeartbeat();

    if (!this.shouldReconnect) {
      this.setState('closed');
      return;
    }

    if (!this.isBrowserOnline) {
      this.setState('reconnecting');
      return;
    }

    const nextAttempt = this.reconnectAttempt + 1;
    if (nextAttempt > this.maxReconnectAttempts) {
      this.shouldReconnect = false;
      this.setState('closed');
      return;
    }

    this.setState('reconnecting');
    this.reconnectAttempt = nextAttempt;
    const delay = this.createReconnectDelay(nextAttempt);

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

    if (parsedEvent.type === 'pong' && typeof parsedEvent.id === 'string') {
      this.handleHeartbeatPong(parsedEvent.id);
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

  /**
   * Resets reconnect attempts and resumes the socket when the browser comes online.
   */
  private readonly handleBrowserOnline = (): void => {
    this.isBrowserOnline = true;
    if (!this.shouldReconnect) {
      return;
    }

    this.reconnectAttempt = 0;
    this.connect();
  };

  /**
   * Suspends reconnect timers while the browser reports an offline network.
   */
  private readonly handleBrowserOffline = (): void => {
    this.isBrowserOnline = false;
    this.clearReconnectTimer();
    this.clearHeartbeat();

    if (!this.shouldReconnect) {
      return;
    }

    const socket = this.socket;
    if (socket && socket.readyState !== WebSocket.CLOSED) {
      socket.close(1001, 'Browser offline');
    }

    this.setState('reconnecting');
  };

  /**
   * Calculates bounded exponential backoff with small jitter to avoid reconnect bursts.
   */
  private createReconnectDelay(attempt: number): number {
    const baseDelay = Math.min(
      this.reconnectMaxDelayMs,
      this.reconnectInitialDelayMs * 2 ** Math.max(0, attempt - 1)
    );
    const jitterRange = baseDelay * this.reconnectJitterRatio;
    const jitter = (Math.random() * 2 - 1) * jitterRange;

    return Math.max(0, Math.round(Math.min(this.reconnectMaxDelayMs, baseDelay + jitter)));
  }

  /**
   * Starts the watchdog that verifies the socket still answers protocol pings.
   */
  private startHeartbeat(): void {
    this.clearHeartbeat();
    if (this.heartbeatIntervalMs <= 0 || this.heartbeatTimeoutMs <= 0) {
      return;
    }

    this.scheduleHeartbeatPing();
  }

  /**
   * Schedules the next heartbeat ping after the previous one was acknowledged.
   */
  private scheduleHeartbeatPing(): void {
    this.clearHeartbeatTimer();
    this.heartbeatTimer = window.setTimeout(() => {
      this.heartbeatTimer = null;
      this.sendHeartbeatPing();
    }, this.heartbeatIntervalMs);
  }

  /**
   * Sends one watchdog ping and closes the socket if the pong does not arrive.
   */
  private sendHeartbeatPing(): void {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      return;
    }

    const event: ClientEventEnvelope = {
      id: createUuid(),
      type: 'ping',
      payload: {}
    };

    this.heartbeatPingId = event.id;
    this.writeEvent(event);
    this.clearHeartbeatTimeout();
    this.heartbeatTimeoutTimer = window.setTimeout(() => {
      if (this.heartbeatPingId !== event.id) {
        return;
      }

      this.heartbeatPingId = null;
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.socket.close(HEARTBEAT_CLOSE_CODE, 'Heartbeat timeout');
      }
    }, this.heartbeatTimeoutMs);
  }

  /**
   * Marks the watchdog ping as healthy and arms the next check.
   */
  private handleHeartbeatPong(eventId: string): void {
    if (eventId !== this.heartbeatPingId) {
      return;
    }

    this.heartbeatPingId = null;
    this.clearHeartbeatTimeout();
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.scheduleHeartbeatPing();
    }
  }

  /**
   * Clears all heartbeat timers and pending watchdog state.
   */
  private clearHeartbeat(): void {
    this.clearHeartbeatTimer();
    this.clearHeartbeatTimeout();
    this.heartbeatPingId = null;
  }

  /**
   * Clears the timer that sends the next heartbeat ping.
   */
  private clearHeartbeatTimer(): void {
    if (this.heartbeatTimer === null) {
      return;
    }

    window.clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  /**
   * Clears the timeout waiting for the current heartbeat pong.
   */
  private clearHeartbeatTimeout(): void {
    if (this.heartbeatTimeoutTimer === null) {
      return;
    }

    window.clearTimeout(this.heartbeatTimeoutTimer);
    this.heartbeatTimeoutTimer = null;
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
