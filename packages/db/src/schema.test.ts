import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, type DatabaseConnection } from './client.js';
import { readPostgisVersion } from './repositories/health.js';
import { flights, users } from './schema.js';

const databaseUrl = process.env.DATABASE_URL;

/** Откат транзакции после проверки: тест не оставляет данных в БД. */
class Rollback extends Error {}

// Интеграционный: нужен поднятый docker compose и применённые миграции.
describe.runIf(Boolean(databaseUrl))('схема на живой БД', () => {
  let connection: DatabaseConnection;

  beforeAll(() => {
    connection = createDatabase(databaseUrl ?? '');
  });
  afterAll(() => connection.close());

  it('PostGIS доступен', async () => {
    expect(await readPostgisVersion(connection.db)).toMatch(/^3\.5\./);
  });

  it('flights хранит geography и отдаёт его через PostGIS', async () => {
    const run = connection.db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({ email: 'Pilot@Example.com', username: 'pilot' })
        .returning({ id: users.id });

      const [flight] = await tx
        .insert(flights)
        .values({
          userId: user?.id ?? null,
          sourceFormat: 'igc',
          rawObjectKey: 'raw/test.igc.gz',
          trackSimplified: 'SRID=4326;LINESTRINGZM(76.95 43.24 1500 0, 76.96 43.25 1600 60)',
          bbox: 'SRID=4326;POLYGON((76.95 43.24, 76.96 43.24, 76.96 43.25, 76.95 43.25, 76.95 43.24))',
        })
        .returning({ id: flights.id, status: flights.status, privacy: flights.privacy });

      const {
        rows: [geo],
      } = await tx.execute<{ wkt: string; lengthM: number }>(
        sql`SELECT ST_AsText(track_simplified) AS wkt, ST_Length(track_simplified) AS "lengthM"
            FROM flights WHERE id = ${flight?.id}`,
      );

      // citext: поиск без учёта регистра
      const {
        rows: [found],
      } = await tx.execute<{ id: string }>(sql`SELECT id FROM users WHERE email = 'pilot@example.com'`);

      expect(flight).toMatchObject({ status: 'pending', privacy: 'unlisted' });
      expect(geo?.wkt).toBe('LINESTRING ZM (76.95 43.24 1500 0,76.96 43.25 1600 60)');
      // Длина на сфероиде, а не в градусах — ради этого и geography.
      expect(geo?.lengthM).toBeGreaterThan(1000);
      expect(found?.id).toBe(user?.id);

      throw new Rollback();
    });

    await expect(run).rejects.toBeInstanceOf(Rollback);
  });

  it('CHECK не пускает статус вне списка из core', async () => {
    const run = connection.db.execute(
      sql`INSERT INTO flights (source_format, raw_object_key, status) VALUES ('igc', 'raw/x', 'done')`,
    );
    await expect(run).rejects.toThrow();
  });
});
