import {
  ClaimResponse,
  LogbookMapResponse,
  LogbookResponse,
  PROBLEM_CONTENT_TYPE,
  SeasonStatsResponse,
} from '@skyline/core';
import type { LogbookCursor, LogbookEntryRecord, LogbookPage } from '@skyline/db';
import { describe, expect, it } from 'vitest';

import { buildApp } from './app.js';
import type { AuthDeps } from './auth/routes.js';
import { hashToken, signAccessToken } from './auth/tokens.js';
import type { LogbookRoutesDeps } from './logbook.js';

const SECRET = new TextEncoder().encode('test-secret-that-is-at-least-32-bytes!');
const USER_ID = '11111111-2222-4333-8444-555555555555';
const FLIGHT_A = 'aaaaaaaa-2222-4333-8444-555555555555';
const FLIGHT_B = 'bbbbbbbb-2222-4333-8444-555555555555';
const NOW = new Date(Date.UTC(2026, 8, 26, 12));
const SITE_ID = '33333333-2222-4333-8444-555555555555';
const GLIDER_ID = '44444444-2222-4333-8444-555555555555';

const entry = (id: string, startedAt: Date | null): LogbookEntryRecord => ({
  id,
  status: startedAt ? 'ready' : 'pending',
  startedAt,
  uploadedAt: new Date(Date.UTC(2026, 8, 20)),
  timezone: startedAt ? 'Asia/Almaty' : null,
  durationS: startedAt ? 5400 : null,
  distanceTrackM: startedAt ? 42_000 : null,
  maxAltM: startedAt ? 3505 : null,
  thermalCount: startedAt ? 12 : null,
  takeoffSite: startedAt ? { id: SITE_ID, name: 'Ush Konyr', countryCode: 'kz', source: 'seed' } : null,
  glider: startedAt ? { id: GLIDER_ID, manufacturer: 'Ozone', model: 'Rush 6', size: null } : null,
});

function harness(page: LogbookPage = { items: [], next: null }) {
  const listed: Parameters<LogbookRoutesDeps['list']>[0][] = [];
  const claims: { userId: string; claims: { flightId: string; tokenHash: string }[] }[] = [];
  const statsCalls: [string, number | undefined][] = [];
  const auth: AuthDeps = {
    jwtSecret: SECRET,
    publicUrl: 'https://skyline.example',
    google: null,
    users: { signIn: () => Promise.reject(new Error('unused')), profile: () => Promise.resolve(null) },
    sessions: {
      create: () => Promise.resolve(),
      rotate: () => Promise.resolve({ kind: 'invalid' }),
      revoke: () => Promise.resolve(),
    },
    now: () => NOW,
  };
  const logbook: LogbookRoutesDeps = {
    list: (query) => {
      listed.push(query);
      return Promise.resolve(page);
    },
    map: () =>
      Promise.resolve([
        { id: FLIGHT_A, startedAt: new Date(Date.UTC(2026, 6, 1, 9)), coordinates: [[76.9, 43.2], [76.95, 43.25]] },
      ]),
    sites: () =>
      Promise.resolve([{ id: SITE_ID, name: 'Ush Konyr', countryCode: 'kz', source: 'seed', flightCount: 13 }]),
    stats: (userId, year) => {
      statsCalls.push([userId, year]);
      return Promise.resolve(STATS);
    },
    claim: (userId, list) => {
      claims.push({ userId, claims: [...list] });
      return Promise.resolve(list.filter((c) => c.tokenHash === hashToken('good')).map((c) => c.flightId));
    },
  };
  return { app: buildApp({ logger: false, auth, logbook }), listed, claims, statsCalls };
}

const signedIn = async () => ({ skyline_at: await signAccessToken(USER_ID, SECRET, NOW) });

describe('GET /logbook', () => {
  it('без входа — 401 Problem Details', async () => {
    const res = await harness().app.inject('/api/v1/logbook');
    expect(res.statusCode).toBe(401);
    expect(res.headers['content-type']).toContain(PROBLEM_CONTENT_TYPE);
  });

  it('свои полёты по контракту; курсор непрозрачный и возвращается обратно', async () => {
    const next: LogbookCursor = { sortKey: new Date(Date.UTC(2026, 6, 1, 9)), id: FLIGHT_B };
    const h = harness({ items: [entry(FLIGHT_A, new Date(Date.UTC(2026, 6, 2, 9))), entry(FLIGHT_B, null)], next });
    const res = await h.app.inject({ url: '/api/v1/logbook?limit=2&from=2026-06-01', cookies: await signedIn() });

    expect(res.statusCode).toBe(200);
    const body = LogbookResponse.parse(res.json());
    expect(body.items[0]).toEqual({
      id: FLIGHT_A,
      status: 'ready',
      startedAt: '2026-07-02T09:00:00.000Z',
      uploadedAt: '2026-09-20T00:00:00.000Z',
      timezone: 'Asia/Almaty',
      durationS: 5400,
      distanceTrackM: 42_000,
      maxAltM: 3505,
      thermalCount: 12,
      takeoffSite: { id: SITE_ID, name: 'Ush Konyr', countryCode: 'kz', source: 'seed' },
      glider: { id: GLIDER_ID, label: 'Ozone Rush 6' },
    });
    expect(body.items[1]?.startedAt).toBeNull();
    expect(h.listed[0]).toEqual({ userId: USER_ID, limit: 2, from: '2026-06-01' });

    // Фильтр по месту старта (задача 2.13).
    await h.app.inject({ url: `/api/v1/logbook?siteId=${SITE_ID}`, cookies: await signedIn() });
    expect(h.listed[1]).toEqual({ userId: USER_ID, limit: 30, siteId: SITE_ID });

    // Фильтр по крылу (задача 2.13б).
    await h.app.inject({ url: `/api/v1/logbook?gliderId=${GLIDER_ID}`, cookies: await signedIn() });
    expect(h.listed[2]).toEqual({ userId: USER_ID, limit: 30, gliderId: GLIDER_ID });

    // Курсор — как есть в следующий запрос.
    await h.app.inject({ url: `/api/v1/logbook?cursor=${body.nextCursor ?? ''}`, cookies: await signedIn() });
    expect(h.listed[3]).toEqual({ userId: USER_ID, limit: 30, after: next });
  });

  it('кривой курсор или лимит — 400', async () => {
    const h = harness();
    for (const query of ['cursor=garbage', 'limit=1000', 'from=yesterday']) {
      const res = await h.app.inject({ url: `/api/v1/logbook?${query}`, cookies: await signedIn() });
      expect(res.statusCode, query).toBe(400);
    }
  });
});

