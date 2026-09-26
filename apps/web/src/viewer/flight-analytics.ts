import {
  FlightDetailsResponse,
  GlidesResponse,
  ThermalsResponse,
  WindResponse,
  type GlideDto,
  type GliderDto,
  type Privacy,
  type ThermalDto,
} from '@skyline/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { useMe } from '../auth/session';
import { fetchGliders, GLIDERS_QUERY_KEY, setFlightGlider } from '../gliders/gliders-api';
import { setPrivacy, shareToken, shareUrl, withShare } from '../sharing/sharing-api';
import { createSite } from '../sites/create-site';

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
  share: string | null = null,
): Promise<FlightAnalytics> {
  const base = `/api/v1/flights/${flightId}`;
  // Посторонний видит полёт «по ссылке» только с токеном (задача 3.7).
  const url = (path: string) => withShare(`${base}${path}`, share);
  const [details, thermals, glides, wind] = await Promise.all([
    fetchJson(url(''), FlightDetailsResponse, signal, fetchImpl),
    fetchJson(url('/thermals'), ThermalsResponse, signal, fetchImpl),
    fetchJson(url('/glides'), GlidesResponse, signal, fetchImpl),
    fetchJson(url('/wind'), WindResponse, signal, fetchImpl),
  ]);
  return { details, thermals: thermals.thermals, glides: glides.glides, wind };
}

const analyticsKey = (flightId: string | null, viewerId: string | null) =>
  ['flight-analytics', flightId, viewerId] as const;

/** Добавить место старта полёта и обновить панель (задача 2.13). */
export function useCreateSite(flightId: string | null): ((name: string) => Promise<void>) | undefined {
  const client = useQueryClient();
  const create = useCallback(
    async (name: string) => {
      if (flightId === null) return;
      await createSite(flightId, name);
      await client.invalidateQueries({ queryKey: ['flight-analytics', flightId] });
    },
    [client, flightId],
  );
  return flightId === null ? undefined : create;
}

/** Крыло своего полёта (задача 2.13б): смена и обновление панели. */
export function useSetFlightGlider(flightId: string | null): ((gliderId: string | null) => Promise<void>) | undefined {
  const client = useQueryClient();
  const set = useCallback(
    async (gliderId: string | null) => {
      if (flightId === null) return;
      await setFlightGlider(flightId, gliderId);
      await client.invalidateQueries({ queryKey: ['flight-analytics', flightId] });
    },
    [client, flightId],
  );
  return flightId === null ? undefined : set;
}

/** Крылья вошедшего — для выбора в панели; не вошёл — не запрашиваем. */
export function useOwnGliders(): GliderDto[] | undefined {
  const me = useMe();
  return useQuery({ queryKey: GLIDERS_QUERY_KEY, queryFn: () => fetchGliders(), enabled: Boolean(me) }).data;
}

/** Приватность и ссылка своего полёта (задача 3.7); null — демо-трек. */
export function usePrivacyControls(flightId: string | null) {
  const client = useQueryClient();
  const onPrivacy = useCallback(
    async (privacy: Privacy) => {
      if (flightId === null) return;
      await setPrivacy(flightId, privacy);
      await client.invalidateQueries({ queryKey: ['flight-analytics', flightId] });
    },
    [client, flightId],
  );
  const link = useCallback(
    async (reset: boolean) => shareUrl(window.location.origin, await shareToken(flightId ?? '', reset)),
    [flightId],
  );
  if (flightId === null) return null;
  return { onPrivacy, onShareLink: () => link(false), onResetLink: () => link(true) };
}

/** null — демо-трек: его нет в API, панели нет. */
export function useFlightAnalytics(flightId: string | null, share: string | null = null): AnalyticsState | null {
  // Вход меняет ответ (canEdit): ждём, пока станет известно, кто смотрит, и
  // держим его в ключе — после входа или выхода панель перезапросится.
  const me = useMe();
  const query = useQuery({
    queryKey: analyticsKey(flightId, me?.id ?? null),
    queryFn: ({ signal }) => fetchFlightAnalytics(flightId ?? '', signal, fetch, share),
    enabled: flightId !== null && me !== undefined,
    // Анализ готового полёта не меняется до повторной обработки.
    staleTime: Number.POSITIVE_INFINITY,
    retry: 1,
  });
  if (flightId === null) return null;
  if (query.isError) return { status: 'error' };
  if (!query.data) return { status: 'loading' };
  return { status: 'ready', analytics: query.data };
}
