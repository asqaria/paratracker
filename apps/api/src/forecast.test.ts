import { FORECAST, FORECAST_ATTRIBUTION, ForecastMapResponse, ForecastSiteResponse, type ForecastHour } from '@skyline/core';
import type { SiteForecastRecord } from '@skyline/db';
import { describe, expect, it } from 'vitest';

import { buildApp } from './app.js';

const NOON = Date.UTC(2026, 8, 30, 6);

const HOUR: ForecastHour = {
  timeMs: NOON,
  verdict: 'xc',
  confidence: 'medium',
  reasons: [],
  models: [
    {
      model: 'ecmwf',
      verdict: 'xc',
      reasons: [],
      windSpeedMs: 3,
      windDirDeg: 350,
      gustMs: 5,
      ceilingM: 3300,
      cloudBaseM: 3100,
      thermalMs: null,
      stormRisk: 'low',
      upperWindMs: 6,
    },
  ],
  ceilingRangeM: [3100, 3300],
  surface: { heightM: 1905, temperatureC: 16, speedMs: 3, dirDeg: 350 },
  profile: [{ heightM: 3100, temperatureC: 6, speedMs: 6, dirDeg: 270 }],
  wind: [{ heightM: 1905, temperatureC: 16, speedMs: 3, dirDeg: 350 }],
  windModel: 'gfs',
  cloudCoverPct: 20,
  precipitationMm: 0,
};

const USH: SiteForecastRecord = {
  id: 'site-1',
  slug: 'ush-konyr',
  name: 'Ush Konyr',
  lat: 43.1269,
  lon: 76.4653,
  elevationM: 1905,
  timezone: 'Asia/Almaty',
  windSectors: ['N', 'NE', 'NW'],
  maxWindMs: null,
  fetchedAt: new Date(Date.UTC(2026, 8, 30, 0)),
  hours: [HOUR],
};

const app = () => buildApp({ logger: false, forecast: { list: () => Promise.resolve([USH]) } });

describe('GET /api/v1/forecast — сводка для карты', () => {
  it('без входа; место с допустимым ветром по умолчанию, час — вердикт, ветер и потолок главной модели', async () => {
    const response = await app().inject({ method: 'GET', url: '/api/v1/forecast' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe(`public, max-age=${FORECAST.checkIntervalS}`);
    const body = ForecastMapResponse.parse(response.json());
    expect(body.attribution).toBe(FORECAST_ATTRIBUTION);
    expect(body.sites[0]).toMatchObject({ slug: 'ush-konyr', maxWindMs: FORECAST.defaultMaxWindMs, fetchedAt: '2026-09-30T00:00:00.000Z' });
    expect(body.sites[0]?.hours).toEqual([
      { time: '2026-09-30T06:00:00.000Z', verdict: 'xc', confidence: 'medium', windSpeedMs: 3, windDirDeg: 350, ceilingM: 3300 },
    ]);
  });
});

describe('GET /api/v1/forecast/:slug — место по часам', () => {
  it('все модели и профиль ветра; время — ISO', async () => {
    const response = await app().inject({ method: 'GET', url: '/api/v1/forecast/ush-konyr' });
    expect(response.statusCode).toBe(200);
    const body = ForecastSiteResponse.parse(response.json());
    expect(body.hours[0]).toMatchObject({ time: '2026-09-30T06:00:00.000Z', ceilingRangeM: [3100, 3300] });
    expect(body.hours[0]?.models[0]?.model).toBe('ecmwf');
  });

  it('неизвестное место — 404 Problem Details', async () => {
    const response = await app().inject({ method: 'GET', url: '/api/v1/forecast/nowhere' });
    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain('application/problem+json');
  });
});
