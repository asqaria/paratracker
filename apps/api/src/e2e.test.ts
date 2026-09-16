import {
  createChannelListener,
  createDatabase,
  deleteFlights,
  findFlight,
  FLIGHT_QUEUED_CHANNEL,
  FLIGHT_STATUS_CHANNEL,
  insertFlight,
  listUnfinishedFlights,
  markFlightFailed,
  markFlightProcessing,
  markFlightReady,
  notifyFlightQueued,
  notifyFlightStatus,
  type ChannelListener,
  type Database,
  type DatabaseConnection,
} from '@skyline/db';
import { FlightStatusResponse, UploadResponse } from '@skyline/core';
import { readTrack } from '@skyline/track-format';
import {
  createFlightProcessor,
  createFlightQueue,
  createObjectStorage as createWorkerStorage,
  createPipelinePool,
  createStorageClient as createWorkerS3,
  PIPELINE_MEMORY_LIMIT_MB,
  PIPELINE_TIMEOUT_S,
  type FlightQueue,
  type ObjectStorage,
  type PipelinePool,
} from '@skyline/worker';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { HEALTH_CHECK_TIMEOUT_S } from './constants.js';
import { createFlightEventHub } from './events.js';
import { createHealthProbe } from './probe.js';
import { createObjectStorage, createStorageClient } from './storage.js';
import { multipartBody } from './testing/multipart.js';
import { readFixture, repeatedIgc, sleep } from './testing/tracks.js';

/**
 * Приёмка сессии 1.5 на живых Postgres и MinIO: загрузка → очередь → пул
 * worker_threads → .track. API и воркер связаны так же, как в проде:
 * задания и статусы ходят через LISTEN/NOTIFY.
 */

const env = process.env;
/** ТЗ §5.2: health обязан отвечать быстрее 200 мс во время обработки. */
const MAX_HEALTH_LATENCY_MS = 200;
const STATUS_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 25;

