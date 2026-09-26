import { GliderDto, GlidersResponse, type GliderInput } from '@skyline/core';

import { fetchWithSession } from '../auth/session';

/** Крылья пилота и крыло полёта (задача 2.13б). Все запросы — от имени вошедшего. */

export const GLIDERS_URL = '/api/v1/gliders';
export const GLIDERS_QUERY_KEY = ['gliders'] as const;

const JSON_BODY = { 'content-type': 'application/json' };

function ensureOk(response: Response, what: string): Response {
  if (!response.ok) throw new Error(`${what} failed: HTTP ${response.status}`);
  return response;
}

export async function fetchGliders(fetchImpl: typeof fetch = fetch): Promise<GliderDto[]> {
  const response = ensureOk(await fetchWithSession(GLIDERS_URL, { method: 'GET' }, fetchImpl), 'Gliders');
  return GlidersResponse.parse(await response.json()).gliders;
}

export async function createGlider(input: GliderInput, fetchImpl: typeof fetch = fetch): Promise<GliderDto> {
  const response = ensureOk(
    await fetchWithSession(GLIDERS_URL, { method: 'POST', headers: JSON_BODY, body: JSON.stringify(input) }, fetchImpl),
    'Create glider',
  );
  return GliderDto.parse(await response.json());
}

export async function updateGlider(id: string, input: GliderInput, fetchImpl: typeof fetch = fetch): Promise<GliderDto> {
  const response = ensureOk(
    await fetchWithSession(`${GLIDERS_URL}/${id}`, { method: 'PATCH', headers: JSON_BODY, body: JSON.stringify(input) }, fetchImpl),
    'Update glider',
  );
  return GliderDto.parse(await response.json());
}

export async function deleteGlider(id: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  ensureOk(await fetchWithSession(`${GLIDERS_URL}/${id}`, { method: 'DELETE' }, fetchImpl), 'Delete glider');
}

/** Крыло своего полёта; null — отвязать. */
export async function setFlightGlider(flightId: string, gliderId: string | null, fetchImpl: typeof fetch = fetch): Promise<void> {
  ensureOk(
    await fetchWithSession(
      `/api/v1/flights/${flightId}`,
      { method: 'PATCH', headers: JSON_BODY, body: JSON.stringify({ gliderId }) },
      fetchImpl,
    ),
    'Set flight glider',
  );
}
