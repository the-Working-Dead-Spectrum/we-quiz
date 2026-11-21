// WebSocket connection manager (ADR 0001 §1: native WebSocket, `{ event, data }` JSON envelope).
//
// This class is the ONLY owner of reconnection. Stores must not implement their own retry loop.
//
// Identity: on every (re)open the manager first sends the message returned by `identify()`
// (`host:create_game` / `host:join_game` / `player:join` / `player:reconnect`). Game actions are
// never queued: `send()` returns false while the socket is not open, so nothing stale can be
// flushed before the identity message after a reconnect.

import type { ClientEvent, ClientEventMap, ClientEventName, ServerEventMap, ServerEventName } from '$lib/types';
import { getBackendSocketUrl } from './backend-url';

export type { ServerEventMap } from '$lib/types';

type EventHandler<E extends ServerEventName> = (data: ServerEventMap[E]) => void;

const POLICY_VIOLATION_CLOSE_CODE = 1008;

export interface WebSocketManagerOptions {
  url: string;
  /** Returns the identity message to send first on every open, or null to send nothing. */
  identify: () => ClientEvent | null;
  onOpen?: () => void;
  /** `willReconnect` is true when the manager is going to retry automatically. */
  onClose?: (event: CloseEvent, willReconnect: boolean) => void;
  reconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
}

export class WebSocketManager {
  private ws: WebSocket | null = null;
  private readonly url: string;
  private readonly identify: () => ClientEvent | null;
  private readonly onOpenCallback?: () => void;
  private readonly onCloseCallback?: (event: CloseEvent, willReconnect: boolean) => void;
  private readonly shouldReconnect: boolean;
  private readonly reconnectInterval: number;
  private readonly maxReconnectAttempts: number;
  private readonly handlers = new Map<ServerEventName, Set<(data: never) => void>>();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  constructor(options: WebSocketManagerOptions) {
    this.url = options.url;
    this.identify = options.identify;
    this.onOpenCallback = options.onOpen;
    this.onCloseCallback = options.onClose;
    this.shouldReconnect = options.reconnect ?? true;
    this.reconnectInterval = options.reconnectInterval ?? 2000;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 10;
  }

  connect(): void {
    if (this.destroyed) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch (error) {
      // Invalid URL or blocked by the browser: treat like a failed attempt.
      console.error('WebSocket creation failed:', error);
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    // The attempt counter is reset on the first inbound frame, not on `open`: a server that accepts
    // then closes immediately must still exhaust the retry budget instead of looping forever.
    let receivedFrame = false;

    ws.onopen = () => {
      // Identity first, always (ADR 0001 §7 snapshots depend on it).
      const identity = this.identify();
      if (identity) {
        ws.send(JSON.stringify(identity));
      }
      this.onOpenCallback?.();
    };

    ws.onmessage = (event: MessageEvent) => {
      if (!receivedFrame) {
        receivedFrame = true;
        this.reconnectAttempts = 0;
      }
      let message: unknown;
      try {
        message = JSON.parse(typeof event.data === 'string' ? event.data : '');
      } catch {
        console.error('WebSocket: received a non-JSON frame, ignored');
        return;
      }
      if (!isEnvelope(message)) {
        console.error('WebSocket: received a frame without {event, data}, ignored');
        return;
      }
      // Payloads are trusted to follow ADR 0001 (server-side validated contract).
      this.emit(message.event as ServerEventName, message.data as ServerEventMap[ServerEventName]);
    };

    ws.onclose = (event: CloseEvent) => {
      if (this.ws === ws) this.ws = null;

      // ADR 0001 §1: 1008 = Origin rejected by the server. Retrying cannot succeed.
      if (event.code === POLICY_VIOLATION_CLOSE_CODE) {
        this.onCloseCallback?.(event, false);
        if (!this.destroyed) {
          this.emit('error', {
            code: 'MAX_RECONNECT',
            message: 'Connexion refusée par le serveur (origine non autorisée).',
          });
        }
        return;
      }

      const willReconnect =
        !this.destroyed && this.shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts;
      this.onCloseCallback?.(event, willReconnect);
      if (!this.destroyed && this.shouldReconnect) {
        this.scheduleReconnect();
      }
    };

    ws.onerror = () => {
      // The browser always fires `close` after `error`; reconnection is handled there.
    };
  }

  /**
   * Intentional, final close. Detaches every socket callback BEFORE closing so that no
   * handler (and no reconnect) can fire afterwards. The instance cannot be reused.
   */
  disconnect(): void {
    this.destroyed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onclose = null;
      ws.onerror = null;
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close(1000, 'Client disconnect');
      }
    }
    this.handlers.clear();
  }

  /** Sends a game message. Returns false (message dropped) when the socket is not open. */
  send<E extends ClientEventName>(event: E, data: ClientEventMap[E]): boolean {
    const ws = this.ws;
    if (this.destroyed || !ws || ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    ws.send(JSON.stringify({ event, data }));
    return true;
  }

  on<E extends ServerEventName>(event: E, handler: EventHandler<E>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as (data: never) => void);
    return () => this.off(event, handler);
  }

  off<E extends ServerEventName>(event: E, handler: EventHandler<E>): void {
    this.handlers.get(event)?.delete(handler as (data: never) => void);
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  get isDestroyed(): boolean {
    return this.destroyed;
  }

  private emit<E extends ServerEventName>(event: E, data: ServerEventMap[E]): void {
    this.handlers.get(event)?.forEach((handler) => {
      try {
        (handler as EventHandler<E>)(data);
      } catch (error) {
        console.error(`Error in WebSocket handler for ${event}:`, error);
      }
    });
  }

  private scheduleReconnect(): void {
    if (this.destroyed || this.reconnectTimer) return;

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.emit('error', { code: 'MAX_RECONNECT', message: 'Connexion perdue. Rechargez la page.' });
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectInterval * Math.min(this.reconnectAttempts, 5);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}

function isEnvelope(value: unknown): value is { event: string; data: unknown } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { event?: unknown }).event === 'string' &&
    typeof (value as { data?: unknown }).data === 'object' &&
    (value as { data?: unknown }).data !== null
  );
}

/** Game WebSocket URL (ADR 0001 §1). Resolution rules live in `backend-url.ts`. */
export function getGameSocketUrl(): string {
  return getBackendSocketUrl();
}

// One live game socket per tab: creating a manager destroys the previous one first.
let wsManager: WebSocketManager | null = null;

export function createWebSocketManager(options: WebSocketManagerOptions): WebSocketManager {
  destroyWebSocketManager();
  wsManager = new WebSocketManager(options);
  return wsManager;
}

/** Destroys `instance` (or the current manager when omitted). */
export function destroyWebSocketManager(instance?: WebSocketManager): void {
  const target = instance ?? wsManager;
  if (!target) return;
  target.disconnect();
  if (target === wsManager) {
    wsManager = null;
  }
}
