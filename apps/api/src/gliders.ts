import { FlightPatch, GliderDto, GliderInput, GlidersResponse } from '@skyline/core';
import type { GliderRecord, SetFlightGliderResult } from '@skyline/db';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { problem, sendProblem } from './problem.js';

/**
 * Крылья пилота и крыло полёта (задача 2.13б, ТЗ §10): GET/POST /gliders,
 * PATCH/DELETE /gliders/{id}, PATCH /flights/{id}. Только для вошедшего.
 */

export interface GliderRoutesDeps {
  list(userId: string): Promise<GliderRecord[]>;
  /** null — у пилота уже максимум крыльев. */
  create(userId: string, input: GliderInput): Promise<GliderRecord | null>;
  update(userId: string, id: string, input: GliderInput): Promise<GliderRecord | null>;
  remove(userId: string, id: string): Promise<boolean>;
  setFlightGlider(args: { flightId: string; userId: string; gliderId: string | null }): Promise<SetFlightGliderResult>;
}

const HTTP = { created: 201, noContent: 204, badRequest: 400, unauthorized: 401, notFound: 404, conflict: 409 } as const;
const IdParams = z.object({ id: z.uuid() });

export function registerGliderRoutes(app: FastifyInstance, deps: GliderRoutesDeps): void {
  const requireUser = async (request: FastifyRequest, reply: FastifyReply): Promise<string | null> => {
    if (request.userId) return request.userId;
    await sendProblem(reply, problem(HTTP.unauthorized, { detail: 'Sign in to manage gliders' }));
    return null;
  };

  /** id из пути и тело по схеме; null — ответ с ошибкой уже отправлен. */
  const parse = async <T>(
    schema: z.ZodType<T>,
    value: unknown,
    reply: FastifyReply,
  ): Promise<T | null> => {
    const parsed = schema.safeParse(value);
    if (parsed.success) return parsed.data;
    await sendProblem(reply, problem(HTTP.badRequest, { detail: z.prettifyError(parsed.error) }));
    return null;
  };

  const gliderNotFound = (reply: FastifyReply) => sendProblem(reply, problem(HTTP.notFound, { detail: 'Glider not found' }));

  app.get('/gliders', async (request, reply) => {
    const userId = await requireUser(request, reply);
    if (!userId) return reply;
    return reply.send(GlidersResponse.parse({ gliders: await deps.list(userId) }));
  });

  app.post('/gliders', async (request, reply) => {
    const userId = await requireUser(request, reply);
    if (!userId) return reply;
    const input = await parse(GliderInput, request.body, reply);
    if (!input) return reply;
    const glider = await deps.create(userId, input);
    if (!glider) return sendProblem(reply, problem(HTTP.conflict, { detail: 'Too many gliders' }));
    return reply.code(HTTP.created).send(GliderDto.parse(glider));
  });

  app.patch('/gliders/:id', async (request, reply) => {
    const userId = await requireUser(request, reply);
    if (!userId) return reply;
    const params = await parse(IdParams, request.params, reply);
    const input = params && (await parse(GliderInput, request.body, reply));
    if (!params || !input) return reply;
    const glider = await deps.update(userId, params.id, input);
    return glider ? reply.send(GliderDto.parse(glider)) : gliderNotFound(reply);
  });

  app.delete('/gliders/:id', async (request, reply) => {
    const userId = await requireUser(request, reply);
    if (!userId) return reply;
    const params = await parse(IdParams, request.params, reply);
    if (!params) return reply;
    return (await deps.remove(userId, params.id)) ? reply.code(HTTP.noContent).send() : gliderNotFound(reply);
  });

  app.patch('/flights/:id', async (request, reply) => {
    const userId = await requireUser(request, reply);
    if (!userId) return reply;
    const params = await parse(IdParams, request.params, reply);
    const patch = params && (await parse(FlightPatch, request.body, reply));
    if (!params || !patch) return reply;
    const result = await deps.setFlightGlider({ flightId: params.id, userId, gliderId: patch.gliderId });
    if (result === 'flight_not_found') {
      return sendProblem(reply, problem(HTTP.notFound, { detail: 'Flight not found among your flights' }));
    }
    if (result === 'glider_not_found') return gliderNotFound(reply);
    return reply.code(HTTP.noContent).send();
  });
}
