import { gunzipSync } from 'node:zlib';

import { FlightStatusResponse, PROBLEM_CONTENT_TYPE, UploadResponse, type SourceFormat } from '@skyline/core';
import type { FlightRecord } from '@skyline/db';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from './app.js';
import type { FlightEventListener, FlightRoutesDeps } from './flights.js';
import { multipartBody } from './testing/multipart.js';

/** Настоящий UUID v4: z.uuid() в Zod 4 проверяет и версию, и вариант. */
const FLIGHT_ID = '11111111-2222-4333-8444-555555555555';
const IGC = 'AXSK\r\nHFDTE150726\r\nB0940094646616N01308990EA0175201889\r\n';

const record = (overrides: Partial<FlightRecord> = {}): FlightRecord => ({
  id: FLIGHT_ID,
  status: 'pending',
  sourceFormat: 'igc',
  rawObjectKey: `raw/anonymous/${FLIGHT_ID}.igc.gz`,
  trackObjectKey: null,
  errorCode: null,
  ...overrides,
});

interface Harness {
  app: ReturnType<typeof buildApp>;
  objects: Map<string, Uint8Array>;
  inserted: { id: string; sourceFormat: SourceFormat; rawObjectKey: string; userId: string | null }[];
  queued: string[];
  emit: (flightId: string, event: FlightStatusResponse) => void;
}

function harness(options: { flight?: FlightRecord | null; maxFileBytes?: number } = {}): Harness {
  const objects = new Map<string, Uint8Array>();
  const inserted: Harness['inserted'] = [];
  const queued: string[] = [];
  const listeners = new Map<string, Set<FlightEventListener>>();

  const flights: FlightRoutesDeps = {
    repository: {
      insert: (flight) => {
        inserted.push(flight);
        return Promise.resolve(record({ ...flight, id: FLIGHT_ID, status: 'pending' }));
      },
      find: () => Promise.resolve(options.flight === undefined ? record() : options.flight),
    },
    storage: {
      put: (key, bytes) => {
        objects.set(key, bytes);
        return Promise.resolve();
      },
      get: (key) => {
        const value = objects.get(key);
        return value ? Promise.resolve(value) : Promise.reject(new Error(`no such object: ${key}`));
      },
    },
    events: {
      subscribe: (flightId, listener) => {
        const set = listeners.get(flightId) ?? new Set();
        set.add(listener);
        listeners.set(flightId, set);
        return () => set.delete(listener);
      },
    },
    onQueued: (flightId) => {
      queued.push(flightId);
      return Promise.resolve();
    },
    newFlightId: () => FLIGHT_ID,
    ...(options.maxFileBytes === undefined ? {} : { maxFileBytes: options.maxFileBytes }),
  };

  return {
    app: buildApp({ logger: false, flights }),
    objects,
    inserted,
    queued,
    emit: (flightId, event) => {
      for (const listener of listeners.get(flightId) ?? []) listener(event);
    },
  };
}

const upload = (
  app: Harness['app'],
  filename: string,
  content: Uint8Array | string = IGC,
): Promise<{ statusCode: number; headers: Record<string, unknown>; body: string; json: () => unknown }> => {
  const { payload, headers } = multipartBody([{ field: 'file', filename, content }]);
  return app.inject({ method: 'POST', url: '/api/v1/flights/upload', payload, headers });
};

let open: Harness['app'] | undefined;
afterEach(async () => {
  await open?.close();
  open = undefined;
});

