import { createDatabase } from '@skyline/db';

import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { HEALTH_CHECK_TIMEOUT_S } from './constants.js';
import { createHealthProbe } from './probe.js';
import { createStorageClient } from './storage.js';

const config = loadConfig(process.env);
const database = createDatabase(config.DATABASE_URL);
const storage = createStorageClient(config);

const app = buildApp({
  logger: {
    level: config.LOG_LEVEL,
    redact: ['req.headers.authorization', 'req.headers.cookie'],
  },
  health: {
    probe: createHealthProbe({ db: database.db, storage, bucket: config.S3_BUCKET }),
    timeoutS: HEALTH_CHECK_TIMEOUT_S,
  },
});

// Упавшее простаивающее соединение не должно ронять процесс.
database.pool.on('error', (err) => app.log.error({ err }, 'postgres pool error'));

app.addHook('onClose', async () => {
  await database.close();
  storage.destroy();
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

await app.listen({ host: config.API_HOST, port: config.API_PORT });
