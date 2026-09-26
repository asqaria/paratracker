import type { AnalysisLevel, FlightStatus, GlideKind, TurnDirection, WindBand } from '@skyline/core';
import { asc, eq, sql, type AnyColumn } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import type { Database } from '../client.js';
import { flights, glides, gliders, sites, thermals } from '../schema.js';
import { GLIDER_COLUMNS, type GliderRef } from './gliders.js';
import type { SiteRecord } from './sites.js';

/**
 * Чтение анализа полёта (ТЗ §10: GET /flights/{id}, /thermals, /glides, /wind).
 * Наружу — типизированные записи; точки geography разбирает PostGIS, а не код.
 */

export interface FlightDetailsRecord {
  id: string;
  status: FlightStatus;
  analysisLevel: AnalysisLevel | null;
  startedAt: Date | null;
  endedAt: Date | null;
  durationS: number | null;
  timezone: string | null;
  thermalCount: number | null;
  avgClimbMs: number | null;
  avgGlideRatio: number | null;
  /** Метеорологическое, откуда дует. */
  windDirDeg: number | null;
  windSpeedMs: number | null;
  windProfile: WindBand[] | null;
  /** Владелец; null — анонимная загрузка. */
  userId: string | null;
  takeoffSite: SiteRecord | null;
  landingSite: SiteRecord | null;
  glider: GliderRef | null;
  gliderRaw: string | null;
}

export interface ThermalRecord {
  seq: number;
  startedAt: Date;
  endedAt: Date;
  durationS: number;
  entryAltM: number;
  exitAltM: number;
  gainM: number;
  avgClimbMs: number;
  maxClimbMs: number;
  turnCount: number;
  avgRadiusM: number;
  direction: TurnDirection;
  efficiency: number;
  entryLat: number;
  entryLon: number;
  exitLat: number;
  exitLon: number;
  driftDirDeg: number | null;
  driftSpeedMs: number | null;
}

export interface GlideRecord {
  seq: number;
  startedAt: Date;
  endedAt: Date;
  distanceM: number;
  altLossM: number;
  glideRatio: number | null;
  kind: GlideKind;
  avgSpeedMs: number;
  headingDeg: number | null;
  headingConsistency: number;
}

/** Место старта и посадки — одна таблица, два соединения. */
const takeoffSites = alias(sites, 'takeoff_site');
const landingSites = alias(sites, 'landing_site');

export async function findFlightDetails(db: Database, id: string): Promise<FlightDetailsRecord | null> {
  const [row] = await db
    .select({
      id: flights.id,
      status: flights.status,
      analysisLevel: flights.analysisLevel,
      startedAt: flights.startedAt,
      endedAt: flights.endedAt,
      durationS: flights.durationS,
      timezone: flights.timezone,
      thermalCount: flights.thermalCount,
      avgClimbMs: flights.avgClimbMs,
      avgGlideRatio: flights.avgGlideRatio,
      windDirDeg: flights.windDirDeg,
      windSpeedMs: flights.windSpeedMs,
      windProfile: flights.windProfile,
      userId: flights.userId,
      // Drizzle отдаёт вложенный объект left join как null, если места нет.
      takeoffSite: {
        id: takeoffSites.id,
        name: takeoffSites.name,
        countryCode: takeoffSites.countryCode,
        source: takeoffSites.source,
      },
      landingSite: {
        id: landingSites.id,
        name: landingSites.name,
        countryCode: landingSites.countryCode,
        source: landingSites.source,
      },
      glider: GLIDER_COLUMNS,
      gliderRaw: flights.gliderRaw,
    })
    .from(flights)
    .leftJoin(takeoffSites, eq(takeoffSites.id, flights.takeoffSiteId))
    .leftJoin(landingSites, eq(landingSites.id, flights.landingSiteId))
    .leftJoin(gliders, eq(gliders.id, flights.gliderId))
    .where(eq(flights.id, id))
    .limit(1);
  return row ?? null;
}

/** Широта и долгота точки geography: ST_Y/ST_X работают с geometry — приведение без пересчёта. */
const latOf = (column: AnyColumn) => sql<number>`ST_Y(${column}::geometry)`.mapWith(Number);
const lonOf = (column: AnyColumn) => sql<number>`ST_X(${column}::geometry)`.mapWith(Number);

export async function listThermals(db: Database, flightId: string): Promise<ThermalRecord[]> {
  return db
    .select({
      seq: thermals.seq,
      startedAt: thermals.startedAt,
      endedAt: thermals.endedAt,
      durationS: thermals.durationS,
      entryAltM: thermals.entryAltM,
      exitAltM: thermals.exitAltM,
      gainM: thermals.gainM,
      avgClimbMs: thermals.avgClimbMs,
      maxClimbMs: thermals.maxClimbMs,
      turnCount: thermals.turnCount,
      avgRadiusM: thermals.avgRadiusM,
      direction: thermals.direction,
      efficiency: thermals.efficiency,
      entryLat: latOf(thermals.entryPoint),
      entryLon: lonOf(thermals.entryPoint),
      exitLat: latOf(thermals.exitPoint),
      exitLon: lonOf(thermals.exitPoint),
      driftDirDeg: thermals.driftDirDeg,
      driftSpeedMs: thermals.driftSpeedMs,
    })
    .from(thermals)
    .where(eq(thermals.flightId, flightId))
    .orderBy(asc(thermals.seq));
}

export async function listGlides(db: Database, flightId: string): Promise<GlideRecord[]> {
  return db
    .select({
      seq: glides.seq,
      startedAt: glides.startedAt,
      endedAt: glides.endedAt,
      distanceM: glides.distanceM,
      altLossM: glides.altLossM,
      glideRatio: glides.glideRatio,
      kind: glides.kind,
      avgSpeedMs: glides.avgSpeedMs,
      headingDeg: glides.headingDeg,
      headingConsistency: glides.headingConsistency,
    })
    .from(glides)
    .where(eq(glides.flightId, flightId))
    .orderBy(asc(glides.seq));
}
