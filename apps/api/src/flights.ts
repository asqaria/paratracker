import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';

import multipart from '@fastify/multipart';
import {
  fileExtension,
  FlightErrorCode,
  FlightStatusResponse,
  PARSER,
  sourceFormatForFilename,
  TRACK_FILE_EXTENSIONS,
  UploadResponse,
  type FlightStatus,
  type SourceFormat,
} from '@skyline/core';
import type { FlightRecord } from '@skyline/db';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { shareOf, viewOf, type FlightView } from './access.js';
import { hashToken, newRandomToken } from './auth/tokens.js';
import type { FlightEventListener } from './events.js';
import { problem, sendProblem } from './problem.js';

/** Загрузка и выдача полётов (ТЗ §10). Схемы ответов — из core. */

export type { FlightEventListener };

export interface NewFlightInput {
  id: string;
  userId: string | null;
  sourceFormat: SourceFormat;
  rawObjectKey: string;
  /** Анонимная загрузка: хэш токена, по которому полёт потом забирают в логбук. */
  claimTokenHash?: string;
}

export interface FlightRoutesDeps {
  repository: {
    insert(flight: NewFlightInput): Promise<FlightRecord>;
    find(id: string): Promise<FlightRecord | null>;
  };
  storage: {
    put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
    get(key: string): Promise<Uint8Array>;
  };
  events: {
    subscribe(flightId: string, listener: FlightEventListener): () => void;
  };
  /** Сообщить воркеру о новой работе (NOTIFY flight_queued). */
  onQueued(flightId: string): Promise<void>;
  newFlightId?: () => string;
  /** ТЗ §3.3: файл больше — отклоняется. */
  maxFileBytes?: number;
}

const HTTP = { badRequest: 400, notFound: 404, conflict: 409, payloadTooLarge: 413, unsupportedMediaType: 415 } as const;
const ACCEPTED = 202;
const OK = 200;
/** Пауза между heartbeat-комментариями SSE: прокси рвут простаивающие соединения. */
const SSE_HEARTBEAT_S = 15;
/**
 * Трек полёта неизменен, пока полёт не обработан заново; сутки в личном кэше
 * браузера — повторные просмотры без запроса, а смена видимости всё равно
 * закрывает доступ новым зрителям сразу.
 */
const TRACK_CACHE_S = 86_400;

const TERMINAL_STATUSES: readonly FlightStatus[] = ['ready', 'failed'];
const FlightIdParams = z.object({ id: z.uuid() });
const gzipAsync = promisify(gzip);

function toStatusResponse(flight: FlightRecord, progress?: number): FlightStatusResponse {
  const errorCode = FlightErrorCode.safeParse(flight.errorCode);
  return FlightStatusResponse.parse({
    flightId: flight.id,
    status: flight.status,
    trackReady: flight.status === 'ready' && flight.trackObjectKey !== null,
    ...(progress === undefined ? {} : { progress }),
    ...(errorCode.success ? { errorCode: errorCode.data } : {}),
  });
}

