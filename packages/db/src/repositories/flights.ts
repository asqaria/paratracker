import {
  UNFINISHED_FLIGHT_STATUSES,
  XC,
  type AltitudeSource,
  type AnalysisLevel,
  type FlightAnalysis,
  type FlightStatus,
  type SimplifiedLine,
  type SourceFormat,
  type FlightPoint,
  type XcScore,
} from '@skyline/core';
import { and, asc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';

import type { Database } from '../client.js';
import { flights, glides, thermals } from '../schema.js';
import { defaultGliderId } from './gliders.js';
import { nearestSiteId } from './sites.js';

/** Репозиторий полётов: наружу отдаются типизированные записи, не строки БД. */

export interface NewFlight {
  /** Задаётся вызывающим: ключ сырого файла в S3 содержит id полёта. */
  id?: string;
  /** null — анонимная загрузка (ТЗ §11.2, TTL 30 дней). */
  userId: string | null;
  sourceFormat: SourceFormat;
  rawObjectKey: string;
  /** Анонимная загрузка: хэш токена, по которому полёт потом забирают в логбук. */
  claimTokenHash?: string;
}

export interface FlightRecord {
  id: string;
  status: FlightStatus;
  sourceFormat: SourceFormat;
  rawObjectKey: string;
  trackObjectKey: string | null;
  errorCode: string | null;
}

/** Результат конвейера: то, что известно после parse → clean → derive → pack. */
export interface ProcessedFlight {
  trackObjectKey: string;
  altitudeSource: AltitudeSource;
  analysisLevel: AnalysisLevel;
  startedAt: Date;
  endedAt: Date;
  durationS: number;
  /** Термики, глайды, ветер (ТЗ §6.2–6.5); null — трек 'basic', анализ не делался. */
  analysis: FlightAnalysis | null;
  /** NaN — высоты нет. */
  maxAltM: number;
  distanceTrackM: number;
  /** Линия для карты логбука (задача 2.11); null — точек меньше двух. */
  simplified: SimplifiedLine | null;
  /** Взлёт и посадка (задача 2.13): по ним — место старта и посадки. */
  takeoff: FlightPoint;
  landing: FlightPoint;
  /** Модель крыла из файла (IGC HFGTY); null — прибор не записал. */
  gliderRaw: string | null;
  /** IANA-таймзона точки взлёта (задача 2.14); null — точки нет. */
  timezone: string | null;
  /** Время в воздухе, с, и сумма подъёмов, м (задача 2.12). */
  airtimeS: number;
  totalGainM: number;
  /** XC-очки (задача 3.1); null — не посчитаны. */
  xc: XcScore | null;
}

const RECORD_COLUMNS = {
  id: flights.id,
  status: flights.status,
  sourceFormat: flights.sourceFormat,
  rawObjectKey: flights.rawObjectKey,
  trackObjectKey: flights.trackObjectKey,
  errorCode: flights.errorCode,
} as const;

export async function insertFlight(db: Database, flight: NewFlight): Promise<FlightRecord> {
  const [row] = await db
    .insert(flights)
    .values({
      ...(flight.id === undefined ? {} : { id: flight.id }),
      userId: flight.userId,
      sourceFormat: flight.sourceFormat,
      rawObjectKey: flight.rawObjectKey,
      claimTokenHash: flight.claimTokenHash ?? null,
      // Вошедший пилот — крыло по умолчанию сразу (задача 2.13б); сменит, если летал на другом.
      gliderId: flight.userId === null ? null : defaultGliderId(flight.userId),
    })
    .returning(RECORD_COLUMNS);
  if (!row) throw new Error('insertFlight returned no row');
  return row;
}

export async function findFlight(db: Database, id: string): Promise<FlightRecord | null> {
  const [row] = await db.select(RECORD_COLUMNS).from(flights).where(eq(flights.id, id)).limit(1);
  return row ?? null;
}

/** Взято в обработку: статус parsing, прошлая ошибка снимается. */
export async function markFlightProcessing(db: Database, id: string): Promise<void> {
  await db.update(flights).set({ status: 'parsing', errorCode: null, updatedAt: new Date() }).where(eq(flights.id, id));
}

export async function markFlightFailed(db: Database, id: string, errorCode: string): Promise<void> {
  await db.update(flights).set({ status: 'failed', errorCode, updatedAt: new Date() }).where(eq(flights.id, id));
}

/** Число для numeric/integer: NaN и бесконечность — null (иначе Postgres запишет 'NaN'). */
const finite = (value: number | null | undefined): number | null =>
  value === null || value === undefined || !Number.isFinite(value) ? null : value;
const whole = (value: number | null | undefined): number | null => {
  const v = finite(value);
  return v === null ? null : Math.round(v);
};
/** Направление в целых градусах [0, 360): 359.6° — это 0°, а не 360°. */
const FULL_TURN_DEG = 360;
const bearing = (value: number | null | undefined): number | null => {
  const v = whole(value);
  return v === null ? null : v % FULL_TURN_DEG;
};
/** Точка geography в EWKT: долгота, потом широта. */
const point = (lat: number, lon: number): string => `SRID=4326;POINT(${lon} ${lat})`;

const MS_PER_SECOND = 1000;

const pointOrNull = (p: FlightPoint): string | null =>
  Number.isFinite(p.lat) && Number.isFinite(p.lon) ? point(p.lat, p.lon) : null;

/**
 * Упрощённая линия в EWKT: X — долгота, Y — широта, Z — высота (нет — 0:
 * карта логбука высоту не рисует), M — секунды от первой точки.
 */
function lineZM(line: SimplifiedLine): string {
  const t0 = line.timeMs[0] ?? 0;
  const coords = line.lat.map((lat, i) => {
    const seconds = ((line.timeMs[i] ?? t0) - t0) / MS_PER_SECOND;
    return `${line.lon[i] ?? 0} ${lat} ${finite(line.altM[i]) ?? 0} ${seconds}`;
  });
  return `SRID=4326;LINESTRINGZM(${coords.join(', ')})`;
}

/**
 * Прямоугольник по крайним координатам. Грубый: стороны geography — дуги
 * большого круга, а не параллели; для отбора полётов в окне карты хватает.
 * Вырожденный (трек вдоль меридиана или параллели) — null: такой полигон невалиден.
 */
function bboxPolygon(line: SimplifiedLine): string | null {
  const minLat = Math.min(...line.lat);
  const maxLat = Math.max(...line.lat);
  const minLon = Math.min(...line.lon);
  const maxLon = Math.max(...line.lon);
  if (minLat === maxLat || minLon === maxLon) return null;
  return `SRID=4326;POLYGON((${minLon} ${minLat}, ${maxLon} ${minLat}, ${maxLon} ${maxLat}, ${minLon} ${maxLat}, ${minLon} ${minLat}))`;
}
/** Для колонок NOT NULL: не число — ошибка анализа, запись не должна пройти молча. */
const required = (value: number | null, column: string): number => {
  if (value === null) throw new Error(`${column}: not a finite number`);
  return value;
};

/**
 * Полёт обработан: статус ready, агрегаты и сегменты анализа — одной транзакцией.
 * Старые термики и глайды полёта удаляются: повторная обработка (восстановительный
 * проход воркера) заменяет анализ, а не дописывает.
 */
export async function markFlightReady(db: Database, id: string, result: ProcessedFlight): Promise<void> {
  const { analysis } = result;
  await db.transaction(async (tx) => {
    await tx
      .update(flights)
      .set({
        status: 'ready',
        errorCode: null,
        trackObjectKey: result.trackObjectKey,
        altitudeSource: result.altitudeSource,
        analysisLevel: result.analysisLevel,
        startedAt: result.startedAt,
        endedAt: result.endedAt,
        durationS: result.durationS,
        thermalCount: analysis ? analysis.thermals.length : null,
        avgClimbMs: finite(analysis?.avgClimbMs),
        avgGlideRatio: finite(analysis?.avgGlideRatio),
        windDirDeg: bearing(analysis?.wind?.dirDeg),
        windSpeedMs: finite(analysis?.wind?.speedMs),
        windProfile: analysis ? analysis.windProfile : null,
        maxAltM: whole(result.maxAltM),
        distanceTrackM: whole(result.distanceTrackM),
        trackSimplified: result.simplified ? lineZM(result.simplified) : null,
        bbox: result.simplified ? bboxPolygon(result.simplified) : null,
        takeoffPoint: pointOrNull(result.takeoff),
        landingPoint: pointOrNull(result.landing),
        takeoffAltM: whole(result.takeoff.altM),
        landingAltM: whole(result.landing.altM),
        // Место — ближайшее известное в SITE.matchRadiusM; нет — null, пилот добавит сам.
        takeoffSiteId: nearestSiteId(result.takeoff),
        gliderRaw: result.gliderRaw,
        timezone: result.timezone,
        airtimeS: whole(result.airtimeS),
        totalGainM: whole(result.totalGainM),
        xcType: result.xc?.type ?? null,
        xcDistanceM: result.xc?.distanceM ?? null,
        xcScore: result.xc?.score ?? null,
        // Регламент, по которому считали, — и когда результата нет (в воздухе меньше
        // пяти точек): иначе догрузка при каждом старте воркера брала бы полёт снова.
        xcRules: result.xc?.rules ?? (result.analysisLevel === 'full' ? XC.defaultRules : null),
        xcIsOptimal: result.xc?.optimal ?? null,
        xcTurnpoints: result.xc,
        // Дата полёта для пилота — по часам места старта: вечерний полёт в Алматы
        // по UTC был бы «вчера». Без таймзоны — дата UTC.
        localDate: sql`(${result.startedAt.toISOString()}::timestamptz AT TIME ZONE ${result.timezone ?? 'UTC'})::date`,
        landingSiteId: nearestSiteId(result.landing),
        updatedAt: new Date(),
      })
      .where(eq(flights.id, id));
    await tx.delete(thermals).where(eq(thermals.flightId, id));
    await tx.delete(glides).where(eq(glides.flightId, id));
    if (!analysis) return;

    if (analysis.thermals.length > 0) {
      await tx.insert(thermals).values(
        analysis.thermals.map((t, seq) => ({
          flightId: id,
          seq,
          startedAt: new Date(t.startTimeMs),
          endedAt: new Date(t.endTimeMs),
          durationS: required(whole(t.durationS), 'thermals.duration_s'),
          entryAltM: required(whole(t.entryAltM), 'thermals.entry_alt_m'),
          exitAltM: required(whole(t.exitAltM), 'thermals.exit_alt_m'),
          gainM: required(whole(t.gainM), 'thermals.gain_m'),
          avgClimbMs: required(finite(t.avgClimbMs), 'thermals.avg_climb_ms'),
          maxClimbMs: required(finite(t.maxClimbMs), 'thermals.max_climb_ms'),
          turnCount: required(finite(t.turnCount), 'thermals.turn_count'),
          avgRadiusM: required(whole(t.avgRadiusM), 'thermals.avg_radius_m'),
          direction: t.direction,
          efficiency: required(finite(t.efficiency), 'thermals.efficiency'),
          entryPoint: point(t.entryLat, t.entryLon),
          exitPoint: point(t.exitLat, t.exitLon),
          // Снос — уже метеорологический, «откуда дует» (CLAUDE.md, «Единицы»).
          driftDirDeg: bearing(t.drift?.dirDeg),
          driftSpeedMs: finite(t.drift?.speedMs),
        })),
      );
    }
    if (analysis.glides.length > 0) {
      await tx.insert(glides).values(
        analysis.glides.map((g, seq) => ({
          flightId: id,
          seq,
          startedAt: new Date(g.startTimeMs),
          endedAt: new Date(g.endTimeMs),
          distanceM: required(whole(g.distanceM), 'glides.distance_m'),
          altLossM: required(whole(g.altLossM), 'glides.alt_loss_m'),
          glideRatio: finite(g.glideRatio),
          kind: g.kind,
          avgSpeedMs: required(finite(g.avgGroundSpeedMs), 'glides.avg_speed_ms'),
          headingDeg: bearing(g.headingDeg),
          headingConsistency: required(finite(g.headingConsistency), 'glides.heading_consistency'),
        })),
      );
    }
  });
}

/**
 * Удаление полётов по списку id: уборка анонимных загрузок по TTL 30 дней
 * (ТЗ §11.2) и чистка после тестов. Возвращает число удалённых строк.
 */
export async function deleteFlights(db: Database, ids: readonly string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const deleted = await db
    .delete(flights)
    .where(inArray(flights.id, [...ids]))
    .returning({ id: flights.id });
  return deleted.length;
}

/** Просроченная анонимная загрузка: что удалить из хранилища вместе со строкой. */
export interface ExpiredFlight {
  id: string;
  rawObjectKey: string;
  /** null — полёт не дошёл до упаковки .track. */
  trackObjectKey: string | null;
}

/**
 * Анонимные полёты, загруженные раньше `before` (ТЗ §11.2, TTL 30 дней),
 * старые первыми, не больше `limit`. Опирается на частичный индекс
 * flights_anonymous_created_idx — полёты пилотов его не раздувают.
 */
export async function listExpiredAnonymousFlights(
  db: Database,
  before: Date,
  limit: number,
): Promise<ExpiredFlight[]> {
  return db
    .select({ id: flights.id, rawObjectKey: flights.rawObjectKey, trackObjectKey: flights.trackObjectKey })
    .from(flights)
    .where(and(isNull(flights.userId), lt(flights.createdAt, before)))
    .orderBy(asc(flights.createdAt))
    .limit(limit);
}

/** Восстановительный проход воркера: всё, что застряло в pending, parsing или analyzing. */
export async function listUnfinishedFlights(db: Database): Promise<FlightRecord[]> {
  return db
    .select(RECORD_COLUMNS)
    .from(flights)
    .where(inArray(flights.status, [...UNFINISHED_FLIGHT_STATUSES]))
    .orderBy(flights.createdAt);
}

/**
 * Разовая догрузка производных данных: полёты, обработанные до задачи 2.11
 * (нет сводки и линии для карты), 2.13 (нет точки взлёта для места старта)
 * 2.14 (нет таймзоны), 2.12 (нет времени в воздухе и суммарного набора)
 * или 3.1 (нет XC-очков у полноценного трека),
 * возвращаются в очередь — их подберёт обычное восстановление при старте
 * воркера. После обработки обе колонки заполнены, повторно полёт не попадёт.
 */
export async function requeueFlightsForBackfill(db: Database): Promise<number> {
  const rows = await db
    .update(flights)
    .set({ status: 'pending', updatedAt: new Date() })
    .where(
      and(
        eq(flights.status, 'ready'),
        or(
          isNull(flights.distanceTrackM),
          isNull(flights.takeoffPoint),
          isNull(flights.timezone),
          isNull(flights.airtimeS),
          // Полноценный трек без XC — обработан до задачи 3.1.
          and(eq(flights.analysisLevel, 'full'), isNull(flights.xcRules)),
        ),
      ),
    )
    .returning({ id: flights.id });
  return rows.length;
}
