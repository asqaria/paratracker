import { FlightDetailsResponse, SameDayResponse, type SameDayFlight } from '@skyline/core';

import { fetchWithSession } from '../auth/session';
import { resolveShare, withShare } from '../sharing/sharing-api';
import type { FlightRef } from './compare-refs';

/** Полёт сравнения: id в API и токен ссылки, с которым его можно смотреть. */
export interface ResolvedFlight {
  flightId: string;
  share: string | null;
}

/** id полёта из элемента сравнения; сброшенная ссылка или личный полёт — null. */
export async function resolveRef(ref: FlightRef, fetchImpl: typeof fetch = fetch): Promise<ResolvedFlight | null> {
  if (ref.kind === 'id') return { flightId: ref.flightId, share: null };
  const flightId = await resolveShare(ref.token, fetchImpl);
  return flightId === null ? null : { flightId, share: ref.token };
}

export const trackUrl = (flight: ResolvedFlight): string =>
  withShare(`/api/v1/flights/${flight.flightId}/track`, flight.share);

/** Карточка полёта для подписи в сравнении: пилот, дата, место. null — полёт не открыть. */
export async function fetchCompareDetails(
  flight: ResolvedFlight,
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<FlightDetailsResponse | null> {
  const response = await fetchWithSession(
    withShare(`/api/v1/flights/${flight.flightId}`, flight.share),
    { signal, headers: { accept: 'application/json, application/problem+json' } },
    fetchImpl,
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Flight ${flight.flightId}: HTTP ${response.status}`);
  return FlightDetailsResponse.parse(await response.json());
}

/** «Ещё летали здесь в этот день» (задача 3.12в): публичные и свои полёты того же места и дня. */
export async function fetchSameDay(
  flight: ResolvedFlight,
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<SameDayFlight[]> {
  const response = await fetchWithSession(
    withShare(`/api/v1/flights/${flight.flightId}/same-day`, flight.share),
    { signal, headers: { accept: 'application/json, application/problem+json' } },
    fetchImpl,
  );
  if (!response.ok) return [];
  return SameDayResponse.parse(await response.json()).flights;
}
