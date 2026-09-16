import { z } from 'zod';

const MAX_CONCURRENCY = 64;

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
});
export type Config = z.infer<typeof Config>;

export function loadConfig(env: Record<string, string | undefined>): Config {
  const result = Config.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid environment (see .env.example):\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
