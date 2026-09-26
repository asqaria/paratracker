import { describe, expect, it } from 'vitest';

import { REFRESH_URL } from '../auth/session';
import { CLAIM_URL, fetchLogbookPage, LOGBOOK_URL, NO_FILTERS, postClaims } from './fetch-logbook';

const FLIGHT = '11111111-2222-4333-8444-555555555555';

function scripted(answers: Response[]) {
  const calls: { url: string; method: string; body?: string }[] = [];
  const fetchImpl: typeof fetch = (input, init) => {
    calls.push({ url: input as string, method: init?.method ?? 'GET', ...(typeof init?.body === 'string' ? { body: init.body } : {}) });
    const next = answers.shift();
    return next ? Promise.resolve(next) : Promise.reject(new Error('unexpected request'));
  };
  return { calls, fetchImpl };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('fetchLogbookPage', () => {
  it('первая страница без курсора, следующая — с курсором как есть', async () => {
    const page = { items: [], nextCursor: null };
    const { calls, fetchImpl } = scripted([json(page), json(page), json(page)]);
    await fetchLogbookPage(null, NO_FILTERS, fetchImpl);
    await fetchLogbookPage('abc_-1', NO_FILTERS, fetchImpl);
    await fetchLogbookPage(null, { siteId: FLIGHT, gliderId: FLIGHT }, fetchImpl);
    expect(calls.map((c) => c.url)).toEqual([
      LOGBOOK_URL,
      `${LOGBOOK_URL}?cursor=abc_-1`,
      `${LOGBOOK_URL}?siteId=${FLIGHT}&gliderId=${FLIGHT}`,
    ]);
  });

  it('access истёк — обновляет сессию и повторяет', async () => {
    const { calls, fetchImpl } = scripted([json({}, 401), new Response(null, { status: 204 }), json({ items: [], nextCursor: null })]);
    await expect(fetchLogbookPage(null, NO_FILTERS, fetchImpl)).resolves.toEqual({ items: [], nextCursor: null });
    expect(calls.map((c) => c.url)).toEqual([LOGBOOK_URL, REFRESH_URL, LOGBOOK_URL]);
  });

  it('сессии нет — ошибка', async () => {
    const { fetchImpl } = scripted([json({}, 401), json({}, 401)]);
    await expect(fetchLogbookPage(null, NO_FILTERS, fetchImpl)).rejects.toThrow(/401/);
  });
});

describe('postClaims', () => {
  it('шлёт токены JSON-ом и читает забранные', async () => {
    const { calls, fetchImpl } = scripted([json({ claimed: [FLIGHT] })]);
    const claims = [{ flightId: FLIGHT, token: 't' }];
    await expect(postClaims(claims, fetchImpl)).resolves.toEqual({ claimed: [FLIGHT] });
    expect(calls).toEqual([{ url: CLAIM_URL, method: 'POST', body: JSON.stringify({ claims }) }]);
  });
});
