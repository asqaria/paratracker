import {
  ClaimRequest,
  ClaimResponse,
  LogbookMapResponse,
  LogbookQuery,
  LogbookResponse,
  LogbookSitesResponse,
  type LogbookEntry,
} from '@skyline/core';
import type { LogbookCursor, LogbookEntryRecord, LogbookMapFeature, LogbookPage, SiteRecord } from '@skyline/db';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { hashToken } from './auth/tokens.js';
import { problem, sendProblem } from './problem.js';

/**
 * Логбук (задача 2.11, ТЗ §10): свои полёты списком и на карте, перенос
 * анонимных загрузок после входа. Всё — только для вошедшего.
 */

export interface LogbookRoutesDeps {
  list(query: {
    userId: string;
    limit: number;
    from?: string;
    to?: string;
    siteId?: string;
    after?: LogbookCursor;
  }): Promise<LogbookPage>;
  /** Места, откуда летал пилот, с числом полётов (задача 2.13). */
  sites(userId: string): Promise<(SiteRecord & { flightCount: number })[]>;
  map(userId: string): Promise<LogbookMapFeature[]>;
  claim(userId: string, claims: readonly { flightId: string; tokenHash: string }[]): Promise<string[]>;
}

const HTTP = { badRequest: 400, unauthorized: 401 } as const;

/** Курсор снаружи непрозрачен: base64url от ключа сортировки и id. */
const CursorPayload = z.object({ k: z.iso.datetime(), id: z.uuid() });

const encodeCursor = (cursor: LogbookCursor): string =>
  Buffer.from(JSON.stringify({ k: cursor.sortKey.toISOString(), id: cursor.id })).toString('base64url');

function decodeCursor(value: string): LogbookCursor | null {
  try {
    const parsed = CursorPayload.safeParse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
    return parsed.success ? { sortKey: new Date(parsed.data.k), id: parsed.data.id } : null;
  } catch {
    return null;
  }
}

const iso = (date: Date | null): string | null => (date ? date.toISOString() : null);

const toEntry = (record: LogbookEntryRecord): LogbookEntry => ({
  ...record,
  startedAt: iso(record.startedAt),
  uploadedAt: record.uploadedAt.toISOString(),
});

export function registerLogbookRoutes(app: FastifyInstance, deps: LogbookRoutesDeps): void {
  /** id вошедшего или ответ 401. */
  const requireUser = async (request: FastifyRequest, reply: FastifyReply): Promise<string | null> => {
    if (request.userId) return request.userId;
    await sendProblem(reply, problem(HTTP.unauthorized, { detail: 'Sign in to see your logbook' }));
    return null;
  };

  app.get('/logbook', async (request, reply) => {
    const userId = await requireUser(request, reply);
    if (!userId) return reply;

    const query = LogbookQuery.safeParse(request.query);
    if (!query.success) {
      return sendProblem(reply, problem(HTTP.badRequest, { detail: z.prettifyError(query.error) }));
    }
    const { cursor, from, to, siteId, limit } = query.data;
    const after = cursor === undefined ? undefined : decodeCursor(cursor);
    if (after === null) return sendProblem(reply, problem(HTTP.badRequest, { detail: 'Invalid cursor' }));

    const page = await deps.list({
      userId,
      limit,
      ...(from === undefined ? {} : { from }),
      ...(to === undefined ? {} : { to }),
      ...(siteId === undefined ? {} : { siteId }),
      ...(after === undefined ? {} : { after }),
    });
    return reply.send(
      LogbookResponse.parse({ items: page.items.map(toEntry), nextCursor: page.next ? encodeCursor(page.next) : null }),
    );
  });

  app.get('/logbook/sites', async (request, reply) => {
    const userId = await requireUser(request, reply);
    if (!userId) return reply;
    return reply.send(LogbookSitesResponse.parse({ sites: await deps.sites(userId) }));
  });

  app.get('/logbook/map', async (request, reply) => {
    const userId = await requireUser(request, reply);
    if (!userId) return reply;

    const features = await deps.map(userId);
    return reply.send(
      LogbookMapResponse.parse({
        type: 'FeatureCollection',
        features: features.map((f) => ({
          type: 'Feature',
          properties: { id: f.id, startedAt: iso(f.startedAt) },
          geometry: { type: 'LineString', coordinates: f.coordinates },
        })),
      }),
    );
  });

  app.post('/flights/claim', async (request, reply) => {
    const userId = await requireUser(request, reply);
    if (!userId) return reply;

    const body = ClaimRequest.safeParse(request.body);
    if (!body.success) return sendProblem(reply, problem(HTTP.badRequest, { detail: z.prettifyError(body.error) }));

    // В базе — только хэши токенов, как и у сессий.
    const claimed = await deps.claim(
      userId,
      body.data.claims.map((c) => ({ flightId: c.flightId, tokenHash: hashToken(c.token) })),
    );
    if (claimed.length > 0) request.log.info({ userId, flightIds: claimed }, 'anonymous flights claimed');
    return reply.send(ClaimResponse.parse({ claimed }));
  });
}
