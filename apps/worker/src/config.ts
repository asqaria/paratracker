import { z } from 'zod';

const MAX_CONCURRENCY = 64;

/** Пустая строка в .env — «не задано», как в apps/api/src/config.ts. */
const optionalText = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (typeof value === 'string' && value.trim() === '' ? undefined : value), schema.optional());

export const Config = z.object({
  DATABASE_URL: z.url(),

  S3_ENDPOINT: z.url(),
  S3_REGION: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  S3_FORCE_PATH_STYLE: z.stringbool().default(true),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** Сколько полётов обрабатывается одновременно; по одному потоку на полёт. */
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(MAX_CONCURRENCY).default(2),

  /** Подложка превью (задача 3.8) — те же ключ и шаблон, что у API; без них превью на тёмном фоне. */
  ARCGIS_API_KEY: optionalText(z.string().min(1)),
  ARCGIS_TILE_URL: optionalText(z.url()),
});
export type Config = z.infer<typeof Config>;

export function loadConfig(env: Record<string, string | undefined>): Config {
  const result = Config.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid environment (see .env.example):\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
