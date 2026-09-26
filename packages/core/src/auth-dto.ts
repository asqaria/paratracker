import { z } from 'zod';

import { Locale, UnitSystem } from './user.js';

/**
 * Контракт аутентификации (ТЗ §10, задача 2.10). Вход — только через
 * провайдеров OAuth, паролей в системе нет (решение владельца 26.09.2026).
 */

/** Провайдеры входа. Apple — позже, для iPhone (ТЗ Фаза 5). */
export const AUTH_PROVIDERS = ['google'] as const;
export const AuthProvider = z.enum(AUTH_PROVIDERS);
export type AuthProvider = z.infer<typeof AuthProvider>;

/** Ответ GET /api/v1/me — профиль вошедшего пользователя. Email наружу не отдаём. */
export const MeResponse = z.object({
  id: z.uuid(),
  username: z.string().min(1),
  displayName: z.string().nullable(),
  avatarUrl: z.url().nullable(),
  locale: Locale,
  units: UnitSystem,
});
export type MeResponse = z.infer<typeof MeResponse>;

/** Ответ GET /api/v1/auth/providers: какие кнопки входа показывать. */
export const AuthProvidersResponse = z.object({
  google: z.boolean(),
});
export type AuthProvidersResponse = z.infer<typeof AuthProvidersResponse>;

/** Хэш-маршрут приложения (ТЗ §8.2): `#/`, `#/flight/{id}` и т. п. */
const APP_HASH_ROUTE = /^#\/[\w\-/]*$/;
const HOME_ROUTE = '#/';

/**
 * Куда вернуть пользователя после входа. Только хэш-маршрут своего приложения:
 * любой другой адрес — открытый редирект, им подделывают страницу входа.
 */
export function safeReturnTo(value: string | undefined): string {
  return value !== undefined && APP_HASH_ROUTE.test(value) ? value : HOME_ROUTE;
}
