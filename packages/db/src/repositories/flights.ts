import {
  UNFINISHED_FLIGHT_STATUSES,
  type AltitudeSource,
  type AnalysisLevel,
  type FlightAnalysis,
  type FlightStatus,
  type SourceFormat,
} from '@skyline/core';
import { and, asc, eq, inArray, isNull, lt } from 'drizzle-orm';

import type { Database } from '../client.js';
import { flights, glides, thermals } from '../schema.js';

/** Репозиторий полётов: наружу отдаются типизированные записи, не строки БД. */

export interface NewFlight {
  /** Задаётся вызывающим: ключ сырого файла в S3 содержит id полёта. */
  id?: string;
  /** null — анонимная загрузка (ТЗ §11.2, TTL 30 дней). */
  userId: string | null;
  sourceFormat: SourceFormat;
  rawObjectKey: string;
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
