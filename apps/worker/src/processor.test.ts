import { gzipSync } from 'node:zlib';

import type { FlightRecord, ProcessedFlight } from '@skyline/db';
import type { FlightStatusResponse } from '@skyline/core';
import { readTrack } from '@skyline/track-format';
import { afterEach, describe, expect, it } from 'vitest';

import { createPipelinePool, type PipelinePool } from './pool.js';
import { createFlightProcessor, type FlightRepository, type ObjectStorage } from './processor.js';
import { NOW, readFixture } from './testing/tracks.js';

/** Настоящий UUID v4: z.uuid() в Zod 4 проверяет и версию, и вариант. */
const FLIGHT_ID = '11111111-2222-4333-8444-555555555555';

function fakeStorage(objects: Map<string, Uint8Array>): ObjectStorage {
  return {
    get: async (key) => {
      const value = objects.get(key);
      if (!value) throw new Error(`no such object: ${key}`);
      return Promise.resolve(value);
    },
    put: async (key, bytes) => {
      objects.set(key, bytes);
      return Promise.resolve();
    },
    delete: async (key) => {
      objects.delete(key);
      return Promise.resolve();
    },
  };
}

function fakeRepository(record: FlightRecord): {
  repository: FlightRepository;
  statuses: string[];
  ready: ProcessedFlight[];
  failures: string[];
} {
  const statuses: string[] = [];
  const ready: ProcessedFlight[] = [];
  const failures: string[] = [];
  return {
    statuses,
    ready,
    failures,
    repository: {
      find: () => Promise.resolve(record),
      markProcessing: () => {
        statuses.push('parsing');
        return Promise.resolve();
      },
      markReady: (_id, result) => {
        statuses.push('ready');
        ready.push(result);
        return Promise.resolve();
      },
      markFailed: (_id, errorCode) => {
        statuses.push('failed');
        failures.push(errorCode);
        return Promise.resolve();
      },
    },
  };
}

const record = (overrides: Partial<FlightRecord> = {}): FlightRecord => ({
  id: FLIGHT_ID,
  status: 'pending',
  sourceFormat: 'igc',
  rawObjectKey: 'raw/anonymous/flight.igc.gz',
  trackObjectKey: null,
  errorCode: null,
  ...overrides,
});

let pool: PipelinePool | undefined;
afterEach(async () => {
  await pool?.close();
  pool = undefined;
});