const STATS = {
  year: 2026,
  years: [2026, 2025],
  totals: { flights: 3, airtimeS: 10_800, distanceM: 55_000, gainM: 1900, maxAltM: 3200, longestAirtimeS: 5400, longestDistanceM: 40_000 },
  byMonth: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, flights: i === 4 ? 3 : 0, airtimeS: i === 4 ? 10_800 : 0, distanceM: i === 4 ? 55_000 : 0 })),
  topSites: [{ id: SITE_ID, name: 'Ush Konyr', countryCode: 'kz', source: 'seed' as const, flights: 3, airtimeS: 10_800 }],
};

describe('GET /logbook/stats', () => {
  it('статистика по контракту; год из запроса или последний', async () => {
    const h = harness();
    const res = await h.app.inject({ url: '/api/v1/logbook/stats?year=2025', cookies: await signedIn() });
    expect(SeasonStatsResponse.parse(res.json())).toEqual(STATS);
    await h.app.inject({ url: '/api/v1/logbook/stats', cookies: await signedIn() });
    expect(h.statsCalls).toEqual([
      [USER_ID, 2025],
      [USER_ID, undefined],
    ]);
  });

  it('без входа — 401; кривой год — 400', async () => {
    const h = harness();
    expect((await h.app.inject('/api/v1/logbook/stats')).statusCode).toBe(401);
    expect((await h.app.inject({ url: '/api/v1/logbook/stats?year=abc', cookies: await signedIn() })).statusCode).toBe(400);
  });
});

describe('GET /logbook/sites', () => {
  it('места пилота с числом полётов; без входа — 401', async () => {
    const h = harness();
    const res = await h.app.inject({ url: '/api/v1/logbook/sites', cookies: await signedIn() });
    expect(res.json()).toEqual({
      sites: [{ id: SITE_ID, name: 'Ush Konyr', countryCode: 'kz', source: 'seed', flightCount: 13 }],
    });
    expect((await h.app.inject('/api/v1/logbook/sites')).statusCode).toBe(401);
  });
});

describe('GET /logbook/map', () => {
  it('GeoJSON своих полётов', async () => {
    const res = await harness().app.inject({ url: '/api/v1/logbook/map', cookies: await signedIn() });
    expect(res.statusCode).toBe(200);
    expect(LogbookMapResponse.parse(res.json()).features).toEqual([
      {
        type: 'Feature',
        properties: { id: FLIGHT_A, startedAt: '2026-07-01T09:00:00.000Z' },
        geometry: { type: 'LineString', coordinates: [[76.9, 43.2], [76.95, 43.25]] },
      },
    ]);
  });

  it('без входа — 401', async () => {
    expect((await harness().app.inject('/api/v1/logbook/map')).statusCode).toBe(401);
  });
});

describe('POST /flights/claim', () => {
  it('в репозиторий — только хэши токенов; в ответе — забранные', async () => {
    const h = harness();
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/flights/claim',
      cookies: await signedIn(),
      payload: {
        claims: [
          { flightId: FLIGHT_A, token: 'good' },
          { flightId: FLIGHT_B, token: 'bad' },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(ClaimResponse.parse(res.json())).toEqual({ claimed: [FLIGHT_A] });
    expect(h.claims).toEqual([
      {
        userId: USER_ID,
        claims: [
          { flightId: FLIGHT_A, tokenHash: hashToken('good') },
          { flightId: FLIGHT_B, tokenHash: hashToken('bad') },
        ],
      },
    ]);
  });

  it('без входа — 401; кривое тело — 400', async () => {
    const h = harness();
    const payload = { claims: [{ flightId: FLIGHT_A, token: 'good' }] };
    expect((await h.app.inject({ method: 'POST', url: '/api/v1/flights/claim', payload })).statusCode).toBe(401);
    const bad = await h.app.inject({ method: 'POST', url: '/api/v1/flights/claim', cookies: await signedIn(), payload: { claims: [] } });
    expect(bad.statusCode).toBe(400);
    expect(h.claims).toHaveLength(0);
  });
});
