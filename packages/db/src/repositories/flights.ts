import {
  UNFINISHED_FLIGHT_STATUSES,
  type AltitudeSource,
  type AnalysisLevel,
  type FlightStatus,
  type SourceFormat,
} from '@skyline/core';
import { eq, inArray } from 'drizzle-orm';

import type { Database } from '../client.js';
import { flights } from '../schema.js';

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

export async function markFlightReady(db: Database, id: string, result: ProcessedFlight): Promise<void> {
  await db
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
      updatedAt: new Date(),
    })
    .where(eq(flights.id, id));
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

/** Восстановительный проход воркера: всё, что застряло в pending, parsing или analyzing. */
export async function listUnfinishedFlights(db: Database): Promise<FlightRecord[]> {
  return db
    .select(RECORD_COLUMNS)
    .from(flights)
    .where(inArray(flights.status, [...UNFINISHED_FLIGHT_STATUSES]))
    .orderBy(flights.createdAt);
}
