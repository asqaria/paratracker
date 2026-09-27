import { CommentDto, CommentsResponse, NewComment } from '@skyline/core';
import type { CommentRecord, CommentRef, FlightRecord } from '@skyline/db';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { shareOf, viewOf } from './access.js';
import { problem, sendProblem } from './problem.js';

/**
 * Комментарии к полёту (задача 3.10б, ТЗ §10). Читать — всем, кто видит полёт;
 * писать — любому вошедшему из них (решение владельца 27.09.2026); удалять —
 * автору и владельцу полёта. Ответы — только на комментарий верхнего уровня.
 */

export interface CommentRoutesDeps {
  flight(id: string): Promise<FlightRecord | null>;
  list(flightId: string): Promise<CommentRecord[]>;
  find(id: string): Promise<CommentRef | null>;
  add(comment: { flightId: string; userId: string; parentId: string | null; body: string; timecodeS: number | null }): Promise<string>;
  remove(id: string): Promise<void>;
}

const HTTP = { created: 201, noContent: 204, badRequest: 400, unauthorized: 401, forbidden: 403, notFound: 404 } as const;
const FlightParams = z.object({ id: z.uuid() });
const CommentParams = z.object({ id: z.uuid(), commentId: z.uuid() });

const toDto = (record: CommentRecord, viewerId: string | null, ownerId: string | null): CommentDto =>
  CommentDto.parse({
    id: record.id,
    parentId: record.parentId,
    author: record.author,
    body: record.body,
    timecodeS: record.timecodeS,
    createdAt: record.createdAt.toISOString(),
    canDelete: record.body !== null && viewerId !== null && (viewerId === record.userId || viewerId === ownerId),
  });

export function registerCommentRoutes(app: FastifyInstance, deps: CommentRoutesDeps): void {
  /** Полёт, который спрашивающий видит; null — ответ уже отправлен. */
  const visibleFlight = async (request: FastifyRequest, reply: FastifyReply, id: string): Promise<FlightRecord | null> => {
    const flight = await deps.flight(id);
    if (!flight || !viewOf(flight, request.userId, shareOf(request.query))) {
      await sendProblem(reply, problem(HTTP.notFound, { detail: `Flight ${id} not found` }));
      return null;
    }
    return flight;
  };

  app.get('/flights/:id/comments', async (request, reply) => {
    const params = FlightParams.safeParse(request.params);
    if (!params.success) return sendProblem(reply, problem(HTTP.badRequest, { detail: 'Flight id must be a UUID' }));
    const flight = await visibleFlight(request, reply, params.data.id);
    if (!flight) return reply;
    const records = await deps.list(flight.id);
    return reply.send(CommentsResponse.parse({ comments: records.map((r) => toDto(r, request.userId, flight.userId)) }));
  });

  app.post('/flights/:id/comments', async (request, reply) => {
    if (!request.userId) return sendProblem(reply, problem(HTTP.unauthorized, { detail: 'Sign in to comment' }));
    const params = FlightParams.safeParse(request.params);
    if (!params.success) return sendProblem(reply, problem(HTTP.badRequest, { detail: 'Flight id must be a UUID' }));
    const body = NewComment.safeParse(request.body);
    if (!body.success) return sendProblem(reply, problem(HTTP.badRequest, { detail: z.prettifyError(body.error) }));
    const flight = await visibleFlight(request, reply, params.data.id);
    if (!flight) return reply;

    // Ответ — в один уровень и только в этом же полёте, на живой комментарий.
    if (body.data.parentId !== undefined) {
      const parent = await deps.find(body.data.parentId);
      if (!parent || parent.flightId !== flight.id || parent.parentId !== null || parent.deleted) {
        return sendProblem(reply, problem(HTTP.badRequest, { detail: 'Reply only to a top-level comment of this flight' }));
      }
    }
    const id = await deps.add({
      flightId: flight.id,
      userId: request.userId,
      parentId: body.data.parentId ?? null,
      body: body.data.body,
      timecodeS: body.data.timecodeS ?? null,
    });
    request.log.info({ flightId: flight.id, commentId: id, userId: request.userId }, 'comment added');
    const created = (await deps.list(flight.id)).find((record) => record.id === id);
    if (!created) throw new Error(`Comment ${id} vanished right after insert`);
    return reply.code(HTTP.created).send(toDto(created, request.userId, flight.userId));
  });

  app.delete('/flights/:id/comments/:commentId', async (request, reply) => {
    if (!request.userId) return sendProblem(reply, problem(HTTP.unauthorized, { detail: 'Sign in to delete comments' }));
    const params = CommentParams.safeParse(request.params);
    if (!params.success) return sendProblem(reply, problem(HTTP.badRequest, { detail: 'Ids must be UUIDs' }));
    const flight = await visibleFlight(request, reply, params.data.id);
    if (!flight) return reply;
    const comment = await deps.find(params.data.commentId);
    if (!comment || comment.flightId !== flight.id || comment.deleted) {
      return sendProblem(reply, problem(HTTP.notFound, { detail: 'Comment not found' }));
    }
    if (request.userId !== comment.userId && request.userId !== flight.userId) {
      return sendProblem(reply, problem(HTTP.forbidden, { detail: 'Only the author or the flight owner can delete' }));
    }
    await deps.remove(comment.id);
    request.log.info({ flightId: flight.id, commentId: comment.id, userId: request.userId }, 'comment deleted');
    return reply.code(HTTP.noContent).send();
  });
}
