import { SITE } from '@skyline/core';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, type DatabaseConnection } from '../client.js';
import { flights, sites, users } from '../schema.js';
import { insertFlight, markFlightReady } from './flights.js';
import { createUserSite, listLogbookSites } from './sites.js';

const databaseUrl = process.env.DATABASE_URL;
const RUN = Date.now().toString(36);
/** Где-то в Южном океане: там нет ни одного места из сида. */
const BASE = { lat: -60 - (Date.now() % 1000) / 10_000, lon: -100 };
const METRES_PER_DEGREE_LAT = 111_320;
const north = (metres: number) => ({ lat: BASE.lat + metres / METRES_PER_DEGREE_LAT, lon: BASE.lon });

// Интеграционный: нужен поднятый docker compose и применённые миграции.
describe.runIf(Boolean(databaseUrl))('места старта на живой БД', () => {
  let connection: DatabaseConnection;
  let pilot: string;
  let other: string;
  const createdUsers: string[] = [];
  const createdFlights: string[] = [];
  const createdSites: string[] = [];

  const user = async (name: string): Promise<string> => {
    const [row] = await connection.db
      .insert(users)
      .values({ email: `${name}-${RUN}@example.com`, username: `${name}-${RUN}` })
      .returning({ id: users.id });
    if (!row) throw new Error('user insert returned no row');
    createdUsers.push(row.id);
    return row.id;
  };

  /** Готовый полёт со взлётом в точке at. */
  const flightFrom = async (userId: string, at: { lat: number; lon: number }): Promise<string> => {
    const flight = await insertFlight(connection.db, {
      userId,
      sourceFormat: 'igc',
      rawObjectKey: `raw/test/${RUN}-${createdFlights.length}.igc.gz`,
    });
    createdFlights.push(flight.id);
    await markFlightReady(connection.db, flight.id, {
      trackObjectKey: `tracks/${flight.id}.track`,
      publicTrackObjectKey: null,
      previewObjectKey: null,
      altitudeSource: 'baro',
      analysisLevel: 'basic',
      startedAt: new Date(Date.UTC(2003, 0, 1)),
      endedAt: new Date(Date.UTC(2003, 0, 1, 1)),
      durationS: 3600,
      analysis: null,
      maxAltM: 2000,
      distanceTrackM: 1000,
      simplified: null,
      takeoff: { ...at, altM: 1948.4 },
      landing: { lat: at.lat + 0.1, lon: at.lon, altM: 800 },
      gliderRaw: null,
      timezone: 'Antarctica/Palmer',
      airtimeS: 3000,
      totalGainM: 1234.4,
      xc: null,
    });
    return flight.id;
  };

  const siteOf = async (flightId: string) => {
    const [row] = await connection.db
      .select({ takeoff: flights.takeoffSiteId, landing: flights.landingSiteId })
      .from(flights)
      .where(eq(flights.id, flightId));
    return row;
  };

  beforeAll(async () => {
    connection = createDatabase(databaseUrl ?? '');
    pilot = await user('sites');
    other = await user('sites-other');
  });
  afterAll(async () => {
    if (createdFlights.length > 0) await connection.db.delete(flights).where(inArray(flights.id, createdFlights));
    if (createdSites.length > 0) await connection.db.delete(sites).where(inArray(sites.id, createdSites));
    if (createdUsers.length > 0) await connection.db.delete(users).where(inArray(users.id, createdUsers));
    await connection.close();
  });

  it('место, созданное пилотом, — в точке взлёта; соседние полёты без места к нему привязываются', async () => {
    const mine = await flightFrom(pilot, BASE);
    const nearby = await flightFrom(other, north(SITE.matchRadiusM - 200));
    const far = await flightFrom(other, north(SITE.matchRadiusM + 500));
    expect((await siteOf(mine))?.takeoff).toBeNull();

    const result = await createUserSite(connection.db, {
      flightId: mine,
      userId: pilot,
      name: 'Тестовый склон',
      timezoneAt: () => 'Antarctica/Palmer',
    });
    if (result.kind !== 'created') throw new Error(`expected created, got ${result.kind}`);
    createdSites.push(result.site.id);
    expect(result.site).toMatchObject({ name: 'Тестовый склон', countryCode: null, source: 'user' });

    const [row] = await connection.db.select().from(sites).where(eq(sites.id, result.site.id));
    expect(row).toMatchObject({ slug: 'testovyy-sklon', timezone: 'Antarctica/Palmer', elevationM: 1948, createdBy: pilot });
    expect((await siteOf(mine))?.takeoff).toBe(result.site.id);
    expect((await siteOf(nearby))?.takeoff).toBe(result.site.id);
    expect((await siteOf(far))?.takeoff).toBeNull();
    // Посадка в 11 км — не тот же склон.
    expect((await siteOf(mine))?.landing).toBeNull();
  });

  it('новый полёт рядом с известным местом получает его при обработке', async () => {
    const [site] = await connection.db.select({ id: sites.id }).from(sites).where(eq(sites.name, 'Тестовый склон'));
    const later = await flightFrom(pilot, north(300));
    expect((await siteOf(later))?.takeoff).toBe(site?.id);
  });

  it('второе место с тем же именем получает свободный slug; чужой полёт и полёт с местом — отказ', async () => {
    const elsewhere = await flightFrom(pilot, { lat: BASE.lat - 1, lon: BASE.lon });
    const twin = await createUserSite(connection.db, {
      flightId: elsewhere,
      userId: pilot,
      name: 'Тестовый склон',
      timezoneAt: () => 'Antarctica/Palmer',
    });
    if (twin.kind !== 'created') throw new Error(`expected created, got ${twin.kind}`);
    createdSites.push(twin.site.id);
    const [row] = await connection.db.select({ slug: sites.slug }).from(sites).where(eq(sites.id, twin.site.id));
    expect(row?.slug).toMatch(/^testovyy-sklon-\d+$/);

    const foreign = await flightFrom(other, { lat: BASE.lat - 2, lon: BASE.lon });
    const args = { name: 'Чужое', timezoneAt: () => 'UTC' };
    expect((await createUserSite(connection.db, { ...args, flightId: foreign, userId: pilot })).kind).toBe('not_found');
    expect((await createUserSite(connection.db, { ...args, flightId: elsewhere, userId: pilot })).kind).toBe('has_site');
  });

  it('места для фильтра логбука — только свои полёты, с числом полётов', async () => {
    const list = await listLogbookSites(connection.db, pilot);
    const ours = list.filter((s) => s.name === 'Тестовый склон');
    expect(ours.map((s) => s.flightCount).sort()).toEqual([1, 2]);
    expect((await listLogbookSites(connection.db, other)).find((s) => s.name === 'Тестовый склон')?.flightCount).toBe(1);
  });
});
