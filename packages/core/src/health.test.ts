import { describe, expect, it } from 'vitest';

import { HealthProblem, HealthResponse } from './health.js';

describe('HealthResponse', () => {
  it('принимает ответ, где все зависимости доступны', () => {
    const body = {
      status: 'ok',
      checks: { database: { status: 'up', postgisVersion: '3.5.2' }, storage: { status: 'up' } },
    };
    expect(HealthResponse.parse(body)).toEqual(body);
  });

  it('не принимает 200 с упавшей зависимостью', () => {
    const body = {
      status: 'ok',
      checks: { database: { status: 'down' }, storage: { status: 'up' } },
    };
    expect(HealthResponse.safeParse(body).success).toBe(false);
  });

  it('требует версию PostGIS у доступной БД', () => {
    const body = { status: 'ok', checks: { database: { status: 'up' }, storage: { status: 'up' } } };
    expect(HealthResponse.safeParse(body).success).toBe(false);
  });
});

describe('HealthProblem', () => {
  it('это Problem Details 503 с расширением checks', () => {
    const body = {
      type: 'about:blank',
      title: 'Service Unavailable',
      status: 503,
      checks: { database: { status: 'up', postgisVersion: '3.5.2' }, storage: { status: 'down' } },
    };
    expect(HealthProblem.parse(body)).toEqual(body);
    expect(HealthProblem.safeParse({ ...body, status: 500 }).success).toBe(false);
  });
});
