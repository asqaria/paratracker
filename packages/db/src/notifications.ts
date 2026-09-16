import type { FlightStatusResponse } from '@skyline/core';
import { sql } from 'drizzle-orm';
import pg from 'pg';

import type { Database } from './client.js';

/**
 * Уведомления через LISTEN/NOTIFY Postgres. API и воркер — разные процессы,
 * поэтому смена статуса доходит до SSE-подписчиков без опроса базы,
 * а новая загрузка — до очереди воркера.
 */

export const FLIGHT_STATUS_CHANNEL = 'flight_status';
export const FLIGHT_QUEUED_CHANNEL = 'flight_queued';

/** Пауза перед переподключением слушателя: соединение рвётся при перезапуске базы. */
const RECONNECT_DELAY_MS = 1000;

export async function notifyFlightStatus(db: Database, event: FlightStatusResponse): Promise<void> {
  await db.execute(sql`SELECT pg_notify(${FLIGHT_STATUS_CHANNEL}, ${JSON.stringify(event)})`);
}

export async function notifyFlightQueued(db: Database, flightId: string): Promise<void> {
  await db.execute(sql`SELECT pg_notify(${FLIGHT_QUEUED_CHANNEL}, ${flightId})`);
}

export interface ChannelListenerOptions {
  connectionString: string;
  channels: readonly string[];
  onNotification: (channel: string, payload: string) => void;
  onError?: (error: unknown) => void;
  reconnectDelayMs?: number;
}

export interface ChannelListener {
  start(): Promise<void>;
  stop(): Promise<void>;
}

/** Отдельное соединение под LISTEN: пул для этого не подходит. */
export function createChannelListener(options: ChannelListenerOptions): ChannelListener {
  const reconnectDelayMs = options.reconnectDelayMs ?? RECONNECT_DELAY_MS;
  let client: pg.Client | null = null;
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;

  const connect = async (): Promise<void> => {
    if (stopped) return;
    const next = new pg.Client({ connectionString: options.connectionString });
    next.on('notification', (message) => {
      if (message.payload !== undefined) options.onNotification(message.channel, message.payload);
    });
    next.on('error', (error) => {
      options.onError?.(error);
      void reconnect();
    });

    await next.connect();
    for (const channel of options.channels) {
      // Имя канала — не параметр запроса; каналы задаются кодом, не пользователем.
      await next.query(`LISTEN ${pg.escapeIdentifier(channel)}`);
    }
    client = next;
  };

  const reconnect = async (): Promise<void> => {
    if (stopped || timer) return;
    const previous = client;
    client = null;
    await previous?.end().catch(() => undefined);
    timer = setTimeout(() => {
      timer = undefined;
      connect().catch((error: unknown) => options.onError?.(error));
    }, reconnectDelayMs);
  };

  return {
    start: connect,
    stop: async () => {
      stopped = true;
      clearTimeout(timer);
      timer = undefined;
      const previous = client;
      client = null;
      await previous?.end();
    },
  };
}
