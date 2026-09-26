import { SharedFlightResponse, ShareLinkResponse, type Privacy } from '@skyline/core';

import { fetchWithSession } from '../auth/session';

/** Приватность и ссылки полёта (задача 3.7). */

/** Адрес для чата, открывается без входа. /s/, не /#/s/: страницу с превью мессенджеру отдаёт сервер (задача 3.8). */
export const shareUrl = (origin: string, token: string): string => `${origin}/s/${token}`;

/** Токен ссылки в запросе к полёту: посторонний видит «по ссылке» только с ним. */
export const withShare = (url: string, share: string | null): string =>
  share === null ? url : `${url}${url.includes('?') ? '&' : '?'}${new URLSearchParams({ share }).toString()}`;

function ensureOk(response: Response, what: string): Response {
  if (!response.ok) throw new Error(`${what} failed: HTTP ${response.status}`);
  return response;
}

export async function setPrivacy(flightId: string, privacy: Privacy, fetchImpl: typeof fetch = fetch): Promise<void> {
  ensureOk(
    await fetchWithSession(
      `/api/v1/flights/${flightId}`,
      { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ privacy }) },
      fetchImpl,
    ),
    'Set privacy',
  );
}

export async function shareToken(flightId: string, reset: boolean, fetchImpl: typeof fetch = fetch): Promise<string> {
  const url = `/api/v1/flights/${flightId}/share${reset ? '/reset' : ''}`;
  const response = ensureOk(await fetchWithSession(url, { method: 'POST' }, fetchImpl), 'Share link');
  return ShareLinkResponse.parse(await response.json()).token;
}

/** Ссылка → полёт; null — ссылки нет, её сбросили или полёт стал личным. */
export async function resolveShare(token: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const response = await fetchImpl(`/api/v1/share/${encodeURIComponent(token)}`, { headers: { accept: 'application/json' } });
  if (response.status === 404) return null;
  ensureOk(response, 'Resolve share');
  return SharedFlightResponse.parse(await response.json()).flightId;
}