describe.runIf(Boolean(env.DATABASE_URL && env.S3_ENDPOINT))('сквозной путь загрузки', () => {
  let database: DatabaseConnection;
  let db: Database;
  let app: ReturnType<typeof buildApp>;
  let pool: PipelinePool;
  let queue: FlightQueue;
  let workerStorage: ObjectStorage;
  let listeners: ChannelListener[] = [];
  const created: string[] = [];

  beforeAll(async () => {
    const config = loadConfig(env);
    database = createDatabase(config.DATABASE_URL);
    db = database.db;

    const apiS3 = createStorageClient(config);
    const storage = createObjectStorage(apiS3, config.S3_BUCKET);
    workerStorage = createWorkerStorage(createWorkerS3(config), config.S3_BUCKET);

    pool = createPipelinePool({ size: 2, timeoutS: PIPELINE_TIMEOUT_S, memoryLimitMb: PIPELINE_MEMORY_LIMIT_MB });
    const processor = createFlightProcessor({
      pool,
      storage: workerStorage,
      repository: {
        find: (id) => findFlight(db, id),
        markProcessing: (id) => markFlightProcessing(db, id),
        markReady: (id, result) => markFlightReady(db, id, result),
        markFailed: (id, errorCode) => markFlightFailed(db, id, errorCode),
      },
      notify: (event) => notifyFlightStatus(db, event),
    });
    queue = createFlightQueue({ concurrency: 2, process: (flightId) => processor.process(flightId) });

    const events = createFlightEventHub();
    app = buildApp({
      logger: false,
      health: {
        probe: createHealthProbe({ db, storage: apiS3, bucket: config.S3_BUCKET }),
        timeoutS: HEALTH_CHECK_TIMEOUT_S,
      },
      flights: {
        repository: {
          insert: (flight) => insertFlight(db, flight),
          find: (id) => findFlight(db, id),
        },
        storage,
        events,
        onQueued: (flightId) => notifyFlightQueued(db, flightId),
      },
    });

    // Продовая связка: воркер узнаёт о работе, а API — о статусах через NOTIFY.
    listeners = [
      createChannelListener({
        connectionString: config.DATABASE_URL,
        channels: [FLIGHT_QUEUED_CHANNEL],
        onNotification: (_channel, payload) => queue.enqueue(payload),
      }),
      createChannelListener({
        connectionString: config.DATABASE_URL,
        channels: [FLIGHT_STATUS_CHANNEL],
        onNotification: (_channel, payload) => events.handleNotification(payload),
      }),
    ];
    for (const listener of listeners) await listener.start();
  }, 60_000);

  afterAll(async () => {
    for (const listener of listeners) await listener.stop();
    await app?.close();
    await queue?.close();
    await pool?.close();
    await deleteFlights(db, created);
    await database?.close();
  }, 60_000);

  const upload = async (filename: string, content: Uint8Array): Promise<string> => {
    const { payload, headers } = multipartBody([{ field: 'file', filename, content }]);
    const response = await app.inject({ method: 'POST', url: '/api/v1/flights/upload', payload, headers });

    expect(response.statusCode, response.body).toBe(202);
    const { flightId } = UploadResponse.parse(response.json());
    created.push(flightId);
    return flightId;
  };

  const readStatus = async (flightId: string): Promise<FlightStatusResponse> => {
    const response = await app.inject({ method: 'GET', url: `/api/v1/flights/${flightId}/status` });
    expect(response.statusCode, response.body).toBe(200);
    return FlightStatusResponse.parse(response.json());
  };

  const waitForStatus = async (flightId: string, wanted: 'ready' | 'failed'): Promise<FlightStatusResponse> => {
    const deadline = Date.now() + STATUS_TIMEOUT_MS;
    let status = await readStatus(flightId);
    while (status.status !== wanted && Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
      status = await readStatus(flightId);
    }
    expect(status.status, `flight ${flightId}: ${JSON.stringify(status)}`).toBe(wanted);
    return status;
  };

  it('baseline.igc: загрузка → ready → .track скачивается и читается readTrack', async () => {
    const flightId = await upload('baseline.igc', readFixture('baseline.igc'));

    const status = await waitForStatus(flightId, 'ready');
    expect(status.trackReady).toBe(true);

    const download = await app.inject({ method: 'GET', url: `/api/v1/flights/${flightId}/track` });
    expect(download.statusCode).toBe(200);
    expect(download.headers['content-type']).toBe('application/octet-stream');

    const track = readTrack(new Uint8Array(download.rawPayload));
    expect(track.pointCount).toBe(960);
    expect(track.t[0]).toBe(Date.UTC(2026, 6, 15, 9));

    const row = await findFlight(db, flightId);
    expect(row).toMatchObject({ status: 'ready' });
    expect(row?.trackObjectKey).toBe(`tracks/${flightId}.track`);
  }, 60_000);

  it('битый файл: статус failed с кодом ошибки, а не 500', async () => {
    const flightId = await upload('broken.igc', Buffer.from('это не трек, а мусор\r\n'));

    const status = await waitForStatus(flightId, 'failed');
    expect(status).toMatchObject({ errorCode: 'no_fixes', trackReady: false });

    const download = await app.inject({ method: 'GET', url: `/api/v1/flights/${flightId}/track` });
    expect(download.statusCode).toBe(409);
  }, 60_000);

  it('во время обработки 4-часовых треков health отвечает быстрее 200 мс', async () => {
    const bytes = repeatedIgc(14_400);
    const flightIds = await Promise.all([
      upload('four-hours-1.igc', bytes),
      upload('four-hours-2.igc', bytes),
      upload('four-hours-3.igc', bytes),
    ]);

    const latencies: number[] = [];
    const deadline = Date.now() + STATUS_TIMEOUT_MS;
    let done = false;
    while (!done && Date.now() < deadline) {
      const start = performance.now();
      const health = await app.inject({ method: 'GET', url: '/api/v1/health' });
      latencies.push(performance.now() - start);
      expect(health.statusCode, health.body).toBe(200);

      const statuses = await Promise.all(flightIds.map((id) => readStatus(id)));
      done = statuses.every((status) => status.status === 'ready');
    }

    expect(done, 'треки не обработались за отведённое время').toBe(true);
    expect(latencies.length).toBeGreaterThan(5);
    expect(Math.max(...latencies)).toBeLessThan(MAX_HEALTH_LATENCY_MS);

    for (const flightId of flightIds) {
      const download = await app.inject({ method: 'GET', url: `/api/v1/flights/${flightId}/track` });
      expect(readTrack(new Uint8Array(download.rawPayload)).pointCount).toBe(14_400);
    }
  }, 120_000);

  it('перезапуск воркера в середине обработки не теряет полёт', async () => {
    // Полёт загружен и взят в работу, после чего воркер «упал»: строка осталась в parsing.
    const flightId = await upload('restart.igc', readFixture('baseline.igc'));
    await markFlightProcessing(db, flightId);
    expect((await readStatus(flightId)).status).toBe('parsing');

    const unfinished = await listUnfinishedFlights(db);
    expect(unfinished.map((flight) => flight.id)).toContain(flightId);

    // Новый воркер: восстановительный проход при старте переставляет всё незавершённое.
    const restarted = createFlightQueue({
      concurrency: 1,
      process: (id) =>
        createFlightProcessor({
          pool,
          storage: workerStorage,
          repository: {
            find: (flight) => findFlight(db, flight),
            markProcessing: (flight) => markFlightProcessing(db, flight),
            markReady: (flight, result) => markFlightReady(db, flight, result),
            markFailed: (flight, errorCode) => markFlightFailed(db, flight, errorCode),
          },
          notify: (event) => notifyFlightStatus(db, event),
        }).process(id),
    });
    for (const flight of unfinished) restarted.enqueue(flight.id);
    await restarted.close();

    const status = await waitForStatus(flightId, 'ready');
    expect(status.trackReady).toBe(true);
  }, 120_000);
});
