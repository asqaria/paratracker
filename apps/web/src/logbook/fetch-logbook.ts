import { ClaimResponse, LogbookMapResponse, LogbookResponse, SeasonStatsResponse } from '@skyline/core';

import { fetchWithSession } from '../auth/session';

/** Запросы логбука (задача 2.11). Все — от имени вошедшего, с обновлением сессии. */

export const LOGBOOK_URL = '/api/v1/logbook';
export const LOGBOOK_MAP_URL = '/api/v1/logbook/map';
export const CLAIM_URL = '/api/v1/flights/claim';
export const STATS_URL = '/api/v1/logbook/stats';

/** Статистика сезона (задача 2.12); null — последний год с полётами. */
export async function fetchSeasonStats(year: number | null, fetchImpl: typeof fetch = fetch): Promise<SeasonStatsResponse> {
  const url = year === null ? STATS_URL : `${STATS_URL}?year=${year}`;
  return SeasonStatsResponse.parse(await ok(await fetchWithSession(url, { method: 'GET' }, fetchImpl), 'Season stats'));
}

async function ok(response: Response, what: string): Promise<unknown> {
  if (!response.ok) throw new Error(`${what} failed: HTTP ${response.status}`);
  return response.json();
}

/** Фильтры логбука; null — без фильтра. */
export interface LogbookFilters {
  siteId: string | null;
  gliderId: string | null;
}

export const NO_FILTERS: LogbookFilters = { siteId: null, gliderId: null };

export async function fetchLogbookPage(
  cursor: string | null,
  filters: LogbookFilters = NO_FILTERS,
  fetchImpl: typeof fetch = fetch,
): Promise<LogbookResponse> {
  const params = new URLSearchParams({
    ...(cursor === null ? {} : { cursor }),
    ...(filters.siteId === null ? {} : { siteId: filters.siteId }),
    ...(filters.gliderId === null ? {} : { gliderId: filters.gliderId }),
  }).toString();
  const url = params === '' ? LOGBOOK_URL : `${LOGBOOK_URL}?${params}`;
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
