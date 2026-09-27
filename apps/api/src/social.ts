import { FeedQuery, FeedResponse, FollowResponse, LikeResponse, Username } from '@skyline/core';
import type { FeedCursor, FeedPage, FeedRecord, FlightRecord, FollowState, LikeState } from '@skyline/db';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { shareOf, viewOf } from './access.js';
import { problem, sendProblem } from './problem.js';

/**
 * Лента, лайки, подписки и картинка полёта для карточек (задача 3.10а, ТЗ §10).
 * Лайкнуть может любой вошедший, кто видит полёт (решение владельца 27.09.2026):
 * у «По ссылке» — с токеном ссылки, как и сам полёт.
 */

export interface SocialRoutesDeps {
  feed(query: { viewerId: string | null; scope: 'following' | 'all'; limit: number; after?: FeedCursor }): Promise<FeedPage>;
  flight(id: string): Promise<FlightRecord | null>;
  setLike(userId: string, flightId: string, liked: boolean): Promise<LikeState>;
  /** id пилота по логину; null — нет такого. */
  userIdOf(username: string): Promise<string | null>;
  setFollow(followerId: string, followeeId: string, following: boolean): Promise<FollowState>;
  storage: { get(key: string): Promise<Uint8Array> };
}

const HTTP = { ok: 200, badRequest: 400, unauthorized: 401, notFound: 404 } as const;
const IdParams = z.object({ id: z.uuid() });
const UserParams = z.object({ username: Username });
/** Картинка превью меняется только при переобработке — пять минут личного кеша. */
const PREVIEW_CACHE_S = 300;

/** Курсор ленты снаружи непрозрачен: base64url от старта и id. */
const CursorPayload = z.object({ k: z.iso.datetime(), id: z.uuid() });
const encodeCursor = (cursor: FeedCursor): string =>
  Buffer.from(JSON.stringify({ k: cursor.startedAt.toISOString(), id: cursor.id })).toString('base64url');
function decodeCursor(value: string): FeedCursor | null {
  try {
    const parsed = CursorPayload.safeParse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
    return parsed.success ? { startedAt: new Date(parsed.data.k), id: parsed.data.id } : null;
  } catch {
    return null;
  }
}

const toItem = (record: FeedRecord) => ({ ...record, startedAt: record.startedAt.toISOString() });

export function registerSocialRoutes(app: FastifyInstance, deps: SocialRoutesDeps): void {
  app.get('/feed', async (request, reply) => {
    const query = FeedQuery.safeParse(request.query);
    if (!query.success) return sendProblem(reply, problem(HTTP.badRequest, { detail: z.prettifyError(query.error) }));
    if (query.data.scope === 'following' && !request.userId) {
      return sendProblem(reply, problem(HTTP.unauthorized, { detail: 'Sign in to see pilots you follow' }));
    }
    const after = query.data.cursor === undefined ? undefined : decodeCursor(query.data.cursor);
    if (after === null) return sendProblem(reply, problem(HTTP.badRequest, { detail: 'Invalid cursor' }));
    const page = await deps.feed({
      viewerId: request.userId,
      scope: query.data.scope,
      limit: query.data.limit,
      ...(after ? { after } : {}),
    });
    return reply.send(
      FeedResponse.parse({ items: page.items.map(toItem), nextCursor: page.next ? encodeCursor(page.next) : null }),
    );
  });

  /** Полёт, который спрашивающий видит; null — ответ 400/404 уже отправлен. */
  const visibleFlight = async (request: FastifyRequest, reply: FastifyReply): Promise<FlightRecord | null> => {
    const params = IdParams.safeParse(request.params);
    if (!params.success) {
      await sendProblem(reply, problem(HTTP.badRequest, { detail: 'Flight id must be a UUID' }));
      return null;
    }
    const flight = await deps.flight(params.data.id);
    if (!flight || !viewOf(flight, request.userId, shareOf(request.query))) {
      await sendProblem(reply, problem(HTTP.notFound, { detail: `Flight ${params.data.id} not found` }));
      return null;
    }
    return flight;
  };

  const like = (liked: boolean) => async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.userId) return sendProblem(reply, problem(HTTP.unauthorized, { detail: 'Sign in to like flights' }));
    const flight = await visibleFlight(request, reply);
    if (!flight) return reply;
    const state = await deps.setLike(request.userId, flight.id, liked);
    return reply.send(LikeResponse.parse(state));
  };
  app.post('/flights/:id/like', like(true));
  app.delete('/flights/:id/like', like(false));

  const follow = (following: boolean) => async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.userId) return sendProblem(reply, problem(HTTP.unauthorized, { detail: 'Sign in to follow pilots' }));
    const params = UserParams.safeParse(request.params);
    const followeeId = params.success ? await deps.userIdOf(params.data.username) : null;
    if (!followeeId) return sendProblem(reply, problem(HTTP.notFound, { detail: 'Pilot not found' }));
    const state = await deps.setFollow(request.userId, followeeId, following);
    request.log.info({ userId: request.userId, followeeId, following }, 'follow changed');
    return reply.send(FollowResponse.parse(state));
  };
  app.post('/users/:username/follow', follow(true));
  app.delete('/users/:username/follow', follow(false));

  /** Картинка полёта для карточки ленты (превью задачи 3.8) — тем, кто видит полёт. */
  app.get('/flights/:id/preview.jpg', async (request, reply) => {
    const flight = await visibleFlight(request, reply);
    if (!flight) return reply;
    if (!flight.previewObjectKey) return sendProblem(reply, problem(HTTP.notFound, { detail: 'Preview not found' }));
    const bytes = await deps.storage.get(flight.previewObjectKey);
    return reply
      .code(HTTP.ok)
      .type('image/jpeg')
      // Доступ зависит от входа и ссылки — только личный кеш браузера.
      .header('cache-control', `private, max-age=${PREVIEW_CACHE_S}`)
      .header('vary', 'Cookie')
      .send(Buffer.from(bytes));
  });
}
