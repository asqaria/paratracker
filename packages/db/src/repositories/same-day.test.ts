import { SITE } from '@skyline/core';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, type DatabaseConnection } from '../client.js';
import { flights, sites, users } from '../schema.js';
import { insertFlight, markFlightReady } from './flights.js';
import { listSameDayFlights } from './same-day.js';
import { createUserSite } from './sites.js';

const databaseUrl = process.env.DATABASE_URL;
const RUN = Date.now().toString(36);
/** Южный океан: мест из сида нет, соседних полётов других тестов — тоже. */
const BASE = { lat: -62 - (Date.now() % 1000) / 10_000, lon: -110 };
const METRES_PER_DEGREE_LAT = 111_320;
const north = (metres: number) => ({ lat: BASE.lat + metres / METRES_PER_DEGREE_LAT, lon: BASE.lon });
const DAY = Date.UTC(2004, 1, 10, 15);
const NEXT_DAY = DAY + 24 * 3600 * 1000;

// Интеграционный: нужен поднятый docker compose и применённые миграции.
describe.runIf(Boolean(databaseUrl))('полёты того же дня с того же места (задача 3.12в) на живой БД', () => {
  let connection: DatabaseConnection;
  let viewer: string;
  let other: string;
  const createdUsers: string[] = [];
  const createdFlights: string[] = [];
  const createdSites: string[] = [];

  const user = async (name: string): Promise<string> => {
    const [row] = await connection.db
      .insert(users)
      .values({ email: `${name}-${RUN}@example.com`, username: `${name}-${RUN}`, displayName: `Пилот ${name}` })
      .returning({ id: users.id });
    if (!row) throw new Error('user insert returned no row');
    createdUsers.push(row.id);
    return row.id;
  };

  const flight = async (
    userId: string | null,
    at: { lat: number; lon: number },
    startedMs: number,
    privacy: 'public' | 'unlisted' | 'private',
  ): Promise<string> => {
    const created = await insertFlight(connection.db, {
      userId,
      sourceFormat: 'igc',
      rawObjectKey: `raw/test/${RUN}-${createdFlights.length}.igc.gz`,
    });
    createdFlights.push(created.id);
    await markFlightReady(connection.db, created.id, {
      trackObjectKey: `tracks/${created.id}.track`,
      publicTrackObjectKey: null,
      previewObjectKey: null,
      altitudeSource: 'baro',
      analysisLevel: 'basic',
      startedAt: new Date(startedMs),
      endedAt: new Date(startedMs + 3600_000),
      durationS: 3600,
      analysis: null,
      maxAltM: 2000,
      distanceTrackM: 12_000,
      simplified: null,
      takeoff: { ...at, altM: 1500 },
      landing: { lat: at.lat + 0.1, lon: at.lon, altM: 800 },
      gliderRaw: null,
      timezone: 'Antarctica/Palmer',
      airtimeS: 3000,
      totalGainM: 900,
      xc: null,
    });
    await connection.db.update(flights).set({ privacy }).where(eq(flights.id, created.id));
    return created.id;
  };

  let ref: string;
  const expected: Record<string, string> = {};

  beforeAll(async () => {
    connection = createDatabase(databaseUrl ?? '');
    viewer = await user('sameday-viewer');
    other = await user('sameday-other');
    ref = await flight(null, BASE, DAY, 'unlisted');
    expected.publicNear = await flight(other, north(SITE.matchRadiusM - 500), DAY + 600_000, 'public');
    expected.ownPrivate = await flight(viewer, north(300), DAY + 1200_000, 'private');
    expected.unlistedNear = await flight(other, north(200), DAY, 'unlisted');
    expected.otherDay = await flight(other, north(100), NEXT_DAY, 'public');
    expected.farNoSite = await flight(other, north(SITE.matchRadiusM + 3000), DAY, 'public');

    // Тот же старт в базе мест, но взлёт в 5 км (длинный хребет): «то же место» по месту старта.
    const site = await createUserSite(connection.db, {
      flightId: expected.ownPrivate,
      userId: viewer,
      name: `Хребет ${RUN}`,
      timezoneAt: () => 'Antarctica/Palmer',
    });
    if (site.kind !== 'created') throw new Error(`expected created, got ${site.kind}`);
    createdSites.push(site.site.id);
    expected.sameSiteFar = await flight(other, north(5000), DAY + 1800_000, 'public');
    await connection.db
      .update(flights)
      .set({ takeoffSiteId: site.site.id })
      .where(inArray(flights.id, [ref, expected.sameSiteFar]));
  });

  afterAll(async () => {
    if (createdFlights.length > 0) await connection.db.delete(flights).where(inArray(flights.id, createdFlights));
    if (createdSites.length > 0) await connection.db.delete(sites).where(inArray(sites.id, createdSites));
    if (createdUsers.length > 0) await connection.db.delete(users).where(inArray(users.id, createdUsers));
    await connection.close();
  });

  it('посторонний: публичные того же дня рядом со стартом или с того же места; по времени', async () => {
    const list = await listSameDayFlights(connection.db, ref, null);
    expect(list.map((f) => f.flightId)).toEqual([expected.publicNear, expected.sameSiteFar]);
    expect(list[0]).toMatchObject({ pilotName: 'Пилот sameday-other', airtimeS: 3000, distanceTrackM: 12_000, own: false });
  });

  it('вошедший видит и свои полёты того дня, даже «только я»', async () => {
    const list = await listSameDayFlights(connection.db, ref, viewer);
    expect(list.map((f) => f.flightId)).toEqual([expected.publicNear, expected.ownPrivate, expected.sameSiteFar]);
    expect(list.find((f) => f.flightId === expected.ownPrivate)?.own).toBe(true);
  });

  it('сам полёт в подсказки не попадает', async () => {
    const list = await listSameDayFlights(connection.db, expected.publicNear ?? '', null);
    expect(list.map((f) => f.flightId)).not.toContain(expected.publicNear);
  });
});
