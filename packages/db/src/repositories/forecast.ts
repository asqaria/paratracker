import { COMPASS_POINTS, type CompassPoint, type ForecastHour } from '@skyline/core';
import { and, asc, eq, gte, lte, sql } from 'drizzle-orm';

import type { Database } from '../client.js';
import { forecastRuns, siteForecasts, sites } from '../schema.js';

/**
 * Прогноз по местам старта (ТЗ §6.9, задача П.2): какие места в прогнозе,
 * последняя загрузка по месту, выдача для /map.
 */

export interface ForecastSiteRecord {
  id: string;
  slug: string;
  name: string;
  lat: number;
  lon: number;
  /** Над эллипсоидом, м; null — неизвестна. */
  elevationM: number | null;
  timezone: string;
  windSectors: CompassPoint[];
  maxWindMs: number | null;
  /** Последняя загрузка прогноза; null — ещё не было. */
  fetchedAt: Date | null;
}

export interface SiteForecastRecord extends ForecastSiteRecord {
  hours: ForecastHour[];
}

/** Только известные румбы: колонка text[], лишнее в ней не должно ронять выдачу. */
const sectorsOf = (value: readonly string[] | null): CompassPoint[] =>
  (value ?? []).filter((point): point is CompassPoint => (COMPASS_POINTS as readonly string[]).includes(point));

const COLUMNS = {
  id: sites.id,
  slug: sites.slug,
  name: sites.name,
  lat: sql<number>`ST_Y(${sites.location}::geometry)`.mapWith(Number),
  lon: sql<number>`ST_X(${sites.location}::geometry)`.mapWith(Number),
  elevationM: sites.elevationM,
  timezone: sites.timezone,
  windSectors: sites.windSectors,
  maxWindMs: sites.maxWindMs,
  fetchedAt: siteForecasts.fetchedAt,
} as const;

type Row = { windSectors: string[] | null } & Omit<ForecastSiteRecord, 'windSectors'>;
const toRecord = (row: Row): ForecastSiteRecord => ({ ...row, windSectors: sectorsOf(row.windSectors) });

/** Места в прогнозе — по имени. */
export async function listForecastSites(db: Database): Promise<ForecastSiteRecord[]> {
  const rows = await db
    .select(COLUMNS)
    .from(sites)
    .leftJoin(siteForecasts, eq(siteForecasts.siteId, sites.id))
    .where(eq(sites.forecast, true))
    .orderBy(asc(sites.name));
  return rows.map(toRecord);
}

/**
 * Записать свежий прогноз места: последний — для /map (одна строка на место),
 * и в историю (задача П.8) — для сверки с полётами. Вместе, в одной транзакции.
 */
export async function saveSiteForecast(db: Database, siteId: string, fetchedAt: Date, hours: ForecastHour[]): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .insert(siteForecasts)
      .values({ siteId, fetchedAt, hours })
      .onConflictDoUpdate({ target: siteForecasts.siteId, set: { fetchedAt, hours } });
    await tx.insert(forecastRuns).values({ siteId, fetchedAt, hours });
  });
}

export interface ForecastRunRecord {
  fetchedAt: Date;
  hours: ForecastHour[];
}

/** История прогнозов места за период загрузки [from, to] — по времени загрузки. */
export async function listForecastRuns(db: Database, siteId: string, from: Date, to: Date): Promise<ForecastRunRecord[]> {
  return db
    .select({ fetchedAt: forecastRuns.fetchedAt, hours: forecastRuns.hours })
    .from(forecastRuns)
    .where(and(eq(forecastRuns.siteId, siteId), gte(forecastRuns.fetchedAt, from), lte(forecastRuns.fetchedAt, to)))
    .orderBy(asc(forecastRuns.fetchedAt));
}

/** Места в прогнозе с их прогнозом — для /map. Места без загрузки пропускаются. */
export async function listSiteForecasts(db: Database): Promise<SiteForecastRecord[]> {
  const rows = await db
    .select({ ...COLUMNS, hours: siteForecasts.hours })
    .from(sites)
    .innerJoin(siteForecasts, eq(siteForecasts.siteId, sites.id))
    .where(eq(sites.forecast, true))
    .orderBy(asc(sites.name));
  return rows.map((row) => ({ ...toRecord(row), hours: row.hours }));
}
