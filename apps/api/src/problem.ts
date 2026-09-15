import { STATUS_CODES } from 'node:http';

import { PROBLEM_CONTENT_TYPE, type ProblemDetails } from '@skyline/core';
import type { FastifyError, FastifyInstance, FastifyReply } from 'fastify';

const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_INTERNAL_ERROR = 500;
const HTTP_MAX_STATUS = 599;

/** RFC 9457 §4.2.1: `about:blank` — когда у проблемы нет своего типа, title = фраза статуса. */
export function problem(status: number, members: Omit<ProblemDetails, 'type' | 'title' | 'status'> = {}): ProblemDetails {
  return { type: 'about:blank', title: STATUS_CODES[status] ?? 'Error', status, ...members };
}

export function sendProblem(reply: FastifyReply, body: ProblemDetails): FastifyReply {
  return reply.code(body.status).type(PROBLEM_CONTENT_TYPE).send(body);
}

/** Все ошибки API — Problem Details (CLAUDE.md, «API»). */
export function registerProblemHandlers(app: FastifyInstance): void {
  app.setNotFoundHandler((request, reply) =>
    sendProblem(
      reply,
      problem(HTTP_NOT_FOUND, { detail: `Route ${request.method} ${request.url} not found`, instance: request.url }),
    ),
  );

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error.validation) {
      return sendProblem(
        reply,
        problem(HTTP_BAD_REQUEST, { detail: error.message, instance: request.url, errors: error.validation }),
      );
    }

    const status =
      error.statusCode !== undefined && error.statusCode >= HTTP_BAD_REQUEST && error.statusCode <= HTTP_MAX_STATUS
        ? error.statusCode
        : HTTP_INTERNAL_ERROR;

    if (status >= HTTP_INTERNAL_ERROR) {
      request.log.error({ err: error }, 'request failed');
      // Детали внутренней ошибки наружу не отдаём.
      return sendProblem(reply, problem(status, { instance: request.url }));
    }

    request.log.info({ err: error }, 'client error');
    return sendProblem(reply, problem(status, { detail: error.message, instance: request.url }));
  });
}
