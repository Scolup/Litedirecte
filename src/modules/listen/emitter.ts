// © 2026 typeof (Scolup) | Licensed under AGPL 3.0
import type { EdError } from '../../core/errors';

/**
 * Payload per event. The `new*` events carry a raw object decoded from
 * EcoleDirecte's response (untyped by nature); `pollingError` is always an
 * `EdError`, so consumers get `code` / `statusCode` without a cast.
 */
export interface LitedirecteEvents {
  newGrade: unknown;
  newMessage: unknown;
  newTimelineEntry: unknown;
  pollingError: EdError;
}

export type LitedirecteEvent = keyof LitedirecteEvents;

export type EventHandler<T = any> = (data: T) => void;

export class EventEmitter {
  private events: Map<string, Set<EventHandler>> = new Map();

  on = <T extends LitedirecteEvent>(event: T, handler: EventHandler<LitedirecteEvents[T]>) => {
    let handlers = this.events.get(event);
    if (!handlers) {
      handlers = new Set();
      this.events.set(event, handlers);
    }
    handlers.add(handler as EventHandler);
    return () => this.off(event, handler as EventHandler);
  };

  off = <T extends LitedirecteEvent>(event: T, handler: EventHandler<LitedirecteEvents[T]>) => {
    this.events.get(event)?.delete(handler as EventHandler);
  };

  emit<T extends LitedirecteEvent>(
    event: T,
    data: LitedirecteEvents[T],
    onError?: (error: unknown) => void | Promise<void>,
  ): void {
    const handlers = this.events.get(event);
    if (handlers) {
      for (const handler of [...handlers]) {
        try {
          handler(data);
        } catch (error) {
          try {
            void onError?.(error);
          } catch {}
        }
      }
    }
  }

  clear(): void {
    this.events.clear();
  }

  listenerCount(event?: string): number {
    if (event !== undefined) return this.events.get(event)?.size ?? 0;
    let total = 0;
    for (const handlers of this.events.values()) total += handlers.size;
    return total;
  }
}
