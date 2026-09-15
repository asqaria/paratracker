import { describe, expect, it } from 'vitest';

import { fetchHealth, HEALTH_URL } from './fetch-health';

const respond =
  (status: number, body: unknown): typeof fetch =>
  (input) => {
    expect(input).toBe(HEALTH_URL);
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  };

const signal = new AbortController().signal;

describe('fetchHealth', () => {
  it('200 → ok с версией PostGIS', async () => {
    const body = { status: 'ok', checks: { database: { status: 'up', postgisVersion: '3.5.2' }, storage: { status: 'up' } } };
    await expect(fetchHealth(signal, respond(200, body))).resolves.toEqual({ kind: 'ok', checks: body.checks });
  });

  it('503 Problem Details → degraded с проверками', async () => {
    const checks = { database: { status: 'down' }, storage: { status: 'up' } };
    const body = { type: 'about:blank', title: 'Service Unavailable', status: 503, checks };
    await expect(fetchHealth(signal, respond(503, body))).resolves.toEqual({ kind: 'degraded', checks });
  });

  it('прочие ошибки — исключение', async () => {
    const body = { type: 'about:blank', title: 'Bad Gateway', status: 502 };
    await expect(fetchHealth(signal, respond(502, body))).rejects.toThrow(/502/);
  });
});
