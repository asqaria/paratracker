import { FlightStatusResponse } from '@skyline/core';

/**
 * Раздача событий конвейера подписчикам SSE. Воркер — другой процесс, события
 * приходят через LISTEN/NOTIFY Postgres, поэтому база не опрашивается.
 */

export type FlightEventListener = (event: FlightStatusResponse) => void;

export interface FlightEventHub {
  subscribe(flightId: string, listener: FlightEventListener): () => void;
  /** Полезная нагрузка NOTIFY: JSON события. Кривое сообщение игнорируется. */
  handleNotification(payload: string): void;
}

export function createFlightEventHub(options: { onInvalidPayload?: (payload: string) => void } = {}): FlightEventHub {
  const listeners = new Map<string, Set<FlightEventListener>>();

  return {
    subscribe: (flightId, listener) => {
      const set = listeners.get(flightId) ?? new Set<FlightEventListener>();
      set.add(listener);
      listeners.set(flightId, set);
      return () => {
        set.delete(listener);
        if (set.size === 0) listeners.delete(flightId);
      };
    },
    handleNotification: (payload) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(payload);
      } catch {
        options.onInvalidPayload?.(payload);
        return;
      }
      const event = FlightStatusResponse.safeParse(parsed);
      if (!event.success) {
        options.onInvalidPayload?.(payload);
        return;
      }
      for (const listener of listeners.get(event.data.flightId) ?? []) listener(event.data);
    },
  };
}