export function registerFlightRoutes(app: FastifyInstance, deps: FlightRoutesDeps): void {
  const maxFileBytes = deps.maxFileBytes ?? PARSER.maxFileBytes;
  const newFlightId = deps.newFlightId ?? randomUUID;

  void app.register(multipart, { limits: { fileSize: maxFileBytes, files: 1 } });

  /**
   * Полёт, который спрашивающему можно видеть (задача 3.7): владелец, публичный
   * или «по ссылке» с ?share=. Нельзя — тот же 404, что и для несуществующего.
   */
  const findFlightOr404 = async (
    id: string,
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<{ flight: FlightRecord; view: FlightView } | null> => {
    const flight = await deps.repository.find(id);
    const view = flight ? viewOf(flight, request.userId, shareOf(request.query)) : null;
    if (!flight || !view) {
      await sendProblem(reply, problem(HTTP.notFound, { detail: `Flight ${id} not found` }));
      return null;
    }
    return { flight, view };
  };

  const readId = async (params: unknown, reply: FastifyReply): Promise<string | null> => {
    const parsed = FlightIdParams.safeParse(params);
    if (!parsed.success) {
      await sendProblem(reply, problem(HTTP.badRequest, { detail: 'Flight id must be a UUID' }));
      return null;
    }
    return parsed.data.id;
  };

  app.post('/flights/upload', async (request, reply) => {
    if (!request.isMultipart()) {
      return sendProblem(reply, problem(HTTP.badRequest, { detail: 'Expected multipart/form-data with a file part' }));
    }

    const file = await request.file();
    if (!file) {
      return sendProblem(reply, problem(HTTP.badRequest, { detail: 'File part is required' }));
    }

    // Сопоставление расширений — общее с фронтом, лежит в core (ТЗ §3.1).
    const format = sourceFormatForFilename(file.filename);
    if (format === null) {
      const supported = TRACK_FILE_EXTENSIONS.map((extension) => `.${extension}`).join(', ');
      return sendProblem(
        reply,
        problem(HTTP.unsupportedMediaType, {
          detail: `Unsupported track format: ${file.filename}. Supported: ${supported}`,
        }),
      );
    }

    const bytes = await file.toBuffer();
    if (file.file.truncated || bytes.byteLength > maxFileBytes) {
      return sendProblem(
        reply,
        problem(HTTP.payloadTooLarge, { detail: `Track file is larger than ${maxFileBytes} bytes` }),
      );
    }

    const flightId = newFlightId();
    // Вошедший — полёт его (ТЗ §5.3: raw/{userId}/…); без входа — анонимный,
    // TTL 30 дней (ТЗ §7.1, §11.2).
    const { userId } = request;
    const rawObjectKey = `raw/${userId ?? 'anonymous'}/${flightId}.${fileExtension(file.filename)}.gz`;
    await deps.storage.put(rawObjectKey, await gzipAsync(bytes), 'application/gzip');

    // Аноним получает токен: после входа им забирают полёт в логбук (задача 2.11).
    const claimToken = userId === null ? newRandomToken() : undefined;
    const flight = await deps.repository.insert({
      id: flightId,
      userId,
      sourceFormat: format,
      rawObjectKey,
      ...(claimToken === undefined ? {} : { claimTokenHash: hashToken(claimToken) }),
    });
    await deps.onQueued(flight.id);

    return reply
      .code(ACCEPTED)
      .send(UploadResponse.parse({ flightId: flight.id, status: flight.status, claimToken }));
  });

  app.get('/flights/:id/status', async (request, reply) => {
    const id = await readId(request.params, reply);
    if (id === null) return reply;
    const found = await findFlightOr404(id, request, reply);
    if (!found) return reply;
    return reply.send(toStatusResponse(found.flight));
  });

  app.get('/flights/:id/track', async (request, reply) => {
    const id = await readId(request.params, reply);
    if (id === null) return reply;
    const found = await findFlightOr404(id, request, reply);
    if (!found) return reply;
    const { flight, view } = found;

    if (flight.status !== 'ready' || !flight.trackObjectKey) {
      return sendProblem(
        reply,
        problem(HTTP.conflict, { detail: `Flight ${id} is not processed yet: status ${flight.status}` }),
      );
    }

    // Посторонним — трек без записи на земле (задача 3.7); полёта в записи нет — нечего показать.
    const key = view === 'owner' ? flight.trackObjectKey : flight.publicTrackObjectKey;
    if (!key) return sendProblem(reply, problem(HTTP.notFound, { detail: `Flight ${id} not found` }));

    const bytes = await deps.storage.get(key);
    return (
      reply
        .code(OK)
        .type('application/octet-stream')
        // Один адрес — разный трек владельцу и постороннему: только личный кэш
        // браузера и с учётом cookie. Общий кэш отдал бы полный трек чужому.
        .header('cache-control', `private, max-age=${TRACK_CACHE_S}`)
        .header('vary', 'Cookie')
        .send(Buffer.from(bytes))
    );
  });

  app.get('/flights/:id/events', async (request, reply) => {
    const id = await readId(request.params, reply);
    if (id === null) return reply;
    const found = await findFlightOr404(id, request, reply);
    if (!found) return reply;
    const { flight } = found;

    reply.hijack();
    const stream = reply.raw;
    stream.writeHead(OK, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    });

    const send = (event: FlightStatusResponse): void => {
      stream.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    let unsubscribe = (): void => undefined;
    const heartbeat = setInterval(() => stream.write(': ping\n\n'), SSE_HEARTBEAT_S * 1000);
    const finish = (): void => {
      clearInterval(heartbeat);
      unsubscribe();
      if (!stream.writableEnded) stream.end();
    };

    unsubscribe = deps.events.subscribe(id, (event) => {
      send(event);
      if (TERMINAL_STATUSES.includes(event.status)) finish();
    });
    request.raw.on('close', finish);

    send(toStatusResponse(flight));
    if (TERMINAL_STATUSES.includes(flight.status)) finish();
    return reply;
  });
}
