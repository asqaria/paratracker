import { z } from 'zod';

import { ProblemDetails } from './problem.js';

const DatabaseUp = z.object({
  status: z.literal('up'),
  /** Версия PostGIS: сам факт ответа доказывает, что расширение установлено. */
  postgisVersion: z.string().min(1),
});
const Down = z.object({ status: z.literal('down') });
const StorageUp = z.object({ status: z.literal('up') });

export const DatabaseCheck = z.discriminatedUnion('status', [DatabaseUp, Down]);
export type DatabaseCheck = z.infer<typeof DatabaseCheck>;

export const StorageCheck = z.discriminatedUnion('status', [StorageUp, Down]);
export type StorageCheck = z.infer<typeof StorageCheck>;

export const HealthChecks = z.object({ database: DatabaseCheck, storage: StorageCheck });
export type HealthChecks = z.infer<typeof HealthChecks>;

/** 200 OK от GET /api/v1/health — все зависимости доступны. */
export const HealthResponse = z.object({
  status: z.literal('ok'),
  checks: z.object({ database: DatabaseUp, storage: StorageUp }),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

/** 503 от GET /api/v1/health — Problem Details с расширением `checks`. */
export const HealthProblem = ProblemDetails.extend({
  status: z.literal(503),
  checks: HealthChecks,
});
export type HealthProblem = z.infer<typeof HealthProblem>;
