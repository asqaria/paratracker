#!/usr/bin/env node
/**
 * Сид мест старта (задача 2.13) из paragliding.earth → миграция Drizzle
 * packages/db/drizzle/0007_seed_sites.sql. Запускать вручную, результат —
 * в репозитории: прод не ходит в сеть за местами, миграция детерминирована.
 *
 *   pnpm --filter @skyline/core build && node tools/make-sites-seed.mjs
 *
 * Лицензия данных — CC BY-SA 3.0 (новые правки PGE с 10.12.2024 — ODbL 1.0):
 * таблица sites открыта под той же лицензией, атрибуция «paragliding.earth»
 * обязательна везде, где места показываются (решение владельца 26.09.2026).
 *
 * Высоты PGE — над уровнем моря; внутри системы — над эллипсоидом WGS84
 * (CLAUDE.md), пересчёт по EGM96 здесь, на границе.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import tzlookup from '@photostructure/tz-lookup';
import { meanSeaLevel } from 'egm96-universal';

import { siteSlug } from '../packages/core/dist/site.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'packages/db/drizzle/0007_seed_sites.sql');
const API = 'https://www.paraglidingearth.com/api/geojson/getCountrySites.php';

/** СНГ, Центральная Азия, Кавказ, Монголия и Турция — куда летают пилоты из Казахстана. */
const COUNTRIES = ['kz', 'kg', 'uz', 'tj', 'tm', 'ru', 'az', 'am', 'ge', 'mn', 'tr'];
/** = SITE.matchRadiusM из packages/core. */
const MATCH_RADIUS_M = 2000;

const sqlText = (value) => (value === null ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`);

async function fetchCountry(iso) {
  const response = await fetch(`${API}?iso=${iso}`, { headers: { 'user-agent': 'skyline-seed (tools/make-sites-seed.mjs)' } });
  if (!response.ok) throw new Error(`${iso}: HTTP ${response.status}`);
  return (await response.json()).features ?? [];
}

const rows = [];
const slugs = new Set();
for (const iso of COUNTRIES) {
  const features = await fetchCountry(iso);
  for (const feature of features) {
    const [lon, lat] = feature.geometry?.coordinates ?? [];
    const name = String(feature.properties?.name ?? '').trim();
    const id = feature.properties?.pge_site_id;
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || name === '' || !id) continue;

    const msl = Number.parseFloat(feature.properties.takeoff_altitude);
    // 0 и пусто в PGE — «не указана», а не уровень моря.
    const elevation = Number.isFinite(msl) && msl > 0 ? Math.round(msl + meanSeaLevel(lat, lon)) : null;

    let slug = siteSlug(name);
    for (let n = 2; slugs.has(slug); n++) slug = `${siteSlug(name)}-${n}`;
    slugs.add(slug);

    rows.push({
      slug,
      name,
      country: String(feature.properties.countryCode ?? iso).toLowerCase().slice(0, 2),
      lat,
      lon,
      elevation,
      timezone: tzlookup(lat, lon),
      ref: `pge:${id}`,
    });
  }
  console.log(`${iso}: ${features.length}`);
}
rows.sort((a, b) => a.ref.localeCompare(b.ref, 'en', { numeric: true }));

const values = rows.map(
  (r) =>
    `(${sqlText(r.slug)}, ${sqlText(r.name)}, ${sqlText(r.country)}, 'SRID=4326;POINT(${r.lon} ${r.lat})', ` +
    `${r.elevation ?? 'NULL'}, ${sqlText(r.timezone)}, 'takeoff', 'seed', ${sqlText(r.ref)})`,
);

const sql = `-- Сид мест старта (задача 2.13): paragliding.earth, ${new Date().toISOString().slice(0, 10)}.
-- Сгенерировано tools/make-sites-seed.mjs — руками не править.
-- Данные: https://paraglidingearth.com — CC BY-SA 3.0 (новые правки — ODbL 1.0).
-- Страны: ${COUNTRIES.join(', ')}. Мест: ${rows.length}. Высоты пересчитаны на эллипсоид (EGM96).
INSERT INTO "sites" ("slug", "name", "country_code", "location", "elevation_m", "timezone", "type", "source", "source_ref") VALUES
${values.join(',\n')}
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Полёты, уже обработанные к моменту сида, получают ближайшее место (ТЗ §6.8).
UPDATE "flights" AS f SET "takeoff_site_id" = (
  SELECT s."id" FROM "sites" AS s
  WHERE ST_DWithin(s."location", f."takeoff_point", ${MATCH_RADIUS_M})
  ORDER BY ST_Distance(s."location", f."takeoff_point") LIMIT 1
) WHERE f."takeoff_site_id" IS NULL AND f."takeoff_point" IS NOT NULL;
--> statement-breakpoint
UPDATE "flights" AS f SET "landing_site_id" = (
  SELECT s."id" FROM "sites" AS s
  WHERE ST_DWithin(s."location", f."landing_point", ${MATCH_RADIUS_M})
  ORDER BY ST_Distance(s."location", f."landing_point") LIMIT 1
) WHERE f."landing_site_id" IS NULL AND f."landing_point" IS NOT NULL;
`;
writeFileSync(OUT, sql, 'utf8');
console.log(`\n${rows.length} мест → ${OUT}`);
