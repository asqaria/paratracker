import {
  createChannelListener,
  createDatabase,
  findFlight,
  FLIGHT_STATUS_CHANNEL,
  insertFlight,
  notifyFlightQueued,
} from '@skyline/db';

import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { HEALTH_CHECK_TIMEOUT_S } from './constants.js';
import { createFlightEventHub } from './events.js';
import { createHealthProbe } from './probe.js';
import { createObjectStorage, createStorageClient } from './storage.js';

const config = loadConfig(process.env);
const database = createDatabase(config.DATABASE_URL);
const s3 = createStorageClient(config);
const storage = createObjectStorage(s3, config.S3_BUCKET);

/** События конвейера приходят от воркера через LISTEN/NOTIFY, без опроса базы. */
const events = createFlightEventHub();

const app = buildApp({
  logger: {
    level: config.LOG_LEVEL,
    redact: ['req.headers.authorization', 'req.headers.cookie'],
  },
  health: {
    probe: createHealthProbe({ db: database.db, storage: s3, bucket: config.S3_BUCKET }),
    timeoutS: HEALTH_CHECK_TIMEOUT_S,
  },
  flights: {
    repository: {
      insert: (flight) => insertFlight(database.db, flight),
      find: (id) => findFlight(database.db, id),
    },
    storage,
    events,
    onQueued: (flightId) => notifyFlightQueued(database.db, flightId),
  },
});

const statusListener = createChannelListener({
  connectionString: config.DATABASE_URL,
  channels: [FLIGHT_STATUS_CHANNEL],
  onNotification: (_channel, payload) => events.handleNotification(payload),
  onError: (error) => app.log.error({ err: error }, 'flight status listener error'),
});

// Упавшее простаивающее соединение не должно ронять процесс.
database.pool.on('error', (err) => app.log.error({ err }, 'postgres pool error'));

app.addHook('onClose', async () => {
  await statusListener.stop();
  await database.close();
  s3.destroy();
});

const shutdown = (signal: NodeJS.Signals): void => {
  app.log.info({ signal }, 'shutting down');
  app.close().then(
    () => process.exit(0),
    (err: unknown) => {
      app.log.error({ err }, 'shutdown failed');
      process.exit(1);
    },
  );
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

await statusListener.start();
await app.listen({ host: config.API_HOST, port: config.API_PORT });
