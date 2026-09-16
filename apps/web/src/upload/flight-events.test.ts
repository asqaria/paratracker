import type { FlightStatusResponse } from '@skyline/core';
import { describe, expect, it, vi } from 'vitest';

import {
  flightEventsUrl,
  flightStatusUrl,
  isTerminalStatus,
  parseFlightEvent,
  subscribeFlightStatus,
  type FlightEventStream,
} from './flight-events';

const FLIGHT_ID = '11111111-2222-4333-8444-555555555555';

const status = (over: Partial<FlightStatusResponse> = {}): FlightStatusResponse => ({
  flightId: FLIGHT_ID,
  status: 'parsing',
  trackReady: false,
  ...over,
});

/** Поддельный поток: тест сам решает, что и когда «приходит с сервера». */
class FakeStream implements FlightEventStream {
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  closed = false;

  emit(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }

  fail(): void {
    this.onerror?.(new Error('stream broken'));
  }

  close(): void {
    this.closed = true;
  }
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5));

describe('parseFlightEvent', () => {
  it('разбирает событие конвейера', () => {
    expect(parseFlightEvent(JSON.stringify(status({ progress: 0.5 })))).toEqual(status({ progress: 0.5 }));
  });

  it('мусор не роняет разбор', () => {
    // Сервер не должен присылать такое, но UI обязан выжить.
    expect(parseFlightEvent('не json')).toBeNull();
    expect(parseFlightEvent('{}')).toBeNull();
    expect(parseFlightEvent(JSON.stringify({ flightId: FLIGHT_ID, status: 'нет такого' }))).toBeNull();
  });
});

describe('isTerminalStatus', () => {
  it('терминальные — только ready и failed', () => {
    expect(isTerminalStatus('ready')).toBe(true);
    expect(isTerminalStatus('failed')).toBe(true);
    expect(isTerminalStatus('pending')).toBe(false);
    expect(isTerminalStatus('parsing')).toBe(false);
    expect(isTerminalStatus('analyzing')).toBe(false);
  });
});

describe('адреса', () => {
  it('содержат версию API и id полёта', () => {
    expect(flightEventsUrl(FLIGHT_ID)).toBe(`/api/v1/flights/${FLIGHT_ID}/events`);
    expect(flightStatusUrl(FLIGHT_ID)).toBe(`/api/v1/flights/${FLIGHT_ID}/status`);
  });
});

describe('subscribeFlightStatus', () => {
  it('отдаёт статусы из потока и закрывает его на терминальном', () => {
    const stream = new FakeStream();
    const onStatus = vi.fn();
    subscribeFlightStatus(FLIGHT_ID, { onStatus, onError: vi.fn() }, { openStream: () => stream });

    stream.emit(status({ status: 'parsing', progress: 0.2 }));
    stream.emit(status({ status: 'analyzing', progress: 0.7 }));
    stream.emit(status({ status: 'ready', trackReady: true, progress: 1 }));
    // После терминального подписка закрыта: лишнее событие игнорируется.
    stream.emit(status({ status: 'parsing' }));

    expect(onStatus).toHaveBeenCalledTimes(3);
    expect(onStatus.mock.calls.at(-1)?.[0]).toEqual(status({ status: 'ready', trackReady: true, progress: 1 }));
    expect(stream.closed).toBe(true);
  });

  it('после обрыва потока переходит на опрос /status', async () => {
    const stream = new FakeStream();
    const onStatus = vi.fn();
    const fetchImpl = vi.fn((input: unknown) => {
      expect(input).toBe(flightStatusUrl(FLIGHT_ID));
      return Promise.resolve(
        new Response(JSON.stringify(status({ status: 'ready', trackReady: true })), { status: 200 }),
      );
    });

    subscribeFlightStatus(
      FLIGHT_ID,
      { onStatus, onError: vi.fn() },
      { openStream: () => stream, fetchImpl: fetchImpl as unknown as typeof fetch, pollIntervalMs: 1 },
    );
    stream.fail();
    await settle();

    expect(fetchImpl).toHaveBeenCalled();
    expect(onStatus).toHaveBeenCalledWith(status({ status: 'ready', trackReady: true }));
    expect(stream.closed).toBe(true);
  });

  it('ошибку опроса сообщает наружу и пробует снова', async () => {
    const stream = new FakeStream();
    const onError = vi.fn();
    let attempt = 0;
    const fetchImpl = vi.fn(() => {
      attempt += 1;
      return attempt === 1
        ? Promise.resolve(new Response('{}', { status: 502 }))
        : Promise.resolve(new Response(JSON.stringify(status({ status: 'ready', trackReady: true })), { status: 200 }));
    });

    const onStatus = vi.fn();
    subscribeFlightStatus(
      FLIGHT_ID,
      { onStatus, onError },
      { openStream: () => stream, fetchImpl: fetchImpl as unknown as typeof fetch, pollIntervalMs: 1 },
    );
    stream.fail();
    await settle();

    expect(onError).toHaveBeenCalledWith(expect.stringContaining('502'));
    expect(onStatus).toHaveBeenCalledWith(status({ status: 'ready', trackReady: true }));
  });

  it('отписка прекращает всё', () => {
    const stream = new FakeStream();
    const onStatus = vi.fn();
    const stop = subscribeFlightStatus(FLIGHT_ID, { onStatus, onError: vi.fn() }, { openStream: () => stream });

    stop();
    stream.emit(status({ status: 'analyzing' }));

    expect(onStatus).not.toHaveBeenCalled();
    expect(stream.closed).toBe(true);
  });
});
