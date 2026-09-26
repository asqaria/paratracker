import { z } from 'zod';

const MAX_TCP_PORT = 65_535;
/** HS256: ключ не короче выхода SHA-256 (RFC 7518 §3.2) — 32 байта. */
const AUTH_SECRET_MIN_LENGTH = 32;

/**
 * Переменная окружения, которой может не быть. Пустая строка — это «не задано»:
 * в .env такие ключи принято оставлять пустыми, а не удалять.
 */
const optionalText = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (typeof value === 'string' && value.trim() === '' ? undefined : value), schema.optional());

export const Config = z.object({
  API_HOST: z.string().min(1).default('127.0.0.1'),
  API_PORT: z.coerce.number().int().min(1).max(MAX_TCP_PORT).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DATABASE_URL: z.url(),

  S3_ENDPOINT: z.url(),
  S3_REGION: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  /** MinIO требует path-style; R2 работает с обоими. */
  S3_FORCE_PATH_STYLE: z.stringbool().default(true),

  /**
   * Ключ ArcGIS Location Platform и шаблон тайлов (ТЗ §4.4.1). Пусто — подложка
   * Esri выключена, во фронте остаётся Sentinel-2. Ключ наружу не уходит.
   */
  ARCGIS_API_KEY: optionalText(z.string().min(1)),
  ARCGIS_TILE_URL: optionalText(z.url()),

  /**
   * Вход (задача 2.10). Адрес сайта, как его видит браузер: из него —
   * redirect_uri для Google и флаг Secure у cookie.
   */
  PUBLIC_URL: z.url().default('http://localhost:5173'),
  /**
   * Секрет подписи JWT, ≥ 32 символов (HS256 требует ключ не короче хэша).
   * Пусто — вход выключен, все загрузки анонимные.
   */
  AUTH_JWT_SECRET: optionalText(z.string().min(AUTH_SECRET_MIN_LENGTH)),
  /** OAuth-клиент Google Cloud Console. Пусто — кнопки «Войти через Google» нет. */
  GOOGLE_CLIENT_ID: optionalText(z.string().min(1)),
  GOOGLE_CLIENT_SECRET: optionalText(z.string().min(1)),
}).superRefine((config, ctx) => {
  const google = [config.GOOGLE_CLIENT_ID, config.GOOGLE_CLIENT_SECRET];
  if (google.some(Boolean) && !google.every(Boolean)) {
    ctx.addIssue({ code: 'custom', path: ['GOOGLE_CLIENT_SECRET'], message: 'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET go together' });
  }
  if (config.GOOGLE_CLIENT_ID && !config.AUTH_JWT_SECRET) {
    ctx.addIssue({ code: 'custom', path: ['AUTH_JWT_SECRET'], message: 'Google sign-in needs AUTH_JWT_SECRET' });
  }
});
export type Config = z.infer<typeof Config>;

export function loadConfig(env: Record<string, string | undefined>): Config {
  const result = Config.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid environment (see .env.example):\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
