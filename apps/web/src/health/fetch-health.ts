import { HealthProblem, HealthResponse, type HealthChecks } from '@skyline/core';

export const HEALTH_URL = '/api/v1/health';

export type HealthState =
  | { kind: 'ok'; checks: HealthResponse['checks'] }
  | { kind: 'degraded'; checks: HealthChecks };

/**
 * 200 → всё доступно; 503 Problem Details с `checks` → часть зависимостей упала.
 * Любой другой ответ (API лежит, прокси отдал HTML) — ошибка запроса.
 */
export async function fetchHealth(signal: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<HealthState> {
  const res = await fetchImpl(HEALTH_URL, {
    signal,
    headers: { accept: 'application/json, application/problem+json' },
  });
  const body: unknown = await res.json();

  if (res.ok) return { kind: 'ok', checks: HealthResponse.parse(body).checks };

  const problem = HealthProblem.safeParse(body);
  if (problem.success) return { kind: 'degraded', checks: problem.data.checks };

  throw new Error(`Health check failed: HTTP ${res.status}`);
}
