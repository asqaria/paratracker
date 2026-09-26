import {
  LogbookResponse,
  MeResponse,
  PublicProfileResponse,
  type ProfilePatch,
} from '@skyline/core';

import { fetchWithSession, ME_URL } from '../auth/session';

/** Публичный профиль пилота и настройки своего (задача 3.11). */

const ACCEPT = { accept: 'application/json, application/problem+json' } as const;
const HTTP = { badRequest: 400, notFound: 404, conflict: 409 } as const;

export const profileKey = (username: string) => ['profile', username.toLowerCase()] as const;

const profileUrl = (username: string): string => `/api/v1/users/${encodeURIComponent(username)}`;

/** null — такого пилота нет. */
export async function fetchProfile(username: string, fetchImpl: typeof fetch = fetch): Promise<PublicProfileResponse | null> {
  const response = await fetchImpl(profileUrl(username), { headers: ACCEPT });
  if (response.status === HTTP.notFound) return null;
  if (!response.ok) throw new Error(`Profile ${username}: HTTP ${response.status}`);
  return PublicProfileResponse.parse(await response.json());
}

export async function fetchProfileFlights(
  username: string,
  cursor: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<LogbookResponse> {
  const query = cursor === null ? '' : `?${new URLSearchParams({ cursor }).toString()}`;
  const response = await fetchImpl(`${profileUrl(username)}/flights${query}`, { headers: ACCEPT });
  if (!response.ok) throw new Error(`Profile flights ${username}: HTTP ${response.status}`);
  return LogbookResponse.parse(await response.json());
}

export type SaveProfileResult = { kind: 'ok'; me: MeResponse } | { kind: 'taken' } | { kind: 'invalid' };

/** PATCH /me: 409 — адрес занят, 400 — не прошёл правила. Остальное — ошибка. */
export async function saveProfile(patch: ProfilePatch, fetchImpl: typeof fetch = fetch): Promise<SaveProfileResult> {
  const response = await fetchWithSession(
    ME_URL,
    { method: 'PATCH', headers: { ...ACCEPT, 'content-type': 'application/json' }, body: JSON.stringify(patch) },
    fetchImpl,
  );
  if (response.status === HTTP.conflict) return { kind: 'taken' };
  if (response.status === HTTP.badRequest) return { kind: 'invalid' };
  if (!response.ok) throw new Error(`Save profile: HTTP ${response.status}`);
  return { kind: 'ok', me: MeResponse.parse(await response.json()) };
}
