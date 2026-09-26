import {
  ALTITUDE_SOURCES,
  ANALYSIS_LEVELS,
  AUTH_PROVIDERS,
  DEFAULT_PRIVACY,
  FLIGHT_STATUSES,
  GLIDE_KINDS,
  GLIDER_CERTIFICATIONS,
  LOCALES,
  PRIVACY_LEVELS,
  SITE_SOURCES,
  SITE_TYPES,
  SOURCE_FORMATS,
  TURN_DIRECTIONS,
  UNIT_SYSTEMS,
  type WindBand,
} from '@skyline/core';
import { sql, type SQL } from 'drizzle-orm';
import {
  boolean,
  char,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

import { citext, geography } from './columns.js';

/**
 * Схема по ТЗ §9: users и flights (Фаза 0, задача 0.4), thermals и glides (задача 2.5),
 * oauth_accounts и sessions (задача 2.10), sites (задача 2.13а), gliders (задача 2.13б).
 *
 * Отступления от текста §9, обязательные по CLAUDE.md:
 * - дистанции хранятся в метрах (`*_m integer`), а не в км: внутри системы только СИ;
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

/**
 * Вход через провайдера OAuth (задача 2.10). Паролей нет: пользователь — это
 * одна или несколько внешних учёток. subject — неизменный id у провайдера
 * (`sub` в id_token Google); email у провайдера может смениться, sub — нет.
 */
export const oauthAccounts = pgTable(
  'oauth_accounts',
  {
    provider: text('provider', { enum: AUTH_PROVIDERS }).notNull(),
    subject: text('subject').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.provider, t.subject] }),
    check('oauth_accounts_provider_check', oneOf(t.provider, AUTH_PROVIDERS)),
    index('oauth_accounts_user_idx').on(t.userId),
  ],
);

/**
 * Сессии: refresh-токены (ТЗ §10). Храним только SHA-256 токена — утёкшая
 * база не даёт войти. Ротация: при refresh старая строка отзывается и
 * ссылается на новую (replaced_by); повтор отозванного токена — кража,
 * гасятся все сессии пользователя.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    expiresAt: timestamptz('expires_at').notNull(),
    revokedAt: timestamptz('revoked_at'),
    replacedBy: uuid('replaced_by'),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

/**
 * Места старта и посадки (ТЗ §6.8, §9, задача 2.13). Сид — paragliding.earth
 * (CC BY-SA 3.0): таблица мест открыта под той же лицензией. Места от пилотов
 * видны всем сразу (решение владельца 26.09.2026).
 */
export const sites = pgTable(
  'sites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    /** ISO 3166-1 alpha-2, строчными; null — неизвестна. */
    countryCode: char('country_code', { length: 2 }),
    location: geography('location', { kind: 'Point' }).notNull(),
    elevationM: integer('elevation_m'),
    /** IANA, напр. 'Asia/Almaty': из него — местное время полёта (задача 2.14). */
    timezone: text('timezone').notNull(),
    type: text('type', { enum: SITE_TYPES }).notNull().default('takeoff'),
    description: text('description'),
    source: text('source', { enum: SITE_SOURCES }).notNull(),
    /** id в источнике ('pge:9773'): повторная загрузка сида не плодит дубли. */
    sourceRef: text('source_ref').unique(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    check('sites_type_check', oneOf(t.type, SITE_TYPES)),
    check('sites_source_check', oneOf(t.source, SITE_SOURCES)),
    index('sites_location_gist').using('gist', t.location),
  ],
);

