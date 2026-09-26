import { describe, expect, it } from 'vitest';

import { createGlider, deleteGlider, GLIDERS_URL, setFlightGlider } from './gliders-api';

const FLIGHT = '22222222-2222-4333-8444-555555555555';
const GLIDER = { id: '44444444-2222-4333-8444-555555555555', manufacturer: 'Ozone', model: 'Rush 6', size: 'ML', certification: 'EN-B', isDefault: true };

function recorder(responses: Response[]) {
  const calls: { url: string; method: string; body?: string }[] = [];
  const fetchImpl: typeof fetch = (input, init) => {
    calls.push({ url: input as string, method: init?.method ?? 'GET', ...(typeof init?.body === 'string' ? { body: init.body } : {}) });
    const next = responses.shift();
    return next ? Promise.resolve(next) : Promise.reject(new Error('unexpected request'));
  };
  return { calls, fetchImpl };
}

describe('gliders-api', () => {
  it('создание — POST JSON-ом, ответ по контракту', async () => {
    const { calls, fetchImpl } = recorder([new Response(JSON.stringify(GLIDER), { status: 201 })]);
    const input = { manufacturer: 'Ozone', model: 'Rush 6', size: 'ML', certification: 'EN-B', isDefault: false } as const;
    await expect(createGlider(input, fetchImpl)).resolves.toEqual(GLIDER);
    expect(calls).toEqual([{ url: GLIDERS_URL, method: 'POST', body: JSON.stringify(input) }]);
  });

  it('крыло полёта — PATCH полёта; null отвязывает', async () => {
    const { calls, fetchImpl } = recorder([new Response(null, { status: 204 })]);
    await setFlightGlider(FLIGHT, null, fetchImpl);
    expect(calls).toEqual([{ url: `/api/v1/flights/${FLIGHT}`, method: 'PATCH', body: '{"gliderId":null}' }]);
  });

  it('ошибка сервера — исключение', async () => {
    const { fetchImpl } = recorder([new Response(null, { status: 404 })]);
    await expect(deleteGlider(GLIDER.id, fetchImpl)).rejects.toThrow(/404/);
  });
});
