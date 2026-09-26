import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, type DatabaseConnection } from '../client.js';
import { flights, sites, users } from '../schema.js';
import { insertFlight, markFlightReady } from './flights.js';
import { seasonStats } from './stats.js';

const databaseUrl = process.env.DATABASE_URL;
const RUN = Date.now().toString(36);

// Интеграционный: нужен поднятый docker compose и применённые миграции.
describe.runIf(Boolean(databaseUrl))('статистика сезона на живой БД', () => {
  let connection: DatabaseConnection;
  let pilot: string;
  let other: string;
  let siteId: string;
  const createdUsers: string[] = [];
  const createdFlights: string[] = [];

  const user = async (name: string): Promise<string> => {
    const [row] = await connection.db
      .insert(users)
      .values({ email: `${name}-${RUN}@example.com`, username: `${name}-${RUN}` })
      .returning({ id: users.id });
    if (!row) throw new Error('user insert returned no row');
    createdUsers.push(row.id);
    return row.id;
  };

  /** Полёт у тестового места; startedAt — UTC, таймзона Алматы (UTC+5 с 2024). */
  const flight = async (userId: string, startedAt: Date, v: { airtimeS: number | null; distanceM: number; gainM: number; maxAltM: number }) => {
    const row = await insertFlight(connection.db, { userId, sourceFormat: 'igc', rawObjectKey: `raw/test/${RUN}-${createdFlights.length}.igc.gz` });
    createdFlights.push(row.id);
    await markFlightReady(connection.db, row.id, {
      trackObjectKey: `tracks/${row.id}.track`,
      publicTrackObjectKey: null,
      altitudeSource: 'baro',
      analysisLevel: 'basic',
      startedAt,
      endedAt: new Date(startedAt.getTime() + 3_600_000),
      durationS: 3600,
      analysis: null,
      maxAltM: v.maxAltM,
      distanceTrackM: v.distanceM,
      simplified: null,
      takeoff: { lat: -70.5, lon: -80.5, altM: 1000 },
      landing: { lat: -70.6, lon: -80.5, altM: 500 },
      gliderRaw: null,
      timezone: 'Asia/Almaty',
      airtimeS: v.airtimeS ?? 0,
      totalGainM: v.gainM,
      xc: null,
    });
    // Полёт до задачи 2.12 — без airtime_s: статистика берёт всю запись.
    if (v.airtimeS === null) await connection.db.update(flights).set({ airtimeS: null }).where(eq(flights.id, row.id));
    return row.id;
  };

  beforeAll(async () => {
    connection = createDatabase(databaseUrl ?? '');
    pilot = await user('stats');
    other = await user('stats-other');
    const [site] = await connection.db
      .insert(sites)
      .values({
        slug: `stats-${RUN}`,
        name: `Stats site ${RUN}`,
        location: 'SRID=4326;POINT(-80.5 -70.5)',
        timezone: 'Asia/Almaty',
        source: 'user',
      })
      .returning({ id: sites.id });
    siteId = site?.id ?? '';

    await flight(pilot, new Date(Date.UTC(2004, 4, 10, 8)), { airtimeS: 5400, distanceM: 40_000, gainM: 1500, maxAltM: 3200 });
    await flight(pilot, new Date(Date.UTC(2004, 4, 20, 8)), { airtimeS: 1800, distanceM: 10_000, gainM: 300, maxAltM: 2500 });
    // 31 июля, 21:00 UTC = 1 августа по Алматы: месяц — местный.
    await flight(pilot, new Date(Date.UTC(2004, 6, 31, 21)), { airtimeS: null, distanceM: 5_000, gainM: 100, maxAltM: 2000 });
    await flight(pilot, new Date(Date.UTC(2003, 5, 1, 8)), { airtimeS: 600, distanceM: 1_000, gainM: 50, maxAltM: 1500 });
    await flight(other, new Date(Date.UTC(2004, 4, 11, 8)), { airtimeS: 9999, distanceM: 99_999, gainM: 9999, maxAltM: 9999 });
    // Место к полётам — как сделала бы автопривязка.
    await connection.db.update(flights).set({ takeoffSiteId: siteId }).where(inArray(flights.id, createdFlights));
  });
  afterAll(async () => {
    if (createdFlights.length > 0) await connection.db.delete(flights).where(inArray(flights.id, createdFlights));
    await connection.db.delete(sites).where(eq(sites.id, siteId));
    if (createdUsers.length > 0) await connection.db.delete(users).where(inArray(users.id, createdUsers));
    await connection.close();
  });

  it('по умолчанию — последний год с полётами; годы — новые первыми', async () => {
    const stats = await seasonStats(connection.db, pilot);
    expect(stats.year).toBe(2004);
    expect(stats.years).toEqual([2004, 2003]);
  });

  it('итоги года — только свои полёты; без airtime — вся запись', async () => {
    const stats = await seasonStats(connection.db, pilot, 2004);
    expect(stats.totals).toEqual({
      flights: 3,
      airtimeS: 5400 + 1800 + 3600,
      distanceM: 55_000,
      gainM: 1900,
      maxAltM: 3200,
      longestAirtimeS: 5400,
      longestDistanceM: 40_000,
    });
  });

  it('месяцы — все 12, по местной дате: полёт 31.07 21:00 UTC — в августе', async () => {
    const { byMonth } = await seasonStats(connection.db, pilot, 2004);
    expect(byMonth).toHaveLength(12);
    expect(byMonth[4]).toEqual({ month: 5, flights: 2, airtimeS: 7200, distanceM: 50_000 });
    expect(byMonth[6]?.flights).toBe(0);
    expect(byMonth[7]).toEqual({ month: 8, flights: 1, airtimeS: 3600, distanceM: 5_000 });
  });

  it('топ мест — с числом полётов и временем', async () => {
    const { topSites } = await seasonStats(connection.db, pilot, 2004);
    expect(topSites).toEqual([
      { id: siteId, name: `Stats site ${RUN}`, countryCode: null, source: 'user', flights: 3, airtimeS: 10_800 },
    ]);
  });

  it('год без полётов и пилот без полётов — нули, а не ошибка', async () => {
    const empty = await seasonStats(connection.db, pilot, 1999);
    expect(empty.totals.flights).toBe(0);
    expect(empty.byMonth.every((m) => m.flights === 0)).toBe(true);
    const nobody = await seasonStats(connection.db, await user('stats-empty'));
    expect(nobody).toMatchObject({ year: null, years: [], topSites: [] });
  });
});
