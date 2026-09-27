import { LogbookResponse, PublicProfileResponse, Username } from '@skyline/core';
import type { LogbookCursor, LogbookPage, PublicProfile } from '@skyline/db';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { decodeCursor, encodeCursor, toEntry } from './logbook.js';
import { problem, sendProblem } from './problem.js';

/**
 * Публичный профиль пилота (задача 3.11, ТЗ §8.2 /u/:username): без входа.
 * Только полёты «Все» — и в списке, и в цифрах (решение владельца 27.09.2026).
 */

export interface ProfileRoutesDeps {
  find(username: string): Promise<PublicProfile | null>;
  /** Публичные полёты пилота, курсорная пагинация как у логбука. */
  flights(query: { userId: string; limit: number; after?: LogbookCursor }): Promise<LogbookPage>;
}

const HTTP = { badRequest: 400, notFound: 404 } as const;
const Params = z.object({ username: Username });
/** Страница списка профиля: как у логбука, но без фильтров. */
const FlightsQuery = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export function registerProfileRoutes(app: FastifyInstance, deps: ProfileRoutesDeps): void {
  const profileOf = async (params: unknown): Promise<PublicProfile | null> => {
    const parsed = Params.safeParse(params);
    return parsed.success ? deps.find(parsed.data.username) : null;
  };

  app.get('/users/:username', async (request, reply) => {
    const profile = await profileOf(request.params);
    if (!profile) return sendProblem(reply, problem(HTTP.notFound, { detail: 'Pilot not found' }));
    return reply.send(
      PublicProfileResponse.parse({
        username: profile.username,
        displayName: profile.displayName,
        avatarUrl: profile.avatarUrl,
        memberSince: profile.memberSince.toISOString(),
        totals: profile.totals,
      }),
    );
  });

  app.get('/users/:username/flights', async (request, reply) => {
    const profile = await profileOf(request.params);
    if (!profile) return sendProblem(reply, problem(HTTP.notFound, { detail: 'Pilot not found' }));
    const query = FlightsQuery.safeParse(request.query);
    if (!query.success) return sendProblem(reply, problem(HTTP.badRequest, { detail: z.prettifyError(query.error) }));
    const after = query.data.cursor === undefined ? undefined : decodeCursor(query.data.cursor);
    if (after === null) return sendProblem(reply, problem(HTTP.badRequest, { detail: 'Invalid cursor' }));
    const page = await deps.flights({ userId: profile.id, limit: query.data.limit, ...(after ? { after } : {}) });
    return reply.send(
      LogbookResponse.parse({ items: page.items.map(toEntry), nextCursor: page.next ? encodeCursor(page.next) : null }),
    );
  });
}
