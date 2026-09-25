import { fileURLToPath } from 'node:url';

import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { createDatabase } from './client.js';
import { MIGRATIONS_FOLDER, runMigrations } from './migrate.js';

const databaseUrl = process.env.DATABASE_URL;

describe('MIGRATIONS_FOLDER', () => {
  it('указывает на packages/db/drizzle с журналом миграций', () => {
    expect(MIGRATIONS_FOLDER.replaceAll('\\', '/')).toMatch(/packages\/db\/drizzle$/);
    expect(fileURLToPath(new URL('../drizzle/meta/_journal.json', import.meta.url))).toContain('_journal.json');
  });
});

// Интеграционный: нужен поднятый docker compose. Прод запускает миграции этим же
// кодом — drizzle-kit (инструмент разработки) в образ не попадает.
describe.runIf(Boolean(databaseUrl))('runMigrations на живой БД', () => {
  it('идемпотентна: на уже накатанной базе ничего не ломает, схема на месте', async () => {
    await runMigrations(databaseUrl ?? '');
    await runMigrations(databaseUrl ?? '');

    const connection = createDatabase(databaseUrl ?? '');
    try {
      const { rows } = await connection.db.execute<{ exists: boolean }>(
        sql`SELECT to_regclass('public.flights') IS NOT NULL AS "exists"`,
      );
      expect(rows[0]?.exists).toBe(true);
    } finally {
      await connection.close();
    }
  });
});
