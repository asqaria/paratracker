import { AuthProvidersResponse, MeResponse, safeReturnTo } from '@skyline/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

/**
 * Сессия на фронте (задача 2.10). Токены — в httpOnly-cookie: JS их не видит
 * и не хранит. «Вошёл ли я» — только ответ /me; access живёт 15 минут, и
 * при 401 сессия один раз обновляется через refresh-cookie.
 */

export const ME_URL = '/api/v1/me';
export const PROVIDERS_URL = '/api/v1/auth/providers';
export const REFRESH_URL = '/api/v1/auth/refresh';
export const LOGOUT_URL = '/api/v1/auth/logout';
const GOOGLE_SIGN_IN_URL = '/api/v1/auth/oauth/google';

const HTTP = { unauthorized: 401, notFound: 404, conflict: 409 } as const;
const ACCEPT_JSON = { accept: 'application/json, application/problem+json' };

/** Кнопка входа — обычная ссылка: вход через Google — переход страницы, не fetch. */
export const signInUrl = (currentHash: string): string =>
  `${GOOGLE_SIGN_IN_URL}?${new URLSearchParams({ returnTo: safeReturnTo(currentHash) }).toString()}`;

/** Обновить сессию. true — cookie свежие (обновили мы или соседняя вкладка). */
async function refresh(fetchImpl: typeof fetch): Promise<boolean> {
  const response = await fetchImpl(REFRESH_URL, { method: 'POST', headers: ACCEPT_JSON });
  return response.ok || response.status === HTTP.conflict;
}

/**
 * Запрос от имени вошедшего: access живёт 15 минут, на 401 сессия один раз
 * обновляется и запрос повторяется. 401 после этого — сессии правда нет.
 */
export async function fetchWithSession(url: string, init: RequestInit = {}, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const ask = () => fetchImpl(url, { ...init, headers: { ...ACCEPT_JSON, ...init.headers } });
  const response = await ask();
  if (response.status === HTTP.unauthorized && (await refresh(fetchImpl))) return ask();
  return response;
}

/** Профиль вошедшего; null — не вошёл (или вход на сервере выключен). */
export async function fetchMe(fetchImpl: typeof fetch = fetch): Promise<MeResponse | null> {
  const response = await fetchWithSession(ME_URL, { method: 'GET' }, fetchImpl);

  if (response.ok) return MeResponse.parse(await response.json());
  if (response.status === HTTP.unauthorized || response.status === HTTP.notFound) return null;
  throw new Error(`GET ${ME_URL} failed: HTTP ${response.status}`);
}

export async function fetchProviders(fetchImpl: typeof fetch = fetch): Promise<AuthProvidersResponse> {
  const response = await fetchImpl(PROVIDERS_URL, { method: 'GET', headers: ACCEPT_JSON });
  // Маршрута нет — вход на сервере не настроен.
  if (response.status === HTTP.notFound) return { google: false };
  if (!response.ok) throw new Error(`GET ${PROVIDERS_URL} failed: HTTP ${response.status}`);
  return AuthProvidersResponse.parse(await response.json());
}

export async function logout(fetchImpl: typeof fetch = fetch): Promise<void> {
  await fetchImpl(LOGOUT_URL, { method: 'POST', headers: ACCEPT_JSON });
}

const ME_KEY = ['me'] as const;

/** Текущий пользователь; undefined — ещё выясняем. */
export function useMe(): MeResponse | null | undefined {
  // Не повторять: 401 — это ответ, а не сбой.
  return useQuery({ queryKey: ME_KEY, queryFn: () => fetchMe(), retry: false, staleTime: Infinity }).data;
}

export function useProviders(): AuthProvidersResponse | undefined {
  return useQuery({ queryKey: ['auth-providers'], queryFn: () => fetchProviders(), staleTime: Infinity }).data;
}

export function useLogout(): () => Promise<void> {
  const client = useQueryClient();
  return useCallback(async () => {
    await logout();
    client.setQueryData(ME_KEY, null);
  }, [client]);
}

/**
 * Перед загрузкой: освежить access-cookie, иначе полёт после 15 минут
 * простоя вкладки ушёл бы анонимным.
 */
export async function ensureFreshSession(fetchImpl: typeof fetch = fetch): Promise<void> {
  await fetchMe(fetchImpl).catch(() => null);
}
