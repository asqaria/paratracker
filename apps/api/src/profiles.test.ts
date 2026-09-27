import { LogbookResponse, PublicProfileResponse } from '@skyline/core';
import type { LogbookEntryRecord, PublicProfile } from '@skyline/db';
import { describe, expect, it } from 'vitest';

import { buildApp } from './app.js';

const USER_ID = '11111111-2222-4333-8444-555555555555';
const FLIGHT_ID = '22222222-2222-4333-8444-555555555555';

const PROFILE: PublicProfile = {
  id: USER_ID,
  username: 'asqar.t',
  displayName: 'Асқар',
  avatarUrl: null,
  memberSince: new Date(Date.UTC(2026, 8, 1)),
  totals: {
    flights: 2,
    airtimeS: 5400,
    distanceM: 50_000,
    maxAltM: 3000,
    longestAirtimeS: 3600,
    longestDistanceM: 40_000,
    bestXcScore: 55.5,
  },
};

const ENTRY: LogbookEntryRecord = {
  id: FLIGHT_ID,
  status: 'ready',
  startedAt: new Date(Date.UTC(2026, 6, 15, 6)),
  uploadedAt: new Date(Date.UTC(2026, 6, 15, 9)),
  timezone: 'Asia/Almaty',
  durationS: 3600,
  distanceTrackM: 40_000,
  maxAltM: 3000,
  thermalCount: 5,
  takeoffSite: null,
  glider: null,
};

function harness() {
  const calls: unknown[] = [];
  const app = buildApp({
    logger: false,
    profiles: {
      find: (username) => Promise.resolve(username === PROFILE.username ? PROFILE : null),
      flights: (query) => {
        calls.push(query);
        return Promise.resolve({ items: [ENTRY], next: { sortKey: ENTRY.startedAt ?? new Date(0), id: FLIGHT_ID } });
      },
    },
  });
  return { app, calls };
}

describe('GET /api/v1/users/:username (задача 3.11)', () => {
  it('профиль без входа: имя, дата регистрации, итоги; адрес — без учёта регистра', async () => {
    const res = await harness().app.inject({ url: '/api/v1/users/Asqar.T' });
    expect(res.statusCode).toBe(200);
    expect(PublicProfileResponse.parse(res.json())).toEqual({
      username: 'asqar.t',
      displayName: 'Асқар',
      avatarUrl: null,
      memberSince: '2026-09-01T00:00:00.000Z',
      totals: PROFILE.totals,
    });
    expect(res.json()).not.toHaveProperty('id');
  });

  it('нет такого пилота или кривое имя — 404', async () => {
    const h = harness();
    expect((await h.app.inject({ url: '/api/v1/users/nobody' })).statusCode).toBe(404);
    expect((await h.app.inject({ url: '/api/v1/users/%D0%BF%D0%B8' })).statusCode).toBe(404);
  });
});

describe('GET /api/v1/users/:username/flights', () => {
  it('публичные полёты страницами: курсор туда и обратно', async () => {
    const h = harness();
    const first = await h.app.inject({ url: '/api/v1/users/asqar.t/flights?limit=1' });
    expect(first.statusCode).toBe(200);
    const page = LogbookResponse.parse(first.json());
    expect(page.items.map((item) => item.id)).toEqual([FLIGHT_ID]);
    expect(page.nextCursor).not.toBeNull();
    await h.app.inject({ url: `/api/v1/users/asqar.t/flights?cursor=${page.nextCursor ?? ''}` });
    expect(h.calls).toEqual([
      { userId: USER_ID, limit: 1 },
      { userId: USER_ID, limit: 20, after: { sortKey: ENTRY.startedAt, id: FLIGHT_ID } },
    ]);
  });

  it('испорченный курсор — 400; нет пилота — 404', async () => {
    const h = harness();
    expect((await h.app.inject({ url: '/api/v1/users/asqar.t/flights?cursor=garbage' })).statusCode).toBe(400);
    expect((await h.app.inject({ url: '/api/v1/users/nobody/flights' })).statusCode).toBe(404);
  });
});
