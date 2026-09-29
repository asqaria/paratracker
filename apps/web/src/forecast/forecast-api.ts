import { ForecastMapResponse, ForecastSiteResponse } from '@skyline/core';

/** Прогноз для пилотов (задача П.3, ТЗ §6.9): без входа. */

const ACCEPT = { accept: 'application/json, application/problem+json' } as const;

export const FORECAST_QUERY_KEY = ['forecast'] as const;

export async function fetchForecastMap(fetchImpl: typeof fetch = fetch): Promise<ForecastMapResponse> {
  const response = await fetchImpl('/api/v1/forecast', { headers: ACCEPT });
  if (!response.ok) throw new Error(`Forecast: HTTP ${response.status}`);
  return ForecastMapResponse.parse(await response.json());
}

export async function fetchSiteForecast(slug: string, fetchImpl: typeof fetch = fetch): Promise<ForecastSiteResponse> {
  const response = await fetchImpl(`/api/v1/forecast/${encodeURIComponent(slug)}`, { headers: ACCEPT });
  if (!response.ok) throw new Error(`Forecast ${slug}: HTTP ${response.status}`);
  return ForecastSiteResponse.parse(await response.json());
}