describe('POST /api/v1/flights/upload', () => {
  it('202: сырой файл в S3 в gzip, строка pending, полёт поставлен в очередь', async () => {
    const test = harness();
    const response = await upload(test.app, 'flight.igc');

    expect(response.statusCode).toBe(202);
    expect(UploadResponse.parse(response.json())).toEqual({ flightId: FLIGHT_ID, status: 'pending' });

    const key = `raw/anonymous/${FLIGHT_ID}.igc.gz`;
    expect([...test.objects.keys()]).toEqual([key]);
    expect(gunzipSync(test.objects.get(key) ?? new Uint8Array()).toString()).toBe(IGC);
    expect(test.inserted).toEqual([{ id: FLIGHT_ID, userId: null, sourceFormat: 'igc', rawObjectKey: key }]);
    expect(test.queued).toEqual([FLIGHT_ID]);
  });

  it.each([
    ['track.gpx', 'gpx'],
    ['track.kml', 'kml'],
    ['track.kmz', 'kml'],
    ['TRACK.IGC', 'igc'],
  ])('формат определяется по расширению: %s → %s', async (filename, format) => {
    const test = harness();
    await upload(test.app, filename);
    expect(test.inserted[0]?.sourceFormat).toBe(format);
  });

  it.each(['track.fit', 'track.csv', 'track.txt', 'noextension'])('неподдерживаемый формат — 415: %s', async (filename) => {
    const test = harness();
    const response = await upload(test.app, filename);

    expect(response.statusCode).toBe(415);
    expect(response.headers['content-type']).toContain(PROBLEM_CONTENT_TYPE);
    expect(test.objects.size).toBe(0);
  });

  it('файл больше лимита — 413, в S3 ничего не попадает', async () => {
    const test = harness({ maxFileBytes: 1024 });
    const response = await upload(test.app, 'big.igc', Buffer.alloc(4096, 0x41));

    expect(response.statusCode).toBe(413);
    expect(response.headers['content-type']).toContain(PROBLEM_CONTENT_TYPE);
    expect(test.objects.size).toBe(0);
  });

  it('запрос без файла — 400', async () => {
    const test = harness();
    const response = await test.app.inject({
      method: 'POST',
      url: '/api/v1/flights/upload',
      payload: 'not multipart',
      headers: { 'content-type': 'text/plain' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.headers['content-type']).toContain(PROBLEM_CONTENT_TYPE);
  });
});

describe('GET /api/v1/flights/:id/status', () => {
  it('200 со статусом из базы', async () => {
    const test = harness();
    const response = await test.app.inject({ method: 'GET', url: `/api/v1/flights/${FLIGHT_ID}/status` });

    expect(response.statusCode).toBe(200);
    expect(FlightStatusResponse.parse(response.json())).toEqual({
      flightId: FLIGHT_ID,
      status: 'pending',
      trackReady: false,
    });
  });

  it('готовый полёт — trackReady true и код ошибки для упавшего', async () => {
    const ready = harness({ flight: record({ status: 'ready', trackObjectKey: 'tracks/x.track' }) });
    const failed = harness({ flight: record({ status: 'failed', errorCode: 'no_fixes' }) });

    const readyResponse = await ready.app.inject({ method: 'GET', url: `/api/v1/flights/${FLIGHT_ID}/status` });
    const failedResponse = await failed.app.inject({ method: 'GET', url: `/api/v1/flights/${FLIGHT_ID}/status` });

    expect(readyResponse.json()).toMatchObject({ status: 'ready', trackReady: true });
    expect(failedResponse.json()).toMatchObject({ status: 'failed', errorCode: 'no_fixes', trackReady: false });
  });

  it('неизвестный полёт — 404, не-uuid — 400', async () => {
    const test = harness({ flight: null });

    const missing = await test.app.inject({ method: 'GET', url: `/api/v1/flights/${FLIGHT_ID}/status` });
    const invalid = await test.app.inject({ method: 'GET', url: '/api/v1/flights/not-a-uuid/status' });

    expect(missing.statusCode).toBe(404);
    expect(invalid.statusCode).toBe(400);
    for (const response of [missing, invalid]) {
      expect(response.headers['content-type']).toContain(PROBLEM_CONTENT_TYPE);
    }
  });
});

describe('GET /api/v1/flights/:id/track', () => {
  it('200 и байты .track, когда полёт готов', async () => {
    const test = harness({ flight: record({ status: 'ready', trackObjectKey: 'tracks/x.track' }) });
    test.objects.set('tracks/x.track', Uint8Array.of(83, 75, 84, 82, 1, 2, 3, 4));

    const response = await test.app.inject({ method: 'GET', url: `/api/v1/flights/${FLIGHT_ID}/track` });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('application/octet-stream');
    expect(new Uint8Array(response.rawPayload)).toEqual(Uint8Array.of(83, 75, 84, 82, 1, 2, 3, 4));
  });

  it('полёт ещё не обработан — 409; нет полёта — 404', async () => {
    const pending = harness();
    const missing = harness({ flight: null });

    const notReady = await pending.app.inject({ method: 'GET', url: `/api/v1/flights/${FLIGHT_ID}/track` });
    const notFound = await missing.app.inject({ method: 'GET', url: `/api/v1/flights/${FLIGHT_ID}/track` });

    expect(notReady.statusCode).toBe(409);
    expect(notFound.statusCode).toBe(404);
  });
});

describe('GET /api/v1/flights/:id/events (SSE)', () => {
  it('отдаёт текущий статус, затем события конвейера, и закрывается на терминальном', async () => {
    const test = harness();
    open = test.app;
    await test.app.listen({ host: '127.0.0.1', port: 0 });
    const address = test.app.server.address();
    const port = typeof address === 'object' && address ? address.port : 0;

    const response = await fetch(`http://127.0.0.1:${port}/api/v1/flights/${FLIGHT_ID}/events`);
    expect(response.headers.get('content-type')).toContain('text/event-stream');

    const events: FlightStatusResponse[] = [];
    const reader: ReadableStreamDefaultReader<Uint8Array> | undefined = response.body?.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    // Первое событие — снимок из базы; дальше — то, что пришло от воркера.
    const pump = (async () => {
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() ?? '';
        for (const chunk of lines) {
          const data = chunk
            .split('\n')
            .find((line) => line.startsWith('data:'))
            ?.slice('data:'.length);
          if (data) events.push(FlightStatusResponse.parse(JSON.parse(data)));
        }
        if (events.length >= 3) break;
      }
    })();

    await vi.waitUntil(() => events.length >= 1, { timeout: 2000 });
    test.emit(FLIGHT_ID, { flightId: FLIGHT_ID, status: 'parsing', progress: 0.5, trackReady: false });
    test.emit(FLIGHT_ID, { flightId: FLIGHT_ID, status: 'ready', progress: 1, trackReady: true });
    await pump;

    expect(events.map((event) => event.status)).toEqual(['pending', 'parsing', 'ready']);
    expect(events.at(-1)).toMatchObject({ trackReady: true });
  });
});
