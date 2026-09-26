import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, type DatabaseConnection } from '../client.js';
import { flights, users } from '../schema.js';
import { insertFlight, markFlightReady, requeueFlightsForBackfill } from './flights.js';
import { claimFlights, listLogbook, listLogbookMap } from './logbook.js';

const databaseUrl = process.env.DATABASE_URL;
const RUN = Date.now().toString(36);
/** Даты — в 2002 году: локальные полёты разработчика в выборку не попадут. */
const day = (n: number, hour = 10): Date => new Date(Date.UTC(2002, 4, n, hour));

// Интеграционный: нужен поднятый docker compose и применённые миграции.
describe.runIf(Boolean(databaseUrl))('логбук на живой БД', () => {
  let connection: DatabaseConnection;
  let pilot: string;
  let other: string;
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

  /** Готовый полёт пилота со сводкой и линией. */
  const readyFlight = async (userId: string | null, startedAt: Date, options: { claimTokenHash?: string } = {}) => {
    const flight = await insertFlight(connection.db, {
      userId,
      sourceFormat: 'igc',
      rawObjectKey: `raw/test/${RUN}-${createdFlights.length}.igc.gz`,
      ...options,
    });
    createdFlights.push(flight.id);
    await markFlightReady(connection.db, flight.id, {
      trackObjectKey: `tracks/${flight.id}.track`,
      altitudeSource: 'baro',
      analysisLevel: 'full',
      startedAt,
      endedAt: new Date(startedAt.getTime() + 3_600_000),
      durationS: 3600,
      analysis: null,
      maxAltM: 2345.6,
      distanceTrackM: 42_000.4,
      simplified: {
        lat: [43.2, 43.25, 43.3],
        lon: [76.9, 76.95, 76.92],
        altM: [1500, 2300, Number.NaN],
        timeMs: [startedAt.getTime(), startedAt.getTime() + 60_000, startedAt.getTime() + 120_000],
      },
      // Южный океан: рядом нет мест из сида.
      takeoff: { lat: -61, lon: -101, altM: 1500 },
      landing: { lat: -61.1, lon: -101, altM: 800 },
      gliderRaw: null,
      timezone: 'Asia/Almaty',
    });
    return flight.id;
  };

  beforeAll(async () => {
    connection = createDatabase(databaseUrl ?? '');
    pilot = await user('logbook');
    other = await user('other');
  });
  afterAll(async () => {
    if (createdFlights.length > 0) await connection.db.delete(flights).where(inArray(flights.id, createdFlights));
    if (createdUsers.length > 0) await connection.db.delete(users).where(inArray(users.id, createdUsers));
    await connection.close();
  });

  it('список: только свои, новые сверху, сводка в СИ, курсор по страницам', async () => {
    const may1 = await readyFlight(pilot, day(1));
    const may3 = await readyFlight(pilot, day(3));
    const may2 = await readyFlight(pilot, day(2));
    await readyFlight(other, day(4));

    const first = await listLogbook(connection.db, { userId: pilot, limit: 2 });
    expect(first.items.map((f) => f.id)).toEqual([may3, may2]);
    expect(first.items[0]).toMatchObject({
      status: 'ready',
      startedAt: day(3),
      durationS: 3600,
      distanceTrackM: 42_000,
      maxAltM: 2346,
      thermalCount: null,
    });
    expect(first.next).not.toBeNull();

    if (!first.next) throw new Error('expected a next page');
    const second = await listLogbook(connection.db, { userId: pilot, limit: 2, after: first.next });
    expect(second.items.map((f) => f.id)).toEqual([may1]);
    expect(second.next).toBeNull();
  });

  it('фильтр по дате старта включает обе границы', async () => {
    const result = await listLogbook(connection.db, { userId: pilot, limit: 10, from: '2002-05-02', to: '2002-05-03' });
    expect(result.items.map((f) => f.startedAt)).toEqual([day(3), day(2)]);
  });

  it('дата — местная: вечерний полёт в Алматы по UTC ещё «вчера», для пилота — сегодня', async () => {
    // 20:00 UTC 10 мая = 02:00 11 мая в Алматы.
    const evening = await readyFlight(pilot, day(10, 20));
    const [row] = await connection.db.select({ localDate: flights.localDate }).from(flights).where(eq(flights.id, evening));
    expect(row?.localDate).toBe('2002-05-11');

    const byLocal = await listLogbook(connection.db, { userId: pilot, limit: 10, from: '2002-05-11', to: '2002-05-11' });
    expect(byLocal.items.map((f) => f.id)).toEqual([evening]);
    expect(byLocal.items[0]?.timezone).toBe('Asia/Almaty');
  });

  it('полёт в обработке — в списке по времени загрузки, без сводки', async () => {
    const pending = await insertFlight(connection.db, { userId: pilot, sourceFormat: 'igc', rawObjectKey: `raw/test/${RUN}-p.igc.gz` });
    createdFlights.push(pending.id);
    const result = await listLogbook(connection.db, { userId: pilot, limit: 1 });
    // Загружен сейчас — позже всех полётов 2002 года.
    expect(result.items[0]).toMatchObject({ id: pending.id, status: 'pending', startedAt: null, distanceTrackM: null });
  });

  it('карта: упрощённые треки своих полётов в [долгота, широта]', async () => {
    const map = await listLogbookMap(connection.db, pilot);
    // Полёты 1–3 мая 2002 из первого теста; остальные тесты добавляют свои.
    const ours = map.filter((f) => f.startedAt !== null && f.startedAt.getTime() <= day(3).getTime() && f.startedAt >= day(1));
    expect(ours).toHaveLength(3);
    expect(ours[0]?.coordinates).toEqual([
      [76.9, 43.2],
      [76.95, 43.25],
      [76.92, 43.3],
    ]);
    expect((await listLogbookMap(connection.db, other)).every((f) => f.id !== ours[0]?.id)).toBe(true);
  });

  it('анонимный полёт забирается только с верным токеном и только один раз', async () => {
    const anonymous = await readyFlight(null, day(5), { claimTokenHash: `hash-${RUN}` });
    const foreign = await readyFlight(other, day(6), { claimTokenHash: `hash-${RUN}-owned` });

    expect(await claimFlights(connection.db, pilot, [{ flightId: anonymous, tokenHash: 'wrong' }])).toEqual([]);
    expect(
      await claimFlights(connection.db, pilot, [
        { flightId: anonymous, tokenHash: `hash-${RUN}` },
        { flightId: foreign, tokenHash: `hash-${RUN}-owned` },
      ]),
    ).toEqual([anonymous]);

    const [row] = await connection.db.select().from(flights).where(eq(flights.id, anonymous));
    expect(row).toMatchObject({ userId: pilot, claimTokenHash: null });
    // Второй раз тот же токен ничего не даёт: хэш стёрт.
    expect(await claimFlights(connection.db, other, [{ flightId: anonymous, tokenHash: `hash-${RUN}` }])).toEqual([]);
  });

  it('полёты без сводки возвращаются в очередь один раз', async () => {
    const legacy = await insertFlight(connection.db, { userId: pilot, sourceFormat: 'igc', rawObjectKey: `raw/test/${RUN}-l.igc.gz` });
    createdFlights.push(legacy.id);
    await connection.db.update(flights).set({ status: 'ready' }).where(eq(flights.id, legacy.id));

    expect(await requeueFlightsForBackfill(connection.db)).toBeGreaterThanOrEqual(1);
    const [row] = await connection.db.select({ status: flights.status }).from(flights).where(eq(flights.id, legacy.id));
    expect(row?.status).toBe('pending');
    // Полёты со сводкой не трогает.
    const [ready] = await connection.db
      .select({ status: flights.status })
      .from(flights)
      .where(eq(flights.id, createdFlights[0] ?? ''));
    expect(ready?.status).toBe('ready');
  });
});
