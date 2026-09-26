import { LogbookSitesResponse, SiteSummary } from '@skyline/core';

import { fetchWithSession } from '../auth/session';

/** Места старта (задача 2.13): добавить место своего полёта, места для фильтра логбука. */

export const SITES_URL = '/api/v1/sites';
export const LOGBOOK_SITES_URL = '/api/v1/logbook/sites';

/** Сайт paragliding.earth — источник сида; ссылка обязательна по CC BY-SA. */
export const PGE_URL = 'https://paraglidingearth.com';

export async function createSite(flightId: string, name: string, fetchImpl: typeof fetch = fetch): Promise<SiteSummary> {
  const response = await fetchWithSession(
    SITES_URL,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ flightId, name }) },
    fetchImpl,
  );
  if (!response.ok) throw new Error(`Create site failed: HTTP ${response.status}`);
  return SiteSummary.parse(await response.json());
}

export async function fetchLogbookSites(fetchImpl: typeof fetch = fetch): Promise<LogbookSitesResponse> {
  const response = await fetchWithSession(LOGBOOK_SITES_URL, { method: 'GET' }, fetchImpl);
  if (!response.ok) throw new Error(`Logbook sites failed: HTTP ${response.status}`);
  return LogbookSitesResponse.parse(await response.json());
}
