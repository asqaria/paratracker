import {
  ALTITUDE_SOURCES,
  ANALYSIS_LEVELS,
  DEFAULT_PRIVACY,
  FLIGHT_STATUSES,
  LOCALES,
  PRIVACY_LEVELS,
  SOURCE_FORMATS,
  UNIT_SYSTEMS,
} from '@skyline/core';
import { sql, type SQL } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

import { citext, geography } from './columns.js';

/**
 * Схема по ТЗ §9 — только users и flights (Фаза 0, задача 0.4).
 *
 * Отступления от текста §9, обязательные по CLAUDE.md:
 * - дистанции хранятся в метрах (`*_m integer`), а не в км: внутри системы только СИ;
 * - FK на sites и gliders не объявлены — этих таблиц ещё нет, колонки уже есть,
 *   ограничения добавятся миграцией вместе с таблицами.
 */

/** CHECK по списку значений из core: один источник правды для БД и API. */
const oneOf = (column: AnyPgColumn, values: readonly string[]): SQL =>
  sql`${column} IN (${sql.raw(values.map((v) => `'${v.replaceAll("'", "''")}'`).join(', '))})`;

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: citext('email').notNull().unique(),
    username: citext('username').notNull().unique(),
    displayName: text('display_name'),
    avatarUrl: text('avatar_url'),
    /** FK на sites — вместе с таблицей sites. */
    homeSiteId: uuid('home_site_id'),
    units: text('units', { enum: UNIT_SYSTEMS }).notNull().default('metric'),
    locale: text('locale', { enum: LOCALES }).notNull().default('ru'),
    defaultPrivacy: text('default_privacy', { enum: PRIVACY_LEVELS }).notNull().default(DEFAULT_PRIVACY),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    lastSeenAt: timestamptz('last_seen_at'),
  },
  (t) => [
    check('users_units_check', oneOf(t.units, UNIT_SYSTEMS)),
    check('users_locale_check', oneOf(t.locale, LOCALES)),
    check('users_default_privacy_check', oneOf(t.defaultPrivacy, PRIVACY_LEVELS)),
  ],
);

export const flights = pgTable(
  'flights',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** null — анонимная загрузка, TTL 30 дней (ТЗ §11.2). */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    status: text('status', { enum: FLIGHT_STATUSES }).notNull().default('pending'),
    errorCode: text('error_code'),

    // сырые метаданные из файла
    sourceFormat: text('source_format', { enum: SOURCE_FORMATS }).notNull(),
    rawObjectKey: text('raw_object_key').notNull(),
    trackObjectKey: text('track_object_key'),
    previewObjectKey: text('preview_object_key'),
    device: text('device'),
    pilotNameRaw: text('pilot_name_raw'),
    gliderRaw: text('glider_raw'),

    // привязки; FK — вместе с таблицами gliders и sites
    gliderId: uuid('glider_id'),
    takeoffSiteId: uuid('takeoff_site_id'),
    landingSiteId: uuid('landing_site_id'),

    // время: UTC, local_date — дата в таймзоне места старта
    startedAt: timestamptz('started_at'),
    endedAt: timestamptz('ended_at'),
    durationS: integer('duration_s'),
    localDate: date('local_date', { mode: 'string' }),

    // агрегаты, СИ
    altitudeSource: text('altitude_source', { enum: ALTITUDE_SOURCES }),
    maxAltM: integer('max_alt_m'),
    minAltM: integer('min_alt_m'),
    takeoffAltM: integer('takeoff_alt_m'),
    landingAltM: integer('landing_alt_m'),
    maxAglM: integer('max_agl_m'),
    totalGainM: integer('total_gain_m'),
    distanceTrackM: integer('distance_track_m'),
    distanceStraightM: integer('distance_straight_m'),
    maxClimbMs: numeric('max_climb_ms', { precision: 4, scale: 2, mode: 'number' }),
    maxSinkMs: numeric('max_sink_ms', { precision: 4, scale: 2, mode: 'number' }),
    maxSpeedMs: numeric('max_speed_ms', { precision: 5, scale: 2, mode: 'number' }),
    avgSpeedMs: numeric('avg_speed_ms', { precision: 5, scale: 2, mode: 'number' }),
    thermalCount: integer('thermal_count'),
    avgClimbMs: numeric('avg_climb_ms', { precision: 4, scale: 2, mode: 'number' }),
    /** null, если не было валидных глайдов. */
    avgGlideRatio: numeric('avg_glide_ratio', { precision: 6, scale: 2, mode: 'number' }),
    analysisLevel: text('analysis_level', { enum: ANALYSIS_LEVELS }),
    /** Метеорологическое направление, «откуда дует». */
    windDirDeg: integer('wind_dir_deg'),
    windSpeedMs: numeric('wind_speed_ms', { precision: 4, scale: 2, mode: 'number' }),

    // XC
    xcType: text('xc_type'),
    xcDistanceM: integer('xc_distance_m'),
    xcScore: numeric('xc_score', { precision: 7, scale: 2, mode: 'number' }),
    xcRules: text('xc_rules'),
    /** false — bounded-time оценка (ТЗ §6.6). */
    xcIsOptimal: boolean('xc_is_optimal'),
    xcTurnpoints: jsonb('xc_turnpoints'),

    // геометрия
    trackSimplified: geography('track_simplified', { kind: 'LineStringZM' }),
    bbox: geography('bbox', { kind: 'Polygon' }),

    // социальное
    title: text('title'),
    description: text('description'),
    privacy: text('privacy', { enum: PRIVACY_LEVELS }).notNull().default(DEFAULT_PRIVACY),
    shareToken: text('share_token').unique(),
    viewCount: integer('view_count').notNull().default(0),
    likeCount: integer('like_count').notNull().default(0),

    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    check('flights_status_check', oneOf(t.status, FLIGHT_STATUSES)),
    check('flights_source_format_check', oneOf(t.sourceFormat, SOURCE_FORMATS)),
    check('flights_altitude_source_check', oneOf(t.altitudeSource, ALTITUDE_SOURCES)),
    check('flights_analysis_level_check', oneOf(t.analysisLevel, ANALYSIS_LEVELS)),
    check('flights_privacy_check', oneOf(t.privacy, PRIVACY_LEVELS)),
    index('flights_track_simplified_gist').using('gist', t.trackSimplified),
    index('flights_user_started_idx').on(t.userId, t.startedAt.desc()),
    index('flights_takeoff_site_local_date_idx').on(t.takeoffSiteId, t.localDate.desc()),
    index('flights_public_started_idx')
      .on(t.privacy, t.startedAt.desc())
      .where(sql`${t.privacy} = 'public'`),
  ],
);