describe('обработка одного полёта', () => {
  it('parsing → ready: .track загружен в S3, события отправлены', async () => {
    pool = createPipelinePool({ size: 1, timeoutS: 30, memoryLimitMb: 512 });
    const objects = new Map<string, Uint8Array>([
      ['raw/anonymous/flight.igc.gz', gzipSync(readFixture('baseline.igc'))],
    ]);
    const { repository, statuses, ready } = fakeRepository(record());
    const events: FlightStatusResponse[] = [];
    const processed: Array<{ flightId: string; gnssAltitudeDatum: string }> = [];

    const processor = createFlightProcessor({
      pool,
      storage: fakeStorage(objects),
      repository,
      notify: (event) => {
        events.push(event);
        return Promise.resolve();
      },
      now: () => NOW,
      onReady: (flightId, summary) => processed.push({ flightId, gnssAltitudeDatum: summary.gnssAltitudeDatum }),
    });
    await processor.process(FLIGHT_ID);

    expect(statuses).toEqual(['parsing', 'ready']);
    // Датум — в лог воркера с flightId: так видно треки с датумом по умолчанию (спек высот).
    expect(processed).toEqual([{ flightId: FLIGHT_ID, gnssAltitudeDatum: 'assumed-geoid' }]);
    const trackKey = ready[0]?.trackObjectKey ?? '';
    expect(trackKey).toMatch(/^tracks\/.*\.track$/);
    expect(readTrack(objects.get(trackKey) ?? new Uint8Array()).pointCount).toBe(960);
    expect(ready[0]).toMatchObject({ analysisLevel: 'full', altitudeSource: 'baro', durationS: 959 });
    // Сводка и линия для логбука (задача 2.11) — из того же прохода конвейера.
    expect(ready[0]?.distanceTrackM).toBeGreaterThan(0);
    expect(ready[0]?.maxAltM).toBeGreaterThan(0);
    const line = ready[0]?.simplified;
    expect(line?.lat.length).toBeGreaterThan(2);
    expect(line?.lat.length).toBeLessThan(960);
    expect(line?.timeMs[0]).toBe(ready[0]?.startedAt.getTime());
    // Таймзона — по точке взлёта (задача 2.14): baseline генератора — под Алматы.
    expect(ready[0]?.timezone).toBe('Asia/Almaty');
    // Анализ из потока доходит до репозитория: две спирали генератора — два термика.
    expect(ready[0]?.analysis?.thermals).toHaveLength(2);
    expect(ready[0]?.analysis?.glides.length).toBeGreaterThan(0);

    // Между переходами идут события прогресса — тоже со статусом parsing.
    expect(events[0]).toMatchObject({ flightId: FLIGHT_ID, status: 'parsing', progress: 0, trackReady: false });
    expect(events.slice(0, -1).every((event) => event.status === 'parsing')).toBe(true);
    expect(events.map((event) => event.progress ?? 0)).toEqual([...events.map((event) => event.progress ?? 0)].sort((a, b) => a - b));
    expect(events.at(-1)).toMatchObject({ flightId: FLIGHT_ID, status: 'ready', trackReady: true, progress: 1 });
  });

  it('битый файл — failed с кодом парсера, .track не появляется', async () => {
    pool = createPipelinePool({ size: 1, timeoutS: 30, memoryLimitMb: 512 });
    const objects = new Map<string, Uint8Array>([
      ['raw/anonymous/flight.igc.gz', gzipSync(Buffer.from('мусор вместо трека'))],
    ]);
    const { repository, statuses, failures } = fakeRepository(record());
    const events: FlightStatusResponse[] = [];

    const processor = createFlightProcessor({
      pool,
      storage: fakeStorage(objects),
      repository,
      notify: (event) => {
        events.push(event);
        return Promise.resolve();
      },
      now: () => NOW,
    });
    await processor.process(FLIGHT_ID);

    expect(statuses).toEqual(['parsing', 'failed']);
    expect(failures).toEqual(['no_fixes']);
    expect([...objects.keys()]).toEqual(['raw/anonymous/flight.igc.gz']);
    expect(events.at(-1)).toMatchObject({ status: 'failed', errorCode: 'no_fixes', trackReady: false });
  });

  it('исходного файла нет в S3 — failed internal_error, а не падение', async () => {
    pool = createPipelinePool({ size: 1, timeoutS: 30, memoryLimitMb: 512 });
    const { repository, failures } = fakeRepository(record());

    const processor = createFlightProcessor({
      pool,
      storage: fakeStorage(new Map()),
      repository,
      notify: () => Promise.resolve(),
      now: () => NOW,
    });
    await processor.process(FLIGHT_ID);

    expect(failures).toEqual(['internal_error']);
  });

  it('полёта нет в базе — тихо выходим, статусы не трогаем', async () => {
    pool = createPipelinePool({ size: 1, timeoutS: 30, memoryLimitMb: 512 });
    const statuses: string[] = [];
    const processor = createFlightProcessor({
      pool,
      storage: fakeStorage(new Map()),
      repository: {
        find: () => Promise.resolve(null),
        markProcessing: () => {
          statuses.push('parsing');
          return Promise.resolve();
        },
        markReady: () => Promise.resolve(),
        markFailed: () => Promise.resolve(),
      },
      notify: () => Promise.resolve(),
      now: () => NOW,
    });

    await processor.process(FLIGHT_ID);
    expect(statuses).toEqual([]);
  });

  it('уже готовый полёт не обрабатывается повторно', async () => {
    pool = createPipelinePool({ size: 1, timeoutS: 30, memoryLimitMb: 512 });
    const { repository, statuses } = fakeRepository(record({ status: 'ready', trackObjectKey: 'tracks/x.track' }));
    const processor = createFlightProcessor({
      pool,
      storage: fakeStorage(new Map()),
      repository,
      notify: () => Promise.resolve(),
      now: () => NOW,
    });

    await processor.process(FLIGHT_ID);
    expect(statuses).toEqual([]);
  });
});
