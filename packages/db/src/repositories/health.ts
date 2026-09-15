import { sql } from 'drizzle-orm';

import type { Database } from '../client.js';

/**
 * Версия PostGIS. Бросает, если БД недоступна или расширение не установлено —
 * это и есть проверка «postgis доступен» для /health.
 */
export async function readPostgisVersion(db: Database): Promise<string> {
  const result = await db.execute<{ version: string }>(sql`SELECT postgis_lib_version() AS version`);
  const version = result.rows[0]?.version;
  if (!version) throw new Error('postgis_lib_version() returned no rows');
  return version;
}
