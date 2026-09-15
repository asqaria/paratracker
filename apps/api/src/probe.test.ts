import { HealthResponse } from '@skyline/core';
import { createDatabase } from '@skyline/db';
import { describe, expect, it } from 'vitest';

import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { HEALTH_CHECK_TIMEOUT_S } from './constants.js';
import { createHealthProbe } from './probe.js';
import { createStorageClient } from './storage.js';

const env = process.env;

// Интеграционный: нужен поднятый docker compose (postgres + minio с бакетом).
describe.runIf(Boolean(env.DATABASE_URL && env.S3_ENDPOINT))('health на живых зависимостях', () => {
  it('200 и PostGIS 3.5', async () => {
    const config = loadConfig(env);
    const database = createDatabase(config.DATABASE_URL);
    const storage = createStorageClient(config);
    const app = buildApp({
      logger: false,
      health: {
        probe: createHealthProbe({ db: database.db, storage, bucket: config.S3_BUCKET }),
        timeoutS: HEALTH_CHECK_TIMEOUT_S,
      },
    });

    try {
      const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
      expect(res.statusCode, res.body).toBe(200);
      expect(HealthResponse.parse(res.json()).checks.database.postgisVersion).toMatch(/^3\.5\./);
    } finally {
      await app.close();
      await database.close();
      storage.destroy();
    }
  });
});
