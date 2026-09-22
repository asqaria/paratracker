import { PARSER, ProblemDetails, sourceFormatForFilename, TRACK_FILE_EXTENSIONS, UploadResponse } from '@skyline/core';

/**
 * Загрузка файла трека (ТЗ §10, US-01). Проверки повторяются на клиенте не
 * из доверия к нему, а чтобы не гнать 50 МБ ради ответа 413: сервер всё равно
 * проверяет сам. Ошибки API приходят как RFC 9457 Problem Details.
 */

export const UPLOAD_URL = '/api/v1/flights/upload';

/** Имя части multipart. API читает первую часть, имя — для читаемости логов. */
export const UPLOAD_FIELD_NAME = 'file';

/** Значение атрибута accept для input[type=file]. */
export const ACCEPT_ATTRIBUTE = TRACK_FILE_EXTENSIONS.map((extension) => `.${extension}`).join(',');

/** Почему файл не принят. Причина локализуется в UI, текст сервера — нет. */
export type UploadRejection =
  | { reason: 'empty' }
  | { reason: 'unsupported_format' }
  | { reason: 'too_large'; maxBytes: number };

export class UploadError extends Error {
  readonly rejection: UploadRejection | null;
  readonly status: number;

  constructor(message: string, status: number, rejection: UploadRejection | null) {
    super(message);
    this.name = 'UploadError';
    this.status = status;
    this.rejection = rejection;
  }
}

/** Минимум от File, нужный для проверки: тест не обязан собирать настоящий. */
export interface TrackFileInfo {
  name: string;
  size: number;
}

/** Причина отказа или null, если файл можно отправлять. */
export function checkTrackFile(file: TrackFileInfo): UploadRejection | null {
  if (file.size === 0) return { reason: 'empty' };
  if (file.size > PARSER.maxFileBytes) return { reason: 'too_large', maxBytes: PARSER.maxFileBytes };
  if (sourceFormatForFilename(file.name) === null) return { reason: 'unsupported_format' };
  return null;
}

const HTTP_PAYLOAD_TOO_LARGE = 413;
const HTTP_UNSUPPORTED_MEDIA_TYPE = 415;

/** Ответ сервера об отказе — в ту же причину, что и локальная проверка. */
function rejectionFromStatus(status: number): UploadRejection | null {
  if (status === HTTP_PAYLOAD_TOO_LARGE) return { reason: 'too_large', maxBytes: PARSER.maxFileBytes };
  if (status === HTTP_UNSUPPORTED_MEDIA_TYPE) return { reason: 'unsupported_format' };
  return null;
}

export interface UploadDeps {
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

export async function uploadTrack(file: File, deps: UploadDeps = {}): Promise<UploadResponse> {
  const rejection = checkTrackFile(file);
  if (rejection !== null) throw new UploadError(`Track file rejected: ${rejection.reason}`, 0, rejection);

  const body = new FormData();
  body.append(UPLOAD_FIELD_NAME, file, file.name);

  const response = await (deps.fetchImpl ?? fetch)(UPLOAD_URL, {
    method: 'POST',
    body,
    headers: { accept: 'application/json, application/problem+json' },
    ...(deps.signal === undefined ? {} : { signal: deps.signal }),
  });

  if (response.ok) return UploadResponse.parse(await response.json());

  // Тело может быть и не Problem Details (упал прокси) — тогда хватит статуса.
  const problem = ProblemDetails.safeParse(await response.json().catch(() => null));
  const detail = problem.success ? (problem.data.detail ?? problem.data.title) : `HTTP ${response.status}`;
  throw new UploadError(detail, response.status, rejectionFromStatus(response.status));
}
