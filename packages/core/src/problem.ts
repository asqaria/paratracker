import { z } from 'zod';

/** RFC 9457 §3: медиатип ответа с ошибкой. */
export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

/**
 * RFC 9457 Problem Details. Объект открытый: §3.2 разрешает члены-расширения
 * (например, `checks` у /health или `errors` у ошибки валидации).
 */
export const ProblemDetails = z.looseObject({
  type: z.string(),
  title: z.string(),
  status: z.int().min(400).max(599),
  detail: z.string().optional(),
  instance: z.string().optional(),
});
export type ProblemDetails = z.infer<typeof ProblemDetails>;
