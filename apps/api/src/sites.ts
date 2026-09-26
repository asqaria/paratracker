import { CreateSiteRequest, SiteSummary } from '@skyline/core';
import type { CreateSiteResult } from '@skyline/db';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { problem, sendProblem } from './problem.js';

/**
 * Места старта (задача 2.13): пилот добавляет место своего полёта, если рядом
 * нет известного. Точка — взлёт полёта, таймзона — по координатам.
 */

export interface SiteRoutesDeps {
  create(args: { flightId: string; userId: string; name: string }): Promise<CreateSiteResult>;
}

const HTTP = { created: 201, badRequest: 400, unauthorized: 401, notFound: 404, conflict: 409 } as const;

export function registerSiteRoutes(app: FastifyInstance, deps: SiteRoutesDeps): void {
  app.post('/sites', async (request, reply) => {
    const { userId } = request;
    if (!userId) return sendProblem(reply, problem(HTTP.unauthorized, { detail: 'Sign in to add a site' }));

    const body = CreateSiteRequest.safeParse(request.body);
    if (!body.success) return sendProblem(reply, problem(HTTP.badRequest, { detail: z.prettifyError(body.error) }));

    const result = await deps.create({ ...body.data, userId });
    switch (result.kind) {
      case 'created':
        request.log.info({ userId, flightId: body.data.flightId, siteId: result.site.id }, 'site created by pilot');
        return reply.code(HTTP.created).send(SiteSummary.parse(result.site));
      case 'not_found':
        return sendProblem(reply, problem(HTTP.notFound, { detail: 'Flight not found among your flights' }));
      case 'has_site':
        return sendProblem(reply, problem(HTTP.conflict, { detail: 'The flight already has a takeoff site' }));
      case 'no_takeoff':
        return sendProblem(reply, problem(HTTP.conflict, { detail: 'The flight is not processed yet' }));
    }
  });
}
