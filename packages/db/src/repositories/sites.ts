import { SITE, siteSlug, type SiteSource, type FlightPoint } from '@skyline/core';
import { and, count, desc, eq, isNull, like, or, sql, type SQL } from 'drizzle-orm';

import type { Database } from '../client.js';
import { flights, sites } from '../schema.js';

/**
 * Места старта и посадки (ТЗ §6.8, задача 2.13). Поиск — ST_DWithin по
 * geography: расстояния на сфере, а не в градусах.
 */

export interface SiteRecord {
  id: string;
  name: string;
  countryCode: string | null;
  source: SiteSource;
}

/** Колонки места для выборок: и отдельно, и через join к полёту. */
export const SITE_COLUMNS = {
  id: sites.id,
  name: sites.name,
  countryCode: sites.countryCode,
  source: sites.source,
} as const;

const ewktPoint = (lat: number, lon: number): string => `SRID=4326;POINT(${lon} ${lat})`;

/**
 * Подзапрос: ближайшее место в SITE.matchRadiusM от точки или NULL.
 * Для значения колонки в UPDATE полёта; точки нет — null.
 */
export function nearestSiteId(point: FlightPoint): SQL | null {
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lon)) return null;
  const at = sql`${ewktPoint(point.lat, point.lon)}::geography`;
  return sql`(
    select ${sites.id} from ${sites}
    where ST_DWithin(${sites.location}, ${at}, ${SITE.matchRadiusM})
    order by ST_Distance(${sites.location}, ${at})
    limit 1
  )`;
}

export type CreateSiteResult =
  | { kind: 'created'; site: SiteRecord }
  /** Полёта нет или он чужой. */
  | { kind: 'not_found' }
  /** У полёта уже есть место старта. */
  | { kind: 'has_site' }
  /** Полёт не обработан — точки взлёта ещё нет. */
  | { kind: 'no_takeoff' };

/** Свободный slug: base, иначе base-2, base-3, … */
async function freeSlug(db: Database, base: string): Promise<string> {
  const taken = await db
    .select({ slug: sites.slug })
    .from(sites)
    .where(or(eq(sites.slug, base), like(sites.slug, `${base}-%`)));
  const slugs = new Set(taken.map((row) => row.slug));
  if (!slugs.has(base)) return base;
  for (let n = 2; ; n++) if (!slugs.has(`${base}-${n}`)) return `${base}-${n}`;
}

/**
 * Пилот добавляет место старта своего полёта: точка — его взлёт. Сразу
 * привязывает к месту все полёты без места, взлетевшие в радиусе, — одно
 * добавленное место находит и полёты других пилотов.
 */
export async function createUserSite(
  db: Database,
  args: { flightId: string; userId: string; name: string; timezoneAt: (lat: number, lon: number) => string },
): Promise<CreateSiteResult> {
  const [flight] = await db
    .select({
      siteId: flights.takeoffSiteId,
      lat: sql<number | null>`ST_Y(${flights.takeoffPoint}::geometry)`,
      lon: sql<number | null>`ST_X(${flights.takeoffPoint}::geometry)`,
      altM: flights.takeoffAltM,
    })
    .from(flights)
    .where(and(eq(flights.id, args.flightId), eq(flights.userId, args.userId)));
  if (!flight) return { kind: 'not_found' };
  if (flight.siteId !== null) return { kind: 'has_site' };
  if (flight.lat === null || flight.lon === null) return { kind: 'no_takeoff' };
  const { lat, lon } = flight;

  const slug = await freeSlug(db, siteSlug(args.name));
  const site = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(sites)
      .values({
        slug,
        name: args.name,
        location: ewktPoint(lat, lon),
        elevationM: flight.altM,
        timezone: args.timezoneAt(lat, lon),
        type: 'takeoff',
        source: 'user',
        createdBy: args.userId,
      })
      .returning(SITE_COLUMNS);
    if (!created) throw new Error('site insert returned no row');
    await attachNearbyFlights(tx, created.id);
    return created;
  });
  return { kind: 'created', site };
}

/** Полёты без места, взлетевшие (севшие) в радиусе места, получают его. */
export async function attachNearbyFlights(db: Pick<Database, 'update'>, siteId: string): Promise<void> {
  const location = sql`(select ${sites.location} from ${sites} where ${sites.id} = ${siteId})`;
  await db
    .update(flights)
    .set({ takeoffSiteId: siteId })
    .where(and(isNull(flights.takeoffSiteId), sql`ST_DWithin(${flights.takeoffPoint}, ${location}, ${SITE.matchRadiusM})`));
  await db
    .update(flights)
    .set({ landingSiteId: siteId })
    .where(and(isNull(flights.landingSiteId), sql`ST_DWithin(${flights.landingPoint}, ${location}, ${SITE.matchRadiusM})`));
}

/** Места, откуда летал пилот, с числом полётов: фильтр логбука (и «топ мест» в 2.12). */
export async function listLogbookSites(
  db: Database,
  userId: string,
): Promise<(SiteRecord & { flightCount: number })[]> {
  return db
    .select({ ...SITE_COLUMNS, flightCount: count(flights.id) })
    .from(flights)
    .innerJoin(sites, eq(sites.id, flights.takeoffSiteId))
    .where(eq(flights.userId, userId))
    .groupBy(sites.id)
    .orderBy(desc(count(flights.id)), sites.name);
}
