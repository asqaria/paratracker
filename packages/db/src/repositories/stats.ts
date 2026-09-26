import { MONTHS_IN_YEAR, TOP_SITES_LIMIT } from '@skyline/core';
import { and, count, desc, eq, max, sql } from 'drizzle-orm';

import type { Database } from '../client.js';
import { flights, sites } from '../schema.js';
import { SITE_COLUMNS, type SiteRecord } from './sites.js';

/**
 * Статистика сезона (задача 2.12). Год — по местной дате полёта (2.14).
 * Время — в воздухе (airtime_s), у старых полётов без него — вся запись.
 */

export interface SeasonTotals {
  flights: number;
  airtimeS: number;
  distanceM: number;
  gainM: number;
  maxAltM: number | null;
  longestAirtimeS: number | null;
  longestDistanceM: number | null;
}

export interface SeasonStats {
  year: number | null;
  years: number[];
  totals: SeasonTotals;
  byMonth: { month: number; flights: number; airtimeS: number; distanceM: number }[];
  topSites: (SiteRecord & { flights: number; airtimeS: number })[];
}

const airtime = sql`coalesce(${flights.airtimeS}, ${flights.durationS}, 0)`;
/** Суммы по bigint → число: Postgres отдаёт sum() строкой. */
const total = (expr: ReturnType<typeof sql>) => sql<number>`coalesce(sum(${expr}), 0)`.mapWith(Number);
const yearOf = sql<number>`extract(year from ${flights.localDate})::int`;

const EMPTY_TOTALS: SeasonTotals = {
  flights: 0,
  airtimeS: 0,
  distanceM: 0,
  gainM: 0,
  maxAltM: null,
  longestAirtimeS: null,
  longestDistanceM: null,
};

export async function seasonStats(db: Database, userId: string, requestedYear?: number): Promise<SeasonStats> {
  const mine = and(eq(flights.userId, userId), eq(flights.status, 'ready'), sql`${flights.localDate} IS NOT NULL`);

  const yearRows = await db.selectDistinct({ year: yearOf }).from(flights).where(mine).orderBy(desc(yearOf));
  const years = yearRows.map((row) => row.year);
  const year = requestedYear ?? years[0] ?? null;
  const emptyMonths = Array.from({ length: MONTHS_IN_YEAR }, (_, i) => ({ month: i + 1, flights: 0, airtimeS: 0, distanceM: 0 }));
  if (year === null) return { year, years, totals: EMPTY_TOTALS, byMonth: emptyMonths, topSites: [] };

  const inYear = and(mine, sql`${yearOf} = ${year}`);

  const [totals] = await db
    .select({
      flights: count(),
      airtimeS: total(airtime),
      distanceM: total(sql`${flights.distanceTrackM}`),
      gainM: total(sql`${flights.totalGainM}`),
      maxAltM: max(flights.maxAltM),
      longestAirtimeS: sql<number | null>`max(${airtime})`.mapWith((v: unknown) => (v === null ? null : Number(v))),
      longestDistanceM: max(flights.distanceTrackM),
    })
    .from(flights)
    .where(inYear);

  const monthOf = sql<number>`extract(month from ${flights.localDate})::int`;
  const months = await db
    .select({ month: monthOf, flights: count(), airtimeS: total(airtime), distanceM: total(sql`${flights.distanceTrackM}`) })
    .from(flights)
    .where(inYear)
    .groupBy(monthOf);
  const byMonth = emptyMonths.map((empty) => months.find((m) => m.month === empty.month) ?? empty);

  const topSites = await db
    .select({ ...SITE_COLUMNS, flights: count(), airtimeS: total(airtime) })
    .from(flights)
    .innerJoin(sites, eq(sites.id, flights.takeoffSiteId))
    .where(inYear)
    .groupBy(sites.id)
    .orderBy(desc(count()), sites.name)
    .limit(TOP_SITES_LIMIT);

  return {
    year,
    years,
    totals: totals && totals.flights > 0 ? totals : EMPTY_TOTALS,
    byMonth,
    topSites,
  };
}
