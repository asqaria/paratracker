import type { FlightStatus } from '@skyline/core';
import { and, desc, eq, gte, isNull, lt, or, sql } from 'drizzle-orm';

import type { Database } from '../client.js';
import { flights, sites } from '../schema.js';
import { SITE_COLUMNS, type SiteRecord } from './sites.js';

/**
 * Логбук пилота (задача 2.11): список своих полётов, карта, перенос анонимных
 * загрузок. Порядок — по старту полёта, а у ещё не обработанных — по времени
 * загрузки: только что брошенный трек виден сверху сразу.
 */

export interface LogbookEntryRecord {
  id: string;
  status: FlightStatus;
  startedAt: Date | null;
  uploadedAt: Date;
  durationS: number | null;
  distanceTrackM: number | null;
  maxAltM: number | null;
  thermalCount: number | null;
  takeoffSite: SiteRecord | null;
}

/** Позиция в списке: ключ сортировки и id для равных ключей. */
export interface LogbookCursor {
  sortKey: Date;
  id: string;
}

export interface LogbookPage {
  items: LogbookEntryRecord[];
  next: LogbookCursor | null;
}

export interface LogbookMapFeature {
  id: string;
  startedAt: Date | null;
  /** [долгота, широта] — порядок GeoJSON. */
  coordinates: [number, number][];
}

/** Ключ сортировки: старт полёта, до обработки — загрузка. */
const sortKey = sql<Date>`coalesce(${flights.startedAt}, ${flights.createdAt})`;

/** Знаков после запятой в GeoJSON карты: 1e-6° ≈ 0.1 м — точнее упрощённой линии. */
const MAP_COORDINATE_DECIMALS = 6;
/**
 * Потолок полётов на карте. Строка — до SIMPLIFY.maxPoints точек; 500 полётов —
 * несколько сезонов активного пилота и несколько мегабайт ответа.
 */
const MAP_MAX_FLIGHTS = 500;

export async function listLogbook(
  db: Database,
  query: { userId: string; limit: number; from?: string; to?: string; siteId?: string; after?: LogbookCursor },
): Promise<LogbookPage> {
  const conditions = [eq(flights.userId, query.userId)];
  // Дата старта в UTC; локальная дата места — с задачей 2.14.
  if (query.from) conditions.push(gte(flights.startedAt, sql`${query.from}::date`));
  if (query.to) conditions.push(lt(flights.startedAt, sql`${query.to}::date + 1`));
  if (query.siteId) conditions.push(eq(flights.takeoffSiteId, query.siteId));
  if (query.after) {
    conditions.push(sql`(${sortKey}, ${flights.id}) < (${query.after.sortKey.toISOString()}::timestamptz, ${query.after.id}::uuid)`);
  }

  const rows = await db
    .select({
      id: flights.id,
      status: flights.status,
      startedAt: flights.startedAt,
      uploadedAt: flights.createdAt,
      durationS: flights.durationS,
      distanceTrackM: flights.distanceTrackM,
      maxAltM: flights.maxAltM,
      thermalCount: flights.thermalCount,
      takeoffSite: SITE_COLUMNS,
      sortKey,
    })
    .from(flights)
    .leftJoin(sites, eq(sites.id, flights.takeoffSiteId))
    .where(and(...conditions))
    .orderBy(desc(sortKey), desc(flights.id))
    // На одну строку больше: так видно, есть ли следующая страница.
    .limit(query.limit + 1);

  const page = rows.slice(0, query.limit);
  const last = page[page.length - 1];
  return {
    items: page.map((row) => ({
      id: row.id,
      status: row.status,
      startedAt: row.startedAt,
      uploadedAt: row.uploadedAt,
      durationS: row.durationS,
      distanceTrackM: row.distanceTrackM,
      maxAltM: row.maxAltM,
      thermalCount: row.thermalCount,
      takeoffSite: row.takeoffSite,
    })),
    next: rows.length > query.limit && last ? { sortKey: new Date(last.sortKey), id: last.id } : null,
  };
}

export async function listLogbookMap(db: Database, userId: string): Promise<LogbookMapFeature[]> {
  const rows = await db
    .select({
      id: flights.id,
      startedAt: flights.startedAt,
      // Z и M карте не нужны: без них ответ втрое легче.
      geojson: sql<string>`ST_AsGeoJSON(ST_Force2D(${flights.trackSimplified}::geometry), ${MAP_COORDINATE_DECIMALS})`,
    })
    .from(flights)
    .where(and(eq(flights.userId, userId), eq(flights.status, 'ready'), sql`${flights.trackSimplified} IS NOT NULL`))
    .orderBy(desc(flights.startedAt))
    .limit(MAP_MAX_FLIGHTS);

  return rows.map((row) => ({
    id: row.id,
    startedAt: row.startedAt,
    coordinates: (JSON.parse(row.geojson) as { coordinates: [number, number][] }).coordinates,
  }));
}

/**
 * Забрать анонимные полёты в логбук по токенам загрузки. Условие — полёт ещё
 * ничей и хэш совпал; хэш стирается, второй раз токен не сработает.
 */
export async function claimFlights(
  db: Database,
  userId: string,
  claims: readonly { flightId: string; tokenHash: string }[],
): Promise<string[]> {
  if (claims.length === 0) return [];
  const rows = await db
    .update(flights)
    .set({ userId, claimTokenHash: null, updatedAt: new Date() })
    .where(
      and(
        isNull(flights.userId),
        or(...claims.map((c) => and(eq(flights.id, c.flightId), eq(flights.claimTokenHash, c.tokenHash)))),
      ),
    )
    .returning({ id: flights.id });
  return rows.map((row) => row.id);
}
