import { ThermalReviewResponse, type ThermalReviewLabels } from '@skyline/core';
import type { ThermalReviewRecord } from '@skyline/db';
import { describe, expect, it } from 'vitest';

import { buildApp } from './app.js';
import type { AuthDeps } from './auth/routes.js';
import { signAccessToken } from './auth/tokens.js';
import type { ReviewRoutesDeps } from './reviews.js';

const SECRET = new TextEncoder().encode('test-secret-that-is-at-least-32-bytes!');
const USER_ID = '11111111-2222-4333-8444-555555555555';
const FLIGHT_ID = '22222222-2222-4333-8444-555555555555';
const NOW = new Date(Date.UTC(2026, 8, 27, 12));
const T0 = Date.UTC(2026, 6, 15, 9);

const LABELS: ThermalReviewLabels = {
  confirmed: [{ startMs: T0 + 490_000, endMs: T0 + 1_157_000 }],
  rejected: [{ startMs: T0 + 1_906_000, endMs: T0 + 1_948_000 }],
  missed: [],
};

function harness(found: { review: ThermalReviewRecord | null; startedAt: Date | null } | null) {
  const saved: Parameters<ReviewRoutesDeps['save']>[0][] = [];
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
  const reviews: ReviewRoutesDeps = {
    find: () => Promise.resolve(found),
    save: (args) => {
      saved.push(args);
      return Promise.resolve(found !== null);
    },
  };
  return { app: buildApp({ logger: false, auth, reviews }), saved };
}

const cookies = async () => ({ skyline_at: await signAccessToken(USER_ID, SECRET, NOW) });
const url = `/api/v1/flights/${FLIGHT_ID}/review`;

describe('сверка термиков', () => {
  it('до сверки — пустая разметка; после — сохранённая', async () => {
    const empty = await harness({ review: null, startedAt: new Date(T0) }).app.inject({ url, cookies: await cookies() });
    expect(ThermalReviewResponse.parse(empty.json())).toEqual({
      labels: { confirmed: [], rejected: [], missed: [] },
      updatedAt: null,
    });

    const review = { labels: LABELS, updatedAt: NOW };
    const res = await harness({ review, startedAt: new Date(T0) }).app.inject({ url, cookies: await cookies() });
    expect(ThermalReviewResponse.parse(res.json())).toEqual({ labels: LABELS, updatedAt: NOW.toISOString() });
  });

  it('сохранение: 204; кривая разметка — 400; чужой полёт — 404; без входа — 401', async () => {
    const h = harness({ review: null, startedAt: new Date(T0) });
    const put = async (payload: unknown, withCookies = true) =>
      h.app.inject({ method: 'PUT', url, payload: payload as Record<string, unknown>, cookies: withCookies ? await cookies() : {} });
    expect((await put(LABELS)).statusCode).toBe(204);
    expect(h.saved).toEqual([{ flightId: FLIGHT_ID, userId: USER_ID, labels: LABELS }]);
    expect((await put({ confirmed: [{ startMs: 5, endMs: 1 }], rejected: [], missed: [] })).statusCode).toBe(400);
    expect((await put(LABELS, false)).statusCode).toBe(401);
    const foreign = harness(null);
    const res = await foreign.app.inject({ method: 'PUT', url, payload: LABELS, cookies: await cookies() });
    expect(res.statusCode).toBe(404);
  });

  it('выгрузка *.labels.json: время от начала трека, rejected → notThermals', async () => {
    const h = harness({ review: { labels: LABELS, updatedAt: NOW }, startedAt: new Date(T0) });
    const res = await h.app.inject({ url: `${url}/labels.json`, cookies: await cookies() });
    expect(res.headers['content-disposition']).toContain(`${FLIGHT_ID}.labels.json`);
    expect(res.json()).toMatchObject({
      file: `${FLIGHT_ID}.igc`,
      confirmed: [{ start: '0:08:10', end: '0:19:17' }],
      notThermals: [{ start: '0:31:46', end: '0:32:28' }],
      missed: [],
    });
    const none = harness({ review: null, startedAt: new Date(T0) });
    expect((await none.app.inject({ url: `${url}/labels.json`, cookies: await cookies() })).statusCode).toBe(409);
  });
});
