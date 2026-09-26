import {
  createChannelListener,
  createDatabase,
  findFlight,
  deleteFlights,
  FLIGHT_QUEUED_CHANNEL,
  listExpiredAnonymousFlights,
  listUnfinishedFlights,
  markFlightFailed,
  markFlightProcessing,
  markFlightReady,
  notifyFlightStatus,
  requeueFlightsForBackfill,
} from '@skyline/db';
import { pino } from 'pino';

import { loadConfig } from './config.js';
import {
  PIPELINE_MEMORY_LIMIT_MB,
  PIPELINE_TIMEOUT_S,
  QUEUE_SWEEP_INTERVAL_S,
  RETENTION_BATCH_SIZE,
  RETENTION_SWEEP_INTERVAL_S,
} from './constants.js';
import { createPipelinePool } from './pool.js';
import { createFlightProcessor } from './processor.js';
import { createFlightQueue } from './queue.js';
import { createRetentionSweep } from './retention.js';
import { createObjectStorage, createStorageClient } from './storage.js';

/**
 * Основной поток воркера: очередь, статусы, восстановительный проход.
 * Ни одного тяжёлого вычисления — всё в пуле worker_threads (ТЗ §5.2).
 */

const MS_PER_SECOND = 1000;

const config = loadConfig(process.env);
const logger = pino({ level: config.LOG_LEVEL });

const database = createDatabase(config.DATABASE_URL);
database.pool.on('error', (error) => logger.error({ err: error }, 'postgres pool error'));

const storage = createObjectStorage(createStorageClient(config), config.S3_BUCKET);
const pool = createPipelinePool({
  size: config.WORKER_CONCURRENCY,
  timeoutS: PIPELINE_TIMEOUT_S,
  memoryLimitMb: PIPELINE_MEMORY_LIMIT_MB,
});

const processor = createFlightProcessor({
  pool,
  storage,
  repository: {
    find: (id) => findFlight(database.db, id),
    markProcessing: (id) => markFlightProcessing(database.db, id),
    markReady: (id, result) => markFlightReady(database.db, id, result),
    markFailed: (id, errorCode) => markFlightFailed(database.db, id, errorCode),
  },
  notify: (event) => notifyFlightStatus(database.db, event),
  onError: (error, flightId) => logger.error({ err: error, flightId }, 'flight processing failed'),
  onReady: (flightId, summary) => logger.info({ flightId, ...summary }, 'flight ready'),
});

const queue = createFlightQueue({
  concurrency: config.WORKER_CONCURRENCY,
  process: async (flightId) => {
    logger.info({ flightId }, 'processing flight');
    await processor.process(flightId);
    logger.info({ flightId }, 'flight processed');
  },
  onError: (error, flightId) => logger.error({ err: error, flightId }, 'flight processing failed'),
});

const listener = createChannelListener({
  connectionString: config.DATABASE_URL,
  channels: [FLIGHT_QUEUED_CHANNEL],
  onNotification: (_channel, payload) => queue.enqueue(payload),
  onError: (error) => logger.error({ err: error }, 'flight queue listener error'),
});

/** ТЗ §4.2, §5.2: при старте и периодически — переставить в очередь всё незавершённое. */
async function requeueUnfinished(): Promise<void> {
  const stuck = await listUnfinishedFlights(database.db);
  for (const flight of stuck) queue.enqueue(flight.id);
  if (stuck.length > 0) logger.info({ count: stuck.length }, 'requeued unfinished flights');
}

const retention = createRetentionSweep({
  repository: {
    listExpired: (before, limit) => listExpiredAnonymousFlights(database.db, before, limit),
    delete: (ids) => deleteFlights(database.db, ids),
  },
  storage,
  now: () => Date.now(),
  batchSize: RETENTION_BATCH_SIZE,
  onError: (error, flightId) => logger.error({ err: error, flightId }, 'expired flight cleanup failed'),
});

/** ТЗ §11.2: анонимные загрузки старше срока хранения — из S3 и из базы. */
async function sweepExpired(): Promise<void> {
  const { deleted, failed } = await retention.run();
  if (deleted > 0 || failed > 0) logger.info({ deleted, failed }, 'expired anonymous flights swept');
}

await listener.start();
// Разово: полёты до задач 2.11 и 2.13 (нет сводки, линии, точки взлёта) — на повторную обработку.
const backfill = await requeueFlightsForBackfill(database.db);
if (backfill > 0) logger.info({ count: backfill }, 'requeued flights for derived-data backfill');
await requeueUnfinished();
const sweep = setInterval(() => {
  void requeueUnfinished().catch((error: unknown) => logger.error({ err: error }, 'requeue sweep failed'));
}, QUEUE_SWEEP_INTERVAL_S * MS_PER_SECOND);

const logSweepFailure = (error: unknown): void => logger.error({ err: error }, 'retention sweep failed');
void sweepExpired().catch(logSweepFailure);
const retentionTimer = setInterval(() => {
  void sweepExpired().catch(logSweepFailure);
}, RETENTION_SWEEP_INTERVAL_S * MS_PER_SECOND);

logger.info({ concurrency: config.WORKER_CONCURRENCY }, 'worker started');

const shutdown = (signal: NodeJS.Signals): void => {
  logger.info({ signal }, 'shutting down');
  clearInterval(sweep);
  clearInterval(retentionTimer);
  void (async () => {
    try {
      await listener.stop();
      await queue.close();
      await pool.close();
      await database.close();
      process.exit(0);
    } catch (error) {
      logger.error({ err: error }, 'shutdown failed');
      process.exit(1);
    }
  })();
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
