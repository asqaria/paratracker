import { HealthProblem, HealthResponse, type DatabaseCheck, type StorageCheck } from '@skyline/core';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';

import { problem, sendProblem } from './problem.js';

const MS_PER_S = 1000;
const HTTP_SERVICE_UNAVAILABLE = 503;

/** Проверки зависимостей. Каждая бросает, если зависимость недоступна. */
export interface HealthProbe {
  /** Версия PostGIS — заодно доказывает, что расширение установлено. */
  postgisVersion(signal: AbortSignal): Promise<string>;
  storage(signal: AbortSignal): Promise<void>;
}

export interface HealthRouteOptions {
  probe: HealthProbe;
  timeoutS: number;
}

async function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>, timeoutS: number): Promise<T> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`timed out after ${timeoutS} s`);
      controller.abort(error);
      reject(error);
    }, timeoutS * MS_PER_S);
  });
  try {
    return await Promise.race([run(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function checkDatabase(options: HealthRouteOptions, log: FastifyBaseLogger): Promise<DatabaseCheck> {
  try {
    const postgisVersion = await withTimeout((signal) => options.probe.postgisVersion(signal), options.timeoutS);
    return { status: 'up', postgisVersion };
  } catch (err) {
    log.warn({ err, check: 'database' }, 'health check failed');
    return { status: 'down' };
  }
}

async function checkStorage(options: HealthRouteOptions, log: FastifyBaseLogger): Promise<StorageCheck> {
  try {
    await withTimeout((signal) => options.probe.storage(signal), options.timeoutS);
    return { status: 'up' };
  } catch (err) {
    log.warn({ err, check: 'storage' }, 'health check failed');
    return { status: 'down' };
  }
}

export function registerHealthRoutes(app: FastifyInstance, options: HealthRouteOptions): void {
  app.get('/health', async (request, reply) => {
    const [database, storage] = await Promise.all([
      checkDatabase(options, request.log),
      checkStorage(options, request.log),
    ]);
    void reply.header('cache-control', 'no-store');

    if (database.status === 'up' && storage.status === 'up') {
      return HealthResponse.parse({ status: 'ok', checks: { database, storage } });
    }

    const body = HealthProblem.parse({
      ...problem(HTTP_SERVICE_UNAVAILABLE, { detail: 'One or more dependencies are unavailable' }),
      checks: { database, storage },
    });
    return sendProblem(reply, body);
  });
}
