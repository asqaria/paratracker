import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { problem, sendProblem } from './problem.js';

/**
 * Прокси тайлов Esri World Imagery (ТЗ §4.4.1). Ключ ArcGIS Location Platform
 * живёт только на сервере — в бандл фронта он не попадает (CLAUDE.md).
 *
 * Кэширование тайлов Esri ограничено условиями лицензии, поэтому ответы идут
 * с no-store: своё хранение и раздача через собственный CDN требуют отдельной
 * юридической проверки (ТЗ §4.4.1, §11.3).
 */

export interface TileRoutesDeps {
  /** Шаблон с {z}, {y}, {x}; null — прокси выключен. */
  tileUrlTemplate: string | null;
  apiKey: string | null;
  fetchImpl?: typeof fetch;
}

const HTTP = { badRequest: 400, serviceUnavailable: 503, badGateway: 502 } as const;
const MAX_ZOOM = 23;
const TILE_TIMEOUT_S = 10;
const MS_PER_SECOND = 1000;

const TileParams = z.object({
  z: z.coerce.number().int().min(0).max(MAX_ZOOM),
  y: z.coerce.number().int().min(0),
  x: z.coerce.number().int().min(0),
});

export function registerTileRoutes(app: FastifyInstance, deps: TileRoutesDeps): void {
  const fetchTile = deps.fetchImpl ?? fetch;

  app.get('/tiles/esri/:z/:y/:x', async (request, reply) => {
    if (deps.tileUrlTemplate === null || deps.apiKey === null) {
      return sendProblem(
        reply,
        problem(HTTP.serviceUnavailable, {
          detail: 'Esri imagery is not configured: set ARCGIS_API_KEY and ARCGIS_TILE_URL',
        }),
      );
    }

    const params = TileParams.safeParse(request.params);
    if (!params.success) {
      return sendProblem(reply, problem(HTTP.badRequest, { detail: 'Tile coordinates must be non-negative integers' }));
    }

    const { z, y, x } = params.data;
    const url = new URL(
      deps.tileUrlTemplate.replace('{z}', String(z)).replace('{y}', String(y)).replace('{x}', String(x)),
    );
    url.searchParams.set('token', deps.apiKey);

    let upstream: Response;
    try {
      upstream = await fetchTile(url, { signal: AbortSignal.timeout(TILE_TIMEOUT_S * MS_PER_SECOND) });
    } catch (error) {
      request.log.warn({ err: error, z, y, x }, 'esri tile request failed');
      return sendProblem(reply, problem(HTTP.badGateway, { detail: 'Imagery provider is unavailable' }));
    }

    if (!upstream.ok) {
      request.log.warn({ status: upstream.status, z, y, x }, 'esri tile request rejected');
      return sendProblem(reply, problem(HTTP.badGateway, { detail: `Imagery provider answered ${upstream.status}` }));
    }

    return reply
      .type(upstream.headers.get('content-type') ?? 'image/jpeg')
      .header('cache-control', 'no-store')
      .send(Buffer.from(await upstream.arrayBuffer()));
  });
}
