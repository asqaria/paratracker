import { ThermalReviewLabels, ThermalReviewResponse, toLabelsFile, EMPTY_REVIEW } from '@skyline/core';
import type { ThermalReviewRecord } from '@skyline/db';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { problem, sendProblem } from './problem.js';

/**
 * Сверка термиков владельцем полёта (DoD фазы 2): GET/PUT разметки и выгрузка
 * в формате /fixtures/*.labels.json — из неё регрессионный тест детекции.
 */

export interface ReviewRoutesDeps {
  find(flightId: string, userId: string): Promise<{ review: ThermalReviewRecord | null; startedAt: Date | null } | null>;
  save(args: { flightId: string; userId: string; labels: ThermalReviewLabels }): Promise<boolean>;
}

const HTTP = { noContent: 204, badRequest: 400, unauthorized: 401, notFound: 404, conflict: 409 } as const;
const IdParams = z.object({ id: z.uuid() });

export function registerReviewRoutes(app: FastifyInstance, deps: ReviewRoutesDeps): void {
  const notFound = 'Flight not found among your flights';

  app.get('/flights/:id/review', async (request, reply) => {
    if (!request.userId) return sendProblem(reply, problem(HTTP.unauthorized, { detail: 'Sign in to review' }));
    const params = IdParams.safeParse(request.params);
    if (!params.success) return sendProblem(reply, problem(HTTP.badRequest, { detail: 'Flight id must be a UUID' }));
    const found = await deps.find(params.data.id, request.userId);
    if (!found) return sendProblem(reply, problem(HTTP.notFound, { detail: notFound }));
    return reply.send(
      ThermalReviewResponse.parse({
        labels: found.review?.labels ?? EMPTY_REVIEW,
        updatedAt: found.review?.updatedAt.toISOString() ?? null,
      }),
    );
  });

  app.put('/flights/:id/review', async (request, reply) => {
    if (!request.userId) return sendProblem(reply, problem(HTTP.unauthorized, { detail: 'Sign in to review' }));
    const params = IdParams.safeParse(request.params);
    const body = ThermalReviewLabels.safeParse(request.body);
    if (!params.success || !body.success) {
      const detail = body.success ? 'Flight id must be a UUID' : z.prettifyError(body.error);
      return sendProblem(reply, problem(HTTP.badRequest, { detail }));
    }
    const saved = await deps.save({ flightId: params.data.id, userId: request.userId, labels: body.data });
    if (!saved) return sendProblem(reply, problem(HTTP.notFound, { detail: notFound }));
    request.log.info({ flightId: params.data.id, userId: request.userId }, 'thermal review saved');
    return reply.code(HTTP.noContent).send();
  });

  /** Выгрузка для /fixtures: имя файла — по id полёта, время — от начала трека. */
  app.get('/flights/:id/review/labels.json', async (request, reply) => {
    if (!request.userId) return sendProblem(reply, problem(HTTP.unauthorized, { detail: 'Sign in to review' }));
    const params = IdParams.safeParse(request.params);
    if (!params.success) return sendProblem(reply, problem(HTTP.badRequest, { detail: 'Flight id must be a UUID' }));
    const found = await deps.find(params.data.id, request.userId);
    if (!found) return sendProblem(reply, problem(HTTP.notFound, { detail: notFound }));
    if (!found.review || !found.startedAt) {
      return sendProblem(reply, problem(HTTP.conflict, { detail: 'No review for this flight yet' }));
    }
    const file = `${params.data.id}.igc`;
    return reply
      .header('content-disposition', `attachment; filename="${params.data.id}.labels.json"`)
      .send(toLabelsFile(found.review.labels, file, found.startedAt.getTime(), found.review.updatedAt.toISOString()));
  });
}
