import type { FlightAnalysis, Glide, ThermalSegment } from '@skyline/core';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, type DatabaseConnection } from '../client.js';
import { flights, glides, thermals } from '../schema.js';
import { findFlightDetails, listGlides, listThermals } from './analysis.js';
import { deleteFlights, markFlightReady, type ProcessedFlight } from './flights.js';

const databaseUrl = process.env.DATABASE_URL;
const T0 = Date.UTC(2026, 6, 15, 10);

const thermal = (seq: number, drift: boolean): ThermalSegment => ({
  startIndex: seq * 100,
  endIndex: seq * 100 + 90,
  startTimeMs: T0 + seq * 100_000,
  endTimeMs: T0 + seq * 100_000 + 90_000,
  durationS: 90,
  entryAltM: 1500.4,
  exitAltM: 1680.6,
  gainM: 180.2,
  avgClimbMs: 2.0022,
  maxClimbMs: 3.456,
  turnCount: 4.26,
  circleCount: 4,
  avgRadiusM: 41.7,
  direction: 'ccw',
  driftEastMs: drift ? -1.4 : null,
  driftNorthMs: drift ? -0.5 : null,
  efficiency: 0.579,
  strength: 'medium',
  entryLat: 43.2,
  entryLon: 76.9,
  exitLat: 43.201,
  exitLon: 76.898,
  // Снос на запад-юго-запад — ветер с востока-северо-востока.
  drift: drift ? { eastMs: -1.4, northMs: -0.5, speedMs: Math.hypot(1.4, 0.5), dirDeg: 70.35 } : null,
});

const glide = (seq: number, dynamic: boolean): Glide => ({
  startIndex: seq * 100 + 90,
  endIndex: seq * 100 + 200,
  startTimeMs: T0 + seq * 100_000 + 90_000,
  endTimeMs: T0 + seq * 100_000 + 200_000,
  durationS: 110,
  distanceM: 1234.5,
  altLossM: dynamic ? 12.4 : 150.6,
  glideRatio: dynamic ? null : 8.197,
  kind: dynamic ? 'dynamic' : 'glide',
  avgGroundSpeedMs: 11.22,
  avgVzMs: dynamic ? -0.11 : -1.37,
  headingDeg: dynamic ? Number.NaN : 264.6,
  headingConsistency: 0.874,
});

const analysis = (thermalCount: number): FlightAnalysis => ({
  thermals: Array.from({ length: thermalCount }, (_, k) => thermal(k, k > 0)),
  glides: [glide(0, false), glide(1, true)],
  avgClimbMs: 2.0022,
  avgGlideRatio: 8.197,
  wind: { eastMs: -2.5, northMs: -2.6, speedMs: 3.607, dirDeg: 43.87 },
  windProfile: [{ altitudeBand: [1500, 1750], windSpeedMs: 5.1, windDirDeg: 55, confidence: 0.4, circleCount: 12 }],
});

const processed = (result: FlightAnalysis | null): ProcessedFlight => ({
  trackObjectKey: 'tracks/test.track',
  altitudeSource: 'baro',
  analysisLevel: result ? 'full' : 'basic',
  startedAt: new Date(T0),
  endedAt: new Date(T0 + 3_600_000),
  durationS: 3600,
  analysis: result,
  maxAltM: 2000,
  distanceTrackM: 30_000,
  simplified: null,
  takeoff: { lat: 43.2, lon: 76.9, altM: 1500 },
  landing: { lat: 43.25, lon: 76.95, altM: 800 },
  gliderRaw: 'Ozone Rush 6',
});

