import type { ForecastHour } from '@skyline/core';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, type DatabaseConnection } from '../client.js';
import { sites } from '../schema.js';
import { listForecastSites, listSiteForecasts, saveSiteForecast } from './forecast.js';

const databaseUrl = process.env.DATABASE_URL;
const RUN = Date.now().toString(36);

const hour = (timeMs: number): ForecastHour => ({
  timeMs,
  verdict: 'flyable',
  confidence: 'high',
  reasons: [],
  models: [],
  ceilingRangeM: null,
  surface: { heightM: 1900, temperatureC: 15, speedMs: 2, dirDeg: 0 },
  profile: [],
  wind: [],
  windModel: 'ecmwf',
  cloudCoverPct: 10,
  precipitationMm: 0,
});

// Интеграционный: нужен поднятый docker compose и применённые миграции.
describe.runIf(Boolean(databaseUrl))('прогноз по местам (задача П.2) на живой БД', () => {
  let connection: DatabaseConnection;
  let siteId: string;

  beforeAll(async () => {
    connection = createDatabase(databaseUrl ?? '');
    const [row] = await connection.db
      .insert(sites)
      .values({
        slug: `forecast-test-${RUN}`,
        name: `Тест прогноза ${RUN}`,
        countryCode: 'kz',
        location: 'SRID=4326;POINT(76.5 43.1)',
        elevationM: 1900,
        timezone: 'Asia/Almaty',
        source: 'user',
        // Лишний румб в колонке не должен попасть в выдачу.
        windSectors: ['N', 'NW', 'XX' as 'N'],
        forecast: true,
      })
      .returning({ id: sites.id });
    if (!row) throw new Error('site insert returned no row');
    siteId = row.id;
  });
  afterAll(async () => {
    await connection.db.delete(sites).where(eq(sites.id, siteId));
    await connection.close();
  });

  it('Уш-Коныр в прогнозе после миграции: сектор С/СВ/СЗ', async () => {
    const all = await listForecastSites(connection.db);
    const ush = all.find((s) => s.slug === 'ush-konyr');
    expect(ush).toMatchObject({ windSectors: ['N', 'NE', 'NW'], maxWindMs: null, timezone: 'Asia/Almaty' });
    expect(ush?.lat).toBeCloseTo(43.1269, 4);
  });

  it('без загрузки — fetchedAt null и нет в выдаче /map; после — есть, повторная запись заменяет', async () => {
    const before = (await listForecastSites(connection.db)).find((s) => s.id === siteId);
    expect(before).toMatchObject({ fetchedAt: null, windSectors: ['N', 'NW'] });
    expect((await listSiteForecasts(connection.db)).some((s) => s.id === siteId)).toBe(false);

    await saveSiteForecast(connection.db, siteId, new Date(Date.UTC(2026, 8, 29, 6)), [hour(1)]);
    await saveSiteForecast(connection.db, siteId, new Date(Date.UTC(2026, 8, 29, 12)), [hour(2), hour(3)]);
    const saved = (await listSiteForecasts(connection.db)).find((s) => s.id === siteId);
    expect(saved?.fetchedAt).toEqual(new Date(Date.UTC(2026, 8, 29, 12)));
    expect(saved?.hours.map((h) => h.timeMs)).toEqual([2, 3]);
  });
});
