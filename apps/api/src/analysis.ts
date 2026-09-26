import {
  FlightDetailsResponse,
  gliderLabel,
  GlidesResponse,
  thermalStrength,
  ThermalsResponse,
  WindResponse,
  type WindDto,
} from '@skyline/core';
import type { FlightDetailsRecord, GlideRecord, ThermalRecord } from '@skyline/db';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { shareOf, viewOf } from './access.js';
import { problem, sendProblem } from './problem.js';

/**
 * Аналитика полёта (ТЗ §10): детали с агрегатами, термики, глайды, ветер.
 * Ответы — схемы из core; записи репозитория в них переводятся здесь.
 */

export interface AnalysisRoutesDeps {
  details(id: string): Promise<FlightDetailsRecord | null>;
  thermals(flightId: string): Promise<ThermalRecord[]>;
  glides(flightId: string): Promise<GlideRecord[]>;
}

const HTTP = { badRequest: 400, notFound: 404, conflict: 409 } as const;
const FlightIdParams = z.object({ id: z.uuid() });

const iso = (date: Date | null): string | null => (date === null ? null : date.toISOString());
const wind = (dirDeg: number | null, speedMs: number | null): WindDto | null =>
  dirDeg === null || speedMs === null ? null : { dirDeg, speedMs };

/** viewerId — вошедший; владельцу можно добавить место старта и править полёт. */
function toDetails(flight: FlightDetailsRecord, viewerId: string | null): FlightDetailsResponse {
  return FlightDetailsResponse.parse({
    flightId: flight.id,
    status: flight.status,
    analysisLevel: flight.analysisLevel,
    startedAt: iso(flight.startedAt),
    endedAt: iso(flight.endedAt),
    durationS: flight.durationS,
    timezone: flight.timezone,
    thermalCount: flight.thermalCount,
    avgClimbMs: flight.avgClimbMs,
    avgGlideRatio: flight.avgGlideRatio,
    wind: wind(flight.windDirDeg, flight.windSpeedMs),
    takeoffSite: flight.takeoffSite,
    landingSite: flight.landingSite,
    glider: flight.glider ? { id: flight.glider.id, label: gliderLabel(flight.glider) } : null,
    gliderRaw: flight.gliderRaw,
    xc: flight.xc,
    pilotName: flight.pilotName,
    canEdit: viewerId !== null && viewerId === flight.userId,
    privacy: flight.privacy,
  });
}

function toThermals(rows: ThermalRecord[]): ThermalsResponse {
  return ThermalsResponse.parse({
    thermals: rows.map((t) => ({
      seq: t.seq,
      startedAt: t.startedAt.toISOString(),
      endedAt: t.endedAt.toISOString(),
      durationS: t.durationS,
      entryAltM: t.entryAltM,
      exitAltM: t.exitAltM,
      gainM: t.gainM,
      avgClimbMs: t.avgClimbMs,
      maxClimbMs: t.maxClimbMs,
      turnCount: t.turnCount,
      avgRadiusM: t.avgRadiusM,
      direction: t.direction,
      efficiency: t.efficiency,
      strength: thermalStrength(t.avgClimbMs),
      entry: { lat: t.entryLat, lon: t.entryLon },
      exit: { lat: t.exitLat, lon: t.exitLon },
      drift: wind(t.driftDirDeg, t.driftSpeedMs),
    })),
  });
}

function toGlides(rows: GlideRecord[]): GlidesResponse {
  return GlidesResponse.parse({
    glides: rows.map((g) => ({
      seq: g.seq,
      startedAt: g.startedAt.toISOString(),
      endedAt: g.endedAt.toISOString(),
      distanceM: g.distanceM,
      altLossM: g.altLossM,
      glideRatio: g.glideRatio,
      kind: g.kind,
      avgSpeedMs: g.avgSpeedMs,
      headingDeg: g.headingDeg,
      headingConsistency: g.headingConsistency,
    })),
  });
}

export function registerAnalysisRoutes(app: FastifyInstance, deps: AnalysisRoutesDeps): void {
  /** Полёт по id из пути; null — ответ с ошибкой уже отправлен. */
  const flightOf = async (request: FastifyRequest, reply: FastifyReply): Promise<FlightDetailsRecord | null> => {
    const parsed = FlightIdParams.safeParse(request.params);
    if (!parsed.success) {
      await sendProblem(reply, problem(HTTP.badRequest, { detail: 'Flight id must be a UUID' }));
      return null;
    }
    const flight = await deps.details(parsed.data.id);
    // Не видит — тот же 404, что и для несуществующего (задача 3.7).
    if (!flight || !viewOf(flight, request.userId, shareOf(request.query))) {
      await sendProblem(reply, problem(HTTP.notFound, { detail: `Flight ${parsed.data.id} not found` }));
      return null;
    }
    return flight;
  };

  /** Сегменты и ветер есть только у обработанного полёта — как .track (409). */
  const readyFlightOf = async (request: FastifyRequest, reply: FastifyReply): Promise<FlightDetailsRecord | null> => {
    const flight = await flightOf(request, reply);
    if (!flight) return null;
    if (flight.status !== 'ready') {
      await sendProblem(
        reply,
        problem(HTTP.conflict, { detail: `Flight ${flight.id} is not processed yet: status ${flight.status}` }),
      );
      return null;
    }
    return flight;
  };

  app.get('/flights/:id', async (request, reply) => {
    const flight = await flightOf(request, reply);
    return flight ? reply.send(toDetails(flight, request.userId)) : reply;
  });

  app.get('/flights/:id/thermals', async (request, reply) => {
    const flight = await readyFlightOf(request, reply);
    return flight ? reply.send(toThermals(await deps.thermals(flight.id))) : reply;
  });

  app.get('/flights/:id/glides', async (request, reply) => {
    const flight = await readyFlightOf(request, reply);
    return flight ? reply.send(toGlides(await deps.glides(flight.id))) : reply;
  });

  app.get('/flights/:id/wind', async (request, reply) => {
    const flight = await readyFlightOf(request, reply);
    if (!flight) return reply;
    return reply.send(
      WindResponse.parse({ flight: wind(flight.windDirDeg, flight.windSpeedMs), profile: flight.windProfile ?? [] }),
    );
  });
}