// Интеграционный: нужен поднятый docker compose и применённые миграции.
describe.runIf(Boolean(databaseUrl))('markFlightReady пишет анализ полёта (задача 2.5)', () => {
  let connection: DatabaseConnection;
  let flightId: string;

  beforeAll(async () => {
    connection = createDatabase(databaseUrl ?? '');
    const [row] = await connection.db
      .insert(flights)
      .values({ sourceFormat: 'igc', rawObjectKey: `raw/test/analysis-${Date.now()}.igc.gz` })
      .returning({ id: flights.id });
    if (!row) throw new Error('insert returned no row');
    flightId = row.id;
  });

  afterAll(async () => {
    await deleteFlights(connection.db, [flightId]);
    await connection.close();
  });

  const thermalRows = () => connection.db.select().from(thermals).where(eq(thermals.flightId, flightId)).orderBy(thermals.seq);
  const glideRows = () => connection.db.select().from(glides).where(eq(glides.flightId, flightId)).orderBy(glides.seq);

  it('термики, глайды и агрегаты — в одной записи; единицы СИ, числа округлены по колонкам', async () => {
    await markFlightReady(connection.db, flightId, processed(analysis(2)));

    const [flight] = await connection.db.select().from(flights).where(eq(flights.id, flightId));
    expect(flight).toMatchObject({
      status: 'ready',
      thermalCount: 2,
      avgClimbMs: 2,
      avgGlideRatio: 8.2,
      windDirDeg: 44,
      windSpeedMs: 3.61,
    });
    expect(flight?.windProfile).toEqual(analysis(2).windProfile);

    const rows = await thermalRows();
    expect(rows.map((r) => r.seq)).toEqual([0, 1]);
    expect(rows[0]).toMatchObject({ entryAltM: 1500, exitAltM: 1681, gainM: 180, avgClimbMs: 2, turnCount: 4.3, direction: 'ccw' });
    // Один круг — сноса нет; иначе — метеорологическое «откуда».
    expect(rows[0]?.driftDirDeg).toBeNull();
    expect(rows[1]).toMatchObject({ driftDirDeg: 70, driftSpeedMs: 1.49 });

    const {
      rows: [point],
    } = await connection.db.execute<{ wkt: string }>(
      sql`SELECT ST_AsText(entry_point) AS wkt FROM thermals WHERE flight_id = ${flightId} AND seq = 0`,
    );
    expect(point?.wkt).toBe('POINT(76.9 43.2)');

    const glideList = await glideRows();
    expect(glideList).toHaveLength(2);
    expect(glideList[0]).toMatchObject({ kind: 'glide', glideRatio: 8.2, distanceM: 1235, altLossM: 151, headingDeg: 265 });
    // dynamic — без качества; курс NaN (вернулся в точку) — null, а не 'NaN' в numeric.
    expect(glideList[1]).toMatchObject({ kind: 'dynamic', glideRatio: null, headingDeg: null });
  });

  it('направление 359.6° — это 0°, а не 360°', async () => {
    const north = analysis(2);
    north.glides = [{ ...glide(0, false), headingDeg: 359.6 }];
    await markFlightReady(connection.db, flightId, processed(north));
    expect((await glideRows())[0]?.headingDeg).toBe(0);
  });

  it('повторная обработка заменяет анализ, а не дописывает', async () => {
    await markFlightReady(connection.db, flightId, processed(analysis(1)));
    expect(await thermalRows()).toHaveLength(1);
    expect(await glideRows()).toHaveLength(2);
  });

  it('редкий трек (basic) — анализа нет: сегменты удалены, агрегаты пустые', async () => {
    await markFlightReady(connection.db, flightId, processed(null));
    expect(await thermalRows()).toEqual([]);
    expect(await glideRows()).toEqual([]);
    const [flight] = await connection.db.select().from(flights).where(eq(flights.id, flightId));
    expect(flight).toMatchObject({ thermalCount: null, avgClimbMs: null, avgGlideRatio: null, windDirDeg: null, windProfile: null });
  });

  it('удаление полёта уносит его термики и глайды (on delete cascade)', async () => {
    const [other] = await connection.db
      .insert(flights)
      .values({ sourceFormat: 'igc', rawObjectKey: `raw/test/cascade-${Date.now()}.igc.gz` })
      .returning({ id: flights.id });
    if (!other) throw new Error('insert returned no row');
    await markFlightReady(connection.db, other.id, processed(analysis(2)));
    await deleteFlights(connection.db, [other.id]);
    expect(await connection.db.select().from(thermals).where(eq(thermals.flightId, other.id))).toEqual([]);
    expect(await connection.db.select().from(glides).where(eq(glides.flightId, other.id))).toEqual([]);
  });
});

describe.runIf(Boolean(databaseUrl))('чтение анализа полёта (задача 2.6)', () => {
  let connection: DatabaseConnection;
  let flightId: string;

  beforeAll(async () => {
    connection = createDatabase(databaseUrl ?? '');
    const [row] = await connection.db
      .insert(flights)
      .values({ sourceFormat: 'igc', rawObjectKey: `raw/test/read-${Date.now()}.igc.gz` })
      .returning({ id: flights.id });
    if (!row) throw new Error('insert returned no row');
    flightId = row.id;
    await markFlightReady(connection.db, flightId, processed(analysis(2)));
  });

  afterAll(async () => {
    await deleteFlights(connection.db, [flightId]);
    await connection.close();
  });

  it('детали полёта: статус, время, агрегаты и профиль ветра', async () => {
    const details = await findFlightDetails(connection.db, flightId);
    expect(details).toMatchObject({
      id: flightId,
      status: 'ready',
      analysisLevel: 'full',
      durationS: 3600,
      thermalCount: 2,
      avgClimbMs: 2,
      avgGlideRatio: 8.2,
      windDirDeg: 44,
      windSpeedMs: 3.61,
    });
    expect(details?.startedAt?.getTime()).toBe(T0);
    expect(details?.windProfile).toEqual(analysis(2).windProfile);
    expect(await findFlightDetails(connection.db, '00000000-0000-4000-8000-000000000000')).toBeNull();
  });

  it('термики по порядку, точки входа и выхода — широта и долгота из geography', async () => {
    const list = await listThermals(connection.db, flightId);
    expect(list.map((t) => t.seq)).toEqual([0, 1]);
    expect(list[0]).toMatchObject({ entryLat: 43.2, entryLon: 76.9, exitLat: 43.201, exitLon: 76.898, gainM: 180, direction: 'ccw' });
    expect(list[0]?.startedAt.getTime()).toBe(T0);
    expect(list[1]).toMatchObject({ driftDirDeg: 70, driftSpeedMs: 1.49 });
  });

  it('глайды по порядку; у dynamic нет качества', async () => {
    const list = await listGlides(connection.db, flightId);
    expect(list.map((g) => [g.seq, g.kind, g.glideRatio])).toEqual([
      [0, 'glide', 8.2],
      [1, 'dynamic', null],
    ]);
  });
});
