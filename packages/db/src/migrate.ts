import { fileURLToPath } from 'node:url';

import { migrate } from 'drizzle-orm/node-postgres/migrator';

import { createDatabase } from './client.js';

/**
 * Папка SQL-миграций Drizzle (packages/db/drizzle) — рядом и с src, и с dist,
 * поэтому путь одинаков в разработке и в прод-образе.
 */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../drizzle', import.meta.url));

/**
 * Накатывает миграции в прод-окружении. drizzle-kit — инструмент разработки и в
 * образ не попадает; drizzle-orm ведёт ту же служебную таблицу drizzle.__drizzle_migrations,
 * так что базы, накатанные через drizzle-kit, совместимы. Идемпотентна.
 */
export async function runMigrations(connectionString: string, migrationsFolder: string = MIGRATIONS_FOLDER): Promise<void> {
  const connection = createDatabase(connectionString);
  try {
    await migrate(connection.db, { migrationsFolder });
  } finally {
    await connection.close();
  }
}
