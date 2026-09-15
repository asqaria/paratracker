import { HealthProblem, HealthResponse, PROBLEM_CONTENT_TYPE, ProblemDetails } from '@skyline/core';
import { describe, expect, it } from 'vitest';

import { buildApp } from './app.js';
import type { HealthProbe } from './health.js';

const TIMEOUT_S = 0.05;

const healthy: HealthProbe = {
  postgisVersion: () => Promise.resolve('3.5.2'),
  storage: () => Promise.resolve(),
};

const appWith = (probe: HealthProbe) => buildApp({ logger: false, health: { probe, timeoutS: TIMEOUT_S } });

describe('GET /api/v1/health', () => {
  it('200 и версия PostGIS, когда всё доступно', async () => {
    const res = await appWith(healthy).inject({ method: 'GET', url: '/api/v1/health' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(HealthResponse.parse(res.json()).checks.database.postgisVersion).toBe('3.5.2');
  });

  it('503 Problem Details, когда БД недоступна', async () => {
    const res = await appWith({ ...healthy, postgisVersion: () => Promise.reject(new Error('ECONNREFUSED')) }).inject(
      { method: 'GET', url: '/api/v1/health' },
    );

    expect(res.statusCode).toBe(503);
    expect(res.headers['content-type']).toContain(PROBLEM_CONTENT_TYPE);
    expect(HealthProblem.parse(res.json()).checks).toEqual({
      database: { status: 'down' },
      storage: { status: 'up' },
    });
  });

  it('зависшее хранилище считается недоступным по таймауту', async () => {
    const hanging: HealthProbe = {
      ...healthy,
      storage: (signal) =>
        new Promise((_, reject) =>
          signal.addEventListener('abort', () => reject(new Error('aborted', { cause: signal.reason }))),
        ),
    };
    const res = await appWith(hanging).inject({ method: 'GET', url: '/api/v1/health' });

    expect(res.statusCode).toBe(503);
    expect(HealthProblem.parse(res.json()).checks.storage).toEqual({ status: 'down' });
  });
});

describe('Problem Details', () => {
  it('404 на неизвестный маршрут', async () => {
    const res = await appWith(healthy).inject({ method: 'GET', url: '/api/v1/nope' });

    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain(PROBLEM_CONTENT_TYPE);
    expect(ProblemDetails.parse(res.json())).toMatchObject({ type: 'about:blank', title: 'Not Found', status: 404 });
  });

  it('500 без внутренних деталей', async () => {
    const app = appWith(healthy);
    app.get('/boom', () => {
      throw new Error('secret connection string');
    });
    const res = await app.inject({ method: 'GET', url: '/boom' });

    expect(res.statusCode).toBe(500);
    expect(res.headers['content-type']).toContain(PROBLEM_CONTENT_TYPE);
    expect(res.body).not.toContain('secret');
  });
});
