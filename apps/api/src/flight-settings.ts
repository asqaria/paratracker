import { randomBytes } from 'node:crypto';

import { FlightPatch, PRIVACY, SharedFlightResponse, ShareLinkResponse, type Privacy } from '@skyline/core';
import type { SetFlightGliderResult } from '@skyline/db';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { problem, sendProblem } from './problem.js';

/**
 * Настройки своего полёта: крыло (задача 2.13б) и приватность со ссылкой
 * (задача 3.7). Плюс разрешение ссылки «по ссылке» в полёт — без входа.
 */

export interface FlightSettingsDeps {
  setGlider(args: { flightId: string; userId: string; gliderId: string | null }): Promise<SetFlightGliderResult>;
  /** false — полёта нет или он чужой. */
  setPrivacy(args: { flightId: string; userId: string; privacy: Privacy }): Promise<boolean>;
  /** Токен ссылки: существующий или newToken; null — полёта нет или он чужой. */
  ensureShareToken(args: { flightId: string; userId: string; newToken: string }): Promise<string | null>;
  resetShareToken(args: { flightId: string; userId: string; newToken: string }): Promise<string | null>;
  /** Полёт по ссылке; «только я» — null. */
  findShared(token: string): Promise<string | null>;
  newShareToken?: () => string;
}

const HTTP = { noContent: 204, badRequest: 400, unauthorized: 401, notFound: 404 } as const;
const IdParams = z.object({ id: z.uuid() });
const TokenParams = z.object({ token: z.string().min(1).max(64) });
const NOT_YOURS = 'Flight not found among your flights';

export function registerFlightSettingsRoutes(app: FastifyInstance, deps: FlightSettingsDeps): void {
  const newShareToken = deps.newShareToken ?? (() => randomBytes(PRIVACY.shareTokenBytes).toString('base64url'));

  /** Вошедший и id полёта из пути; null — ответ с ошибкой уже отправлен. */
  const ownerRequest = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.userId) {
      await sendProblem(reply, problem(HTTP.unauthorized, { detail: 'Sign in to change your flight' }));
      return null;
    }
    const params = IdParams.safeParse(request.params);
    if (!params.success) {
      await sendProblem(reply, problem(HTTP.badRequest, { detail: 'Flight id must be a UUID' }));
      return null;
    }
    return { userId: request.userId, flightId: params.data.id };
  };

  app.patch('/flights/:id', async (request, reply) => {
    const owner = await ownerRequest(request, reply);
    if (!owner) return reply;
    const patch = FlightPatch.safeParse(request.body);
    if (!patch.success) return sendProblem(reply, problem(HTTP.badRequest, { detail: z.prettifyError(patch.error) }));

    if (patch.data.gliderId !== undefined) {
      const result = await deps.setGlider({ ...owner, gliderId: patch.data.gliderId });
      if (result === 'flight_not_found') return sendProblem(reply, problem(HTTP.notFound, { detail: NOT_YOURS }));
      if (result === 'glider_not_found') return sendProblem(reply, problem(HTTP.notFound, { detail: 'Glider not found' }));
    }
    if (patch.data.privacy !== undefined) {
      const changed = await deps.setPrivacy({ ...owner, privacy: patch.data.privacy });
      if (!changed) return sendProblem(reply, problem(HTTP.notFound, { detail: NOT_YOURS }));
      request.log.info({ flightId: owner.flightId, privacy: patch.data.privacy }, 'flight privacy changed');
    }
    return reply.code(HTTP.noContent).send();
  });

  app.post('/flights/:id/share', async (request, reply) => {
    const owner = await ownerRequest(request, reply);
    if (!owner) return reply;
    const token = await deps.ensureShareToken({ ...owner, newToken: newShareToken() });
    if (!token) return sendProblem(reply, problem(HTTP.notFound, { detail: NOT_YOURS }));
    return reply.send(ShareLinkResponse.parse({ token }));
  });

  app.post('/flights/:id/share/reset', async (request, reply) => {
    const owner = await ownerRequest(request, reply);
    if (!owner) return reply;
    const token = await deps.resetShareToken({ ...owner, newToken: newShareToken() });
    if (!token) return sendProblem(reply, problem(HTTP.notFound, { detail: NOT_YOURS }));
    request.log.info({ flightId: owner.flightId }, 'share link reset');
    return reply.send(ShareLinkResponse.parse({ token }));
  });

  /** Ссылка «по ссылке» → полёт. Без входа: так ссылку и открывают. */
  app.get('/share/:token', async (request, reply) => {
    const params = TokenParams.safeParse(request.params);
    const flightId = params.success ? await deps.findShared(params.data.token) : null;
    if (!flightId) return sendProblem(reply, problem(HTTP.notFound, { detail: 'Link not found' }));
    return reply.send(SharedFlightResponse.parse({ flightId }));
  });
}
