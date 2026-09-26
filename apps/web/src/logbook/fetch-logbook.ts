import { ClaimResponse, LogbookMapResponse, LogbookResponse } from '@skyline/core';

import { fetchWithSession } from '../auth/session';

/** Запросы логбука (задача 2.11). Все — от имени вошедшего, с обновлением сессии. */

export const LOGBOOK_URL = '/api/v1/logbook';
export const LOGBOOK_MAP_URL = '/api/v1/logbook/map';
export const CLAIM_URL = '/api/v1/flights/claim';

async function ok(response: Response, what: string): Promise<unknown> {
  if (!response.ok) throw new Error(`${what} failed: HTTP ${response.status}`);
  return response.json();
}

export async function fetchLogbookPage(cursor: string | null, fetchImpl: typeof fetch = fetch): Promise<LogbookResponse> {
  const url = cursor === null ? LOGBOOK_URL : `${LOGBOOK_URL}?${new URLSearchParams({ cursor }).toString()}`;
  return LogbookResponse.parse(await ok(await fetchWithSession(url, { method: 'GET' }, fetchImpl), 'Logbook'));
}

export async function fetchLogbookMap(fetchImpl: typeof fetch = fetch): Promise<LogbookMapResponse> {
  return LogbookMapResponse.parse(
    await ok(await fetchWithSession(LOGBOOK_MAP_URL, { method: 'GET' }, fetchImpl), 'Logbook map'),
  );
}

export async function postClaims(
  claims: readonly { flightId: string; token: string }[],
  fetchImpl: typeof fetch = fetch,
): Promise<ClaimResponse> {
  const response = await fetchWithSession(
    CLAIM_URL,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ claims }) },
    fetchImpl,
  );
  return ClaimResponse.parse(await ok(response, 'Claim'));
}
