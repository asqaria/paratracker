import {
  FlightDetailsResponse,
  GlidesResponse,
  PROBLEM_CONTENT_TYPE,
  ThermalsResponse,
  WindResponse,
} from '@skyline/core';
import type { FlightDetailsRecord, GlideRecord, ThermalRecord } from '@skyline/db';
import { afterEach, describe, expect, it } from 'vitest';

import type { AnalysisRoutesDeps } from './analysis.js';
import { buildApp } from './app.js';

/** Настоящий UUID v4: z.uuid() в Zod 4 проверяет и версию, и вариант. */
const FLIGHT_ID = '11111111-2222-4333-8444-555555555555';
const T0 = Date.UTC(2026, 6, 15, 10);
const SITE_ID = '33333333-2222-4333-8444-555555555555';
const GLIDER_ID = '44444444-2222-4333-8444-555555555555';
const XC = {
  rules: 'XContest',
  type: 'free_triangle' as const,
  name: 'Closed Free Triangle',
  distanceM: 70_450,
  score: 96.91,
  multiplier: 1.4,
  optimal: true,
  route: [
    { lat: 43.1, lon: 76.4, timeMs: T0 + 1_000_000 },
    { lat: 43.2, lon: 76.8, timeMs: T0 + 2_000_000 },
    { lat: 43.0, lon: 76.6, timeMs: T0 + 3_000_000 },
  ],
  closing: { in: { lat: 43.1, lon: 76.4, timeMs: T0 + 900_000 }, out: { lat: 43.1, lon: 76.41, timeMs: T0 + 3_500_000 }, distanceM: 1230 },
};

const details = (overrides: Partial<FlightDetailsRecord> = {}): FlightDetailsRecord => ({
  id: FLIGHT_ID,
  status: 'ready',
  analysisLevel: 'full',
  startedAt: new Date(T0),
  endedAt: new Date(T0 + 3_600_000),
  durationS: 3600,
  timezone: 'Asia/Almaty',
  thermalCount: 1,
  avgClimbMs: 1.61,
  avgGlideRatio: 6.69,
  windDirDeg: 44,
  windSpeedMs: 3.63,
  windProfile: [{ altitudeBand: [1500, 1750], windSpeedMs: 5.1, windDirDeg: 55, confidence: 0.4, circleCount: 12 }],
  userId: null,
  privacy: 'unlisted',
  shareToken: null,
  takeoffSite: { id: SITE_ID, name: 'Ush Konyr', countryCode: 'kz', source: 'seed' },
  landingSite: null,
  glider: { id: GLIDER_ID, manufacturer: 'Ozone', model: 'Rush 6', size: 'ML' },
  gliderRaw: 'OZONE Rush6',
  pilotName: 'Иван Петров',
  xc: XC,
  ...overrides,
});

const thermal: ThermalRecord = {
  seq: 0,
  startedAt: new Date(T0 + 490_000),
  endedAt: new Date(T0 + 1_157_000),
  durationS: 667,
  entryAltM: 1650,
  exitAltM: 2750,
  gainM: 1100,
  avgClimbMs: 1.65,
  maxClimbMs: 4.2,
  turnCount: 22.4,
  avgRadiusM: 38,
  direction: 'cw',
  efficiency: 0.39,
  entryLat: 43.2,
  entryLon: 76.9,
  exitLat: 43.21,
  exitLon: 76.88,
  driftDirDeg: 51,
  driftSpeedMs: 4.4,
};

const glide: GlideRecord = {
  seq: 0,
  startedAt: new Date(T0 + 18_000),
  endedAt: new Date(T0 + 490_000),
  distanceM: 3700,
  altLossM: 523,
  glideRatio: 7.1,
  kind: 'glide',
  avgSpeedMs: 7.84,
  headingDeg: 325,
  headingConsistency: 0.88,
};

function app(flight: FlightDetailsRecord | null) {
  const deps: AnalysisRoutesDeps = {
    details: () => Promise.resolve(flight),
    thermals: () => Promise.resolve([thermal]),
    glides: () => Promise.resolve([glide, { ...glide, seq: 1, kind: 'dynamic', glideRatio: null, headingDeg: null }]),
  };
  return buildApp({ logger: false, analysis: deps });
}

let open: ReturnType<typeof buildApp> | undefined;
afterEach(async () => {
  await open?.close();
  open = undefined;
});

