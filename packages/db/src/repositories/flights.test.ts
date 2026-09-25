import { TIME } from '@skyline/core';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, type DatabaseConnection } from '../client.js';
import { flights, users } from '../schema.js';
import { deleteFlights, listExpiredAnonymousFlights } from './flights.js';

const databaseUrl = process.env.DATABASE_URL;

/**
 * Даты загрузки — в 2001 году: так в выборку не попадут настоящие полёты
 * из локальной базы разработчика, а тест от них не зависит.
 */
const LONG_AGO = new Date(Date.UTC(2001, 0, 1));
const day = (n: number): Date => new Date(LONG_AGO.getTime() + n * TIME.secondsPerDay * TIME.msPerSecond);

// Интеграционный: нужен поднятый docker compose и применённые миграции.
describe.runIf(Boolean(databaseUrl))('listExpiredAnonymousFlights на живой БД', () => {
  let connection: DatabaseConnection;
  let userId: string;
  const created: string[] = [];

  const insert = async (values: { userId: string | null; createdAt: Date; trackObjectKey?: string }): Promise<string> => {
    const [row] = await connection.db
      .insert(flights)
      .values({ sourceFormat: 'igc', rawObjectKey: `raw/test/${created.length}.igc.gz`, ...values })
      .returning({ id: flights.id });
    if (!row) throw new Error('insert returned no row');
    created.push(row.id);
    return row.id;
  };

  beforeAll(async () => {
    connection = createDatabase(databaseUrl ?? '');
    const [user] = await connection.db
      .insert(users)
      .values({ email: `ttl-${Date.now()}@example.com`, username: `ttl-${Date.now()}` })
      .returning({ id: users.id });
    if (!user) throw new Error('user insert returned no row');
    userId = user.id;
  });

  afterAll(async () => {
    await deleteFlights(connection.db, created);
    await connection.db.delete(users).where(eq(users.id, userId));
    await connection.close();
  });

  it('берёт только анонимные, загруженные раньше порога, старые первыми', async () => {
    const older = await insert({ userId: null, createdAt: day(0), trackObjectKey: 'tracks/older.track' });
    const newer = await insert({ userId: null, createdAt: day(1) });
    await insert({ userId: null, createdAt: day(10) }); // ещё не истёк
    await insert({ userId, createdAt: day(0) }); // полёт пилота — никогда

    const expired = await listExpiredAnonymousFlights(connection.db, day(5), 100);

    expect(expired.map((f) => f.id)).toEqual([older, newer]);
    expect(expired[0]?.rawObjectKey).toMatch(/^raw\/test\//);
    expect(expired[0]?.trackObjectKey).toBe('tracks/older.track');
    expect(expired[1]?.trackObjectKey).toBeNull();
  });

  it('соблюдает лимит пачки', async () => {
    expect(await listExpiredAnonymousFlights(connection.db, day(5), 1)).toHaveLength(1);
  });
});
