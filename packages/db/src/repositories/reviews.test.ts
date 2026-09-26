import { inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, type DatabaseConnection } from '../client.js';
import { flights, users } from '../schema.js';
import { insertFlight } from './flights.js';
import { findThermalReview, saveThermalReview } from './reviews.js';

const databaseUrl = process.env.DATABASE_URL;
const RUN = Date.now().toString(36);

// Интеграционный: нужен поднятый docker compose и применённые миграции.
describe.runIf(Boolean(databaseUrl))('сверка термиков на живой БД', () => {
  let connection: DatabaseConnection;
  let pilot: string;
  let other: string;
  let flightId: string;
  const createdUsers: string[] = [];

  const user = async (name: string): Promise<string> => {
    const [row] = await connection.db
      .insert(users)
      .values({ email: `${name}-${RUN}@example.com`, username: `${name}-${RUN}` })
      .returning({ id: users.id });
    if (!row) throw new Error('user insert returned no row');
    createdUsers.push(row.id);
    return row.id;
  };

  beforeAll(async () => {
    connection = createDatabase(databaseUrl ?? '');
    pilot = await user('review');
    other = await user('review-other');
    const flight = await insertFlight(connection.db, {
      userId: pilot,
      sourceFormat: 'igc',
      rawObjectKey: `raw/test/${RUN}.igc.gz`,
    });
    flightId = flight.id;
  });
  afterAll(async () => {
    await connection.db.delete(flights).where(inArray(flights.id, [flightId]));
    await connection.db.delete(users).where(inArray(users.id, createdUsers));
    await connection.close();
  });

  it('до сверки — пусто; после — разметка; повторное сохранение заменяет', async () => {
    expect(await findThermalReview(connection.db, flightId, pilot)).toMatchObject({ review: null });

    const first = { confirmed: [{ startMs: 1000, endMs: 5000 }], rejected: [], missed: [] };
    expect(await saveThermalReview(connection.db, { flightId, userId: pilot, labels: first })).toBe(true);
    expect((await findThermalReview(connection.db, flightId, pilot))?.review?.labels).toEqual(first);

    const second = { ...first, missed: [{ startMs: 9000, endMs: 12_000, note: 'ветер' }] };
    await saveThermalReview(connection.db, { flightId, userId: pilot, labels: second });
    expect((await findThermalReview(connection.db, flightId, pilot))?.review?.labels).toEqual(second);
  });

  it('чужой полёт — ни прочитать, ни записать', async () => {
    expect(await findThermalReview(connection.db, flightId, other)).toBeNull();
    const labels = { confirmed: [], rejected: [], missed: [] };
    expect(await saveThermalReview(connection.db, { flightId, userId: other, labels })).toBe(false);
  });
});
