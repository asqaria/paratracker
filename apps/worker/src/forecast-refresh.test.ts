import { readFileSync } from 'node:fs';

import { FORECAST, TIME, type ForecastHour } from '@skyline/core';
import type { ForecastSiteRecord } from '@skyline/db';
import { describe, expect, it } from 'vitest';

import { createForecastRefresh, forecastUrl } from './forecast-refresh.js';

/**
 * Загрузка прогноза (задача П.2) без сети: fetch отдаёт реальные ответы
 * Open-Meteo по Уш-Коныру из fixtures/forecast по имени модели в запросе.
 */

const FIXTURES = new URL('../../../fixtures/forecast/', import.meta.url);
const API = 'https://api.example.test/v1/forecast';
const NOW = Date.UTC(2026, 8, 29, 12);

const site = (patch: Partial<ForecastSiteRecord> = {}): ForecastSiteRecord => ({
  id: 'site-1',
  slug: 'ush-konyr',
  name: 'Ush Konyr',
  lat: 43.1269,
  lon: 76.4653,
  elevationM: 1905,
  timezone: 'Asia/Almaty',
  windSectors: ['N', 'NE', 'NW'],
  maxWindMs: null,
  fetchedAt: null,
  ...patch,
});

function setup(sites: ForecastSiteRecord[], failModel?: string) {
  const saved: { siteId: string; fetchedAt: Date; hours: ForecastHour[] }[] = [];
  const errors: unknown[] = [];
  const urls: string[] = [];
  const refresh = createForecastRefresh({
    repository: {
      listSites: () => Promise.resolve(sites),
      save: (siteId, fetchedAt, hours) => {
        saved.push({ siteId, fetchedAt, hours });
        return Promise.resolve();
      },
    },
    fetchJson: (url) => {
      urls.push(url);
      const model = new URL(url).searchParams.get('models') ?? '';
      if (model === failModel) return Promise.reject(new Error(`${model} is down`));
      return Promise.resolve(JSON.parse(readFileSync(new URL(`ush-konyr.${model}.json`, FIXTURES), 'utf8')) as unknown);
    },
    apiUrl: API,
    now: () => NOW,
    onError: (error) => errors.push(error),
  });
  return { refresh, saved, errors, urls };
}

describe('forecastUrl', () => {
  it('одна модель, 3 дня, UTC, м/с; высота — над уровнем моря (минус геоид)', () => {
    const url = new URL(forecastUrl(API, site(), 'gfs_seamless'));
    expect(url.origin + url.pathname).toBe(API);
    expect(url.searchParams.get('models')).toBe('gfs_seamless');
    expect(url.searchParams.get('forecast_days')).toBe(String(FORECAST.days));
    expect(url.searchParams.get('timezone')).toBe('GMT');
    expect(url.searchParams.get('wind_speed_unit')).toBe('ms');
    // Геоид в Алматы — около −42 м: над уровнем моря старт выше, чем над эллипсоидом.
    expect(Number(url.searchParams.get('elevation'))).toBeGreaterThan(1905);
    expect(url.searchParams.get('hourly')).toContain('boundary_layer_height');
  });

  it('высоты нет — Open-Meteo берёт свою', () => {
    expect(new URL(forecastUrl(API, site({ elevationM: null }), 'gfs_seamless')).searchParams.has('elevation')).toBe(false);
  });
});

describe('createForecastRefresh', () => {
  it('новое место: 4 запроса, 72 часа трёх моделей, запись со временем загрузки', async () => {
    const { refresh, saved, urls } = setup([site()]);
    expect(await refresh.run()).toBe(1);
    expect(urls.map((u) => new URL(u).searchParams.get('models'))).toEqual(['ecmwf_ifs', 'ecmwf_ifs025', 'gfs_seamless', 'icon_global']);
    expect(saved).toHaveLength(1);
    expect(saved[0]?.fetchedAt).toEqual(new Date(NOW));
    expect(saved[0]?.hours).toHaveLength(72);
    expect(saved[0]?.hours[0]?.models.map((m) => m.model)).toEqual(['ecmwf', 'gfs', 'icon']);
  });

  it('свежий прогноз не перезапрашивается; устаревший — да', async () => {
    const fresh = site({ fetchedAt: new Date(NOW - 60 * TIME.msPerSecond) });
    const stale = site({ id: 'site-2', fetchedAt: new Date(NOW - FORECAST.refreshIntervalS * TIME.msPerSecond) });
    const { refresh, saved } = setup([fresh, stale]);
    expect(await refresh.run()).toBe(1);
    expect(saved.map((s) => s.siteId)).toEqual(['site-2']);
  });

  it('модель не ответила — место не записывается, ошибка наружу, следующее место обновляется', async () => {
    const { refresh, saved, errors } = setup([site(), site({ id: 'site-2' })], 'icon_global');
    expect(await refresh.run()).toBe(0);
    expect(saved).toEqual([]);
    expect(errors).toHaveLength(2);
  });
});