/** Крылья пилота (ТЗ §9, задача 2.13б). У пилота не больше одного крыла по умолчанию. */
export const gliders = pgTable(
  'gliders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    manufacturer: text('manufacturer').notNull(),
    model: text('model').notNull(),
    size: text('size'),
    /** EN-A..EN-D, CCC; null — не указан. */
    certification: text('certification', { enum: GLIDER_CERTIFICATIONS }),
    purchasedAt: date('purchased_at', { mode: 'string' }),
    retiredAt: date('retired_at', { mode: 'string' }),
    /** Крыло по умолчанию: его получают новые полёты пилота. */
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    check('gliders_certification_check', oneOf(t.certification, GLIDER_CERTIFICATIONS)),
    index('gliders_user_idx').on(t.userId),
    // Одно крыло по умолчанию на пилота — гарантия БД, а не только кода.
    uniqueIndex('gliders_one_default_idx')
      .on(t.userId)
      .where(sql`${t.isDefault}`),
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
    /**
     * Анонимная загрузка: SHA-256 токена, который получил загрузивший браузер.
     * Предъявив токен после входа, пилот забирает полёт в логбук (задача 2.11).
     * У полёта с владельцем — null.
     */
    claimTokenHash: text('claim_token_hash'),
    trackObjectKey: text('track_object_key'),
    previewObjectKey: text('preview_object_key'),
    device: text('device'),
    pilotNameRaw: text('pilot_name_raw'),
    gliderRaw: text('glider_raw'),

    // привязки
    gliderId: uuid('glider_id').references(() => gliders.id, { onDelete: 'set null' }),
    takeoffSiteId: uuid('takeoff_site_id').references(() => sites.id, { onDelete: 'set null' }),
    landingSiteId: uuid('landing_site_id').references(() => sites.id, { onDelete: 'set null' }),
    /**
     * Точки взлёта и посадки (flightRange, ТЗ §6.8): по ним ищется место.
     * Не первая точка трека — её пишут и до подъёма пешком на старт.
     */
    takeoffPoint: geography('takeoff_point', { kind: 'Point' }),
    landingPoint: geography('landing_point', { kind: 'Point' }),

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
    /**
     * Профиль ветра по слоям (ТЗ §6.5): единицы записей на полёт, читается целиком
     * вместе с полётом — отдельная таблица не окупается.
     */
    windProfile: jsonb('wind_profile').$type<WindBand[]>(),

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
    // Уборка анонимных загрузок по TTL (ТЗ §11.2): только строки без пользователя.
    index('flights_anonymous_created_idx')
      .on(t.createdAt)
      .where(sql`${t.userId} IS NULL`),
    index('flights_public_started_idx')
      .on(t.privacy, t.startedAt.desc())
      .where(sql`${t.privacy} = 'public'`),
  ],
);

/** Термики полёта, ТЗ §6.3. Направление сноса — метеорологическое, «откуда». */
export const thermals = pgTable(
  'thermals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    flightId: uuid('flight_id')
      .notNull()
      .references(() => flights.id, { onDelete: 'cascade' }),
    /** Порядковый номер в полёте, с нуля. */
    seq: integer('seq').notNull(),
    startedAt: timestamptz('started_at').notNull(),
    endedAt: timestamptz('ended_at').notNull(),
    durationS: integer('duration_s').notNull(),
    entryAltM: integer('entry_alt_m').notNull(),
    exitAltM: integer('exit_alt_m').notNull(),
    gainM: integer('gain_m').notNull(),
    avgClimbMs: numeric('avg_climb_ms', { precision: 4, scale: 2, mode: 'number' }).notNull(),
    maxClimbMs: numeric('max_climb_ms', { precision: 4, scale: 2, mode: 'number' }).notNull(),
    turnCount: numeric('turn_count', { precision: 4, scale: 1, mode: 'number' }).notNull(),
    avgRadiusM: integer('avg_radius_m').notNull(),
    direction: text('direction', { enum: TURN_DIRECTIONS }).notNull(),
    efficiency: numeric('efficiency', { precision: 3, scale: 2, mode: 'number' }).notNull(),
    entryPoint: geography('entry_point', { kind: 'Point' }).notNull(),
    exitPoint: geography('exit_point', { kind: 'Point' }).notNull(),
    /** null — один круг, сносу не из чего взяться. */
    driftDirDeg: integer('drift_dir_deg'),
    driftSpeedMs: numeric('drift_speed_ms', { precision: 4, scale: 2, mode: 'number' }),
  },
  (t) => [
    check('thermals_direction_check', oneOf(t.direction, TURN_DIRECTIONS)),
    index('thermals_flight_seq_idx').on(t.flightId, t.seq),
    // Тепловая карта термиков (ТЗ §9).
    index('thermals_entry_point_gist').using('gist', t.entryPoint),
  ],
);

/** Глайды (переходы) полёта, ТЗ §6.4. */
export const glides = pgTable(
  'glides',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    flightId: uuid('flight_id')
      .notNull()
      .references(() => flights.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    startedAt: timestamptz('started_at').notNull(),
    endedAt: timestamptz('ended_at').notNull(),
    distanceM: integer('distance_m').notNull(),
    /** Отрицательная — пилот на переходе набрал. */
    altLossM: integer('alt_loss_m').notNull(),
    /** null — 'dynamic', потеря меньше 50 м (ТЗ §6.4); numeric(6,2) — клип на 60. */
    glideRatio: numeric('glide_ratio', { precision: 6, scale: 2, mode: 'number' }),
    kind: text('kind', { enum: GLIDE_KINDS }).notNull(),
    avgSpeedMs: numeric('avg_speed_ms', { precision: 5, scale: 2, mode: 'number' }).notNull(),
    /** null — вернулся в точку старта перехода, курса нет. */
    headingDeg: integer('heading_deg'),
    headingConsistency: numeric('heading_consistency', { precision: 3, scale: 2, mode: 'number' }).notNull(),
  },
  (t) => [check('glides_kind_check', oneOf(t.kind, GLIDE_KINDS)), index('glides_flight_seq_idx').on(t.flightId, t.seq)],
);
