import {
  FlightDetailsResponse,
  GlidesResponse,
  ThermalsResponse,
  WindResponse,
  type GlideDto,
  type ThermalDto,
} from '@skyline/core';
import { useQuery } from '@tanstack/react-query';

/**
 * Аналитика полёта из API (ТЗ §10, задача 2.6): детали с агрегатами, термики,
 * глайды, ветер. Ответы проверяются схемами из core — те же, что у сервера.
 */

export interface FlightAnalytics {
  details: FlightDetailsResponse;
  thermals: ThermalDto[];
  glides: GlideDto[];
  wind: WindResponse;
}

export type AnalyticsState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; analytics: FlightAnalytics };

/** Схема ответа из core: фронту нужен только её разбор. */
interface Schema<T> {
  parse(value: unknown): T;
}

async function fetchJson<T>(url: string, schema: Schema<T>, signal: AbortSignal, fetchImpl: typeof fetch): Promise<T> {
  const response = await fetchImpl(url, { signal, headers: { accept: 'application/json, application/problem+json' } });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return schema.parse(await response.json());
}

/** Четыре запроса разом: панель показывается целиком, а не по кускам. */
export async function fetchFlightAnalytics(
  flightId: string,
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<FlightAnalytics> {
  const base = `/api/v1/flights/${flightId}`;
  const [details, thermals, glides, wind] = await Promise.all([
    fetchJson(base, FlightDetailsResponse, signal, fetchImpl),
    fetchJson(`${base}/thermals`, ThermalsResponse, signal, fetchImpl),
    fetchJson(`${base}/glides`, GlidesResponse, signal, fetchImpl),
    fetchJson(`${base}/wind`, WindResponse, signal, fetchImpl),
  ]);
  return { details, thermals: thermals.thermals, glides: glides.glides, wind };
}

/** null — демо-трек: его нет в API, панели нет. */
export function useFlightAnalytics(flightId: string | null): AnalyticsState | null {
  const query = useQuery({
    queryKey: ['flight-analytics', flightId],
    queryFn: ({ signal }) => fetchFlightAnalytics(flightId ?? '', signal),
    enabled: flightId !== null,
    // Анализ готового полёта не меняется до повторной обработки.
    staleTime: Number.POSITIVE_INFINITY,
    retry: 1,
  });
  if (flightId === null) return null;
  if (query.isError) return { status: 'error' };
  if (!query.data) return { status: 'loading' };
  return { status: 'ready', analytics: query.data };
}
