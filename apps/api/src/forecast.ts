import {
  FORECAST,
  FORECAST_ATTRIBUTION,
  ForecastMapResponse,
  ForecastSiteResponse,
  type ForecastHour,
  type ForecastHourDto,
  type ForecastSiteDto,
} from '@skyline/core';
import type { SiteForecastRecord } from '@skyline/db';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { problem, sendProblem } from './problem.js';

/**
 * Прогноз для пилотов (ТЗ §6.9, задача П.2): без входа. Воркер обновляет его
 * раз в 6 ч — ответ можно кэшировать на минуты.
 */

export interface ForecastRoutesDeps {
  list(): Promise<SiteForecastRecord[]>;
}

const HTTP = { notFound: 404 } as const;
/** Кэш ответа, с: прогноз меняется раз в 6 ч, проверка воркера — раз в 10 мин. */
const CACHE_MAX_AGE_S = FORECAST.checkIntervalS;
const Params = z.object({ slug: z.string().min(1).max(200) });

const iso = (timeMs: number): string => new Date(timeMs).toISOString();

const siteDto = (record: SiteForecastRecord): ForecastSiteDto => ({
  slug: record.slug,
  name: record.name,
  lat: record.lat,
  lon: record.lon,
  elevationM: record.elevationM,
  timezone: record.timezone,
  windSectors: record.windSectors,
  maxWindMs: record.maxWindMs ?? FORECAST.defaultMaxWindMs,
  fetchedAt: (record.fetchedAt ?? new Date(0)).toISOString(),
});

const hourDto = ({ timeMs, ...hour }: ForecastHour): ForecastHourDto => ({ time: iso(timeMs), ...hour });

export function registerForecastRoutes(app: FastifyInstance, deps: ForecastRoutesDeps): void {
  app.get('/forecast', async (_request, reply) => {
    const sites = await deps.list();
    reply.header('cache-control', `public, max-age=${CACHE_MAX_AGE_S}`);
    return reply.send(
      ForecastMapResponse.parse({
        sites: sites.map((record) => ({
          ...siteDto(record),
          hours: record.hours.map((hour) => {
            const primary = hour.models[0];
            return {
              time: iso(hour.timeMs),
              verdict: hour.verdict,
              confidence: hour.confidence,
              windSpeedMs: primary?.windSpeedMs ?? 0,
              windDirDeg: primary?.windDirDeg ?? 0,
              ceilingM: primary?.ceilingM ?? null,
            };
          }),
        })),
        attribution: FORECAST_ATTRIBUTION,
      }),
    );
  });

  app.get('/forecast/:slug', async (request, reply) => {
    const params = Params.safeParse(request.params);
    const record = params.success ? (await deps.list()).find((site) => site.slug === params.data.slug) : undefined;
    if (!record) return sendProblem(reply, problem(HTTP.notFound, { detail: 'No forecast for this site' }));
    reply.header('cache-control', `public, max-age=${CACHE_MAX_AGE_S}`);
    return reply.send(
      ForecastSiteResponse.parse({ site: siteDto(record), hours: record.hours.map(hourDto), attribution: FORECAST_ATTRIBUTION }),
    );
  });
}