const get = async (flight: FlightDetailsRecord | null, path: string) => {
  open = app(flight);
  return open.inject({ method: 'GET', url: `/api/v1/flights/${FLIGHT_ID}${path}` });
};

describe('GET /api/v1/flights/:id', () => {
  it('200: метаданные и агрегаты, время — ISO UTC, ветер — откуда дует', async () => {
    const response = await get(details(), '');
    expect(response.statusCode).toBe(200);
    expect(FlightDetailsResponse.parse(response.json())).toEqual({
      flightId: FLIGHT_ID,
      status: 'ready',
      analysisLevel: 'full',
      startedAt: '2026-07-15T10:00:00.000Z',
      endedAt: '2026-07-15T11:00:00.000Z',
      durationS: 3600,
      timezone: 'Asia/Almaty',
      thermalCount: 1,
      avgClimbMs: 1.61,
      avgGlideRatio: 6.69,
      wind: { speedMs: 3.63, dirDeg: 44 },
      takeoffSite: { id: SITE_ID, name: 'Ush Konyr', countryCode: 'kz', source: 'seed' },
      landingSite: null,
      glider: { id: GLIDER_ID, label: 'Ozone Rush 6 ML' },
      gliderRaw: 'OZONE Rush6',
      xc: XC,
      pilotName: 'Иван Петров',
      // Аноним смотрит анонимный полёт — править нечего.
      canEdit: false,
      privacy: 'unlisted',
    });
  });

  it('ещё не обработан — 200 с пустыми агрегатами: статус виден и так', async () => {
    const pending = details({
      status: 'parsing',
      analysisLevel: null,
      startedAt: null,
      endedAt: null,
      durationS: null,
      thermalCount: null,
      avgClimbMs: null,
      avgGlideRatio: null,
      windDirDeg: null,
      windSpeedMs: null,
      windProfile: null,
    });
    const body = FlightDetailsResponse.parse((await get(pending, '')).json());
    expect(body).toMatchObject({ status: 'parsing', thermalCount: null, wind: null, startedAt: null });
  });
});

describe('GET /api/v1/flights/:id/thermals|glides|wind', () => {
  it('термики: класс по среднему набору, точки, снос как ветер', async () => {
    const response = await get(details(), '/thermals');
    expect(response.statusCode).toBe(200);
    const [first] = ThermalsResponse.parse(response.json()).thermals;
    expect(first).toMatchObject({
      seq: 0,
      startedAt: '2026-07-15T10:08:10.000Z',
      strength: 'medium',
      entry: { lat: 43.2, lon: 76.9 },
      exit: { lat: 43.21, lon: 76.88 },
      drift: { dirDeg: 51, speedMs: 4.4 },
    });
  });

  it('глайды: у dynamic нет качества и курса', async () => {
    const { glides } = GlidesResponse.parse((await get(details(), '/glides')).json());
    expect(glides.map((g) => [g.kind, g.glideRatio, g.headingDeg])).toEqual([
      ['glide', 7.1, 325],
      ['dynamic', null, null],
    ]);
  });

  it('ветер: полёта и профиль', async () => {
    const body = WindResponse.parse((await get(details(), '/wind')).json());
    expect(body.flight).toEqual({ speedMs: 3.63, dirDeg: 44 });
    expect(body.profile).toEqual(details().windProfile);
  });

  it('трек basic — анализа нет: пустые списки, ветра нет', async () => {
    const basic = details({ analysisLevel: 'basic', windDirDeg: null, windSpeedMs: null, windProfile: null });
    expect(WindResponse.parse((await get(basic, '/wind')).json())).toEqual({ flight: null, profile: [] });
  });

  it.each(['/thermals', '/glides', '/wind'])('%s: полёт не обработан — 409, нет полёта — 404', async (path) => {
    const notReady = await get(details({ status: 'parsing' }), path);
    expect(notReady.statusCode).toBe(409);
    expect(notReady.headers['content-type']).toContain(PROBLEM_CONTENT_TYPE);
    await open?.close();
    const missing = await get(null, path);
    expect(missing.statusCode).toBe(404);
    expect(missing.headers['content-type']).toContain(PROBLEM_CONTENT_TYPE);
  });

  it('не-uuid — 400', async () => {
    open = app(details());
    const response = await open.inject({ method: 'GET', url: '/api/v1/flights/not-a-uuid/thermals' });
    expect(response.statusCode).toBe(400);
  });
});
