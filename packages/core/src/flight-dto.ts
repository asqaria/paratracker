import { z } from 'zod';

import { FlightStatus } from './flight.js';
import { PARSE_FAILURE_CODES } from './parse.js';

/**
 * Контракт загрузки и обработки полёта (ТЗ §10). Схемы — источник типов
 * для API и фронта; строку БД наружу не отдаём (CLAUDE.md, «API»).
 */

/** Почему обработка не удалась: отказы парсера плюс ошибки самого конвейера. */
export const FLIGHT_ERROR_CODES = [
  ...PARSE_FAILURE_CODES,
  /** Формат файла не поддерживается (ТЗ §3.1). */
  'unsupported_format',
  /** Шаг конвейера не уложился в таймаут (ТЗ §11.2). */
  'timeout',
  /** Непредвиденная ошибка обработки — подробности только в логах. */
  'internal_error',
] as const;
export const FlightErrorCode = z.enum(FLIGHT_ERROR_CODES);
export type FlightErrorCode = z.infer<typeof FlightErrorCode>;

/** Ответ POST /api/v1/flights/upload. */
export const UploadResponse = z.object({
  flightId: z.uuid(),
  status: FlightStatus,
  /**
   * Только у анонимной загрузки: секрет, которым браузер после входа забирает
   * полёт в логбук (POST /api/v1/flights/claim, задача 2.11).
   */
  claimToken: z.string().min(1).optional(),
});
export type UploadResponse = z.infer<typeof UploadResponse>;

/** Ответ GET /api/v1/flights/{id}/status и полезная нагрузка SSE-события. */
export const FlightStatusResponse = z.object({
  flightId: z.uuid(),
  status: FlightStatus,
  /** Доля выполненного, 0…1. Есть только в событиях конвейера. */
  progress: z.number().min(0).max(1).optional(),
  errorCode: FlightErrorCode.optional(),
  /** Готов ли .track к скачиванию. */
  trackReady: z.boolean(),
});
export type FlightStatusResponse = z.infer<typeof FlightStatusResponse>;
