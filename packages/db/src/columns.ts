import { GEO } from '@skyline/core';
import { customType } from 'drizzle-orm/pg-core';

export type GeographyKind = 'Point' | 'LineStringZM' | 'Polygon';

/**
 * PostGIS `geography`, не `geometry`: нужны корректные расстояния на сфере
 * (CLAUDE.md, «База данных»). SRID всегда WGS84.
 *
 * Запись — EWKT (`SRID=4326;POINT(76.95 43.24)`), чтение — hex EWKB, как его
 * отдаёт драйвер. Геометрию разбирают raw SQL-запросы репозиториев
 * (`ST_AsGeoJSON` и т.п.), а не код приложения.
 */
export const geography = customType<{
  data: string;
  driverData: string;
  config: { kind: GeographyKind };
  configRequired: true;
}>({
  dataType: (config) => `geography(${config.kind},${GEO.wgs84Srid})`,
});

/** Регистронезависимый текст (расширение citext) — для email и username (ТЗ §9). */
export const citext = customType<{ data: string; driverData: string }>({
  dataType: () => 'citext',
});
