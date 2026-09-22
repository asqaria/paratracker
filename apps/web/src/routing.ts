/**
 * Минимальная маршрутизация по хэшу до появления роутера (ТЗ §8.2):
 * # или #/ — лендинг с дропзоной, #/flight/{id} — просмотрщик по .track
 * из API, #/demo — демо-трек, #/health — состояние сервисов.
 */

const FLIGHT_HASH = /^#\/flight\/([0-9a-f-]{36})$/i;
const DEMO_HASH = '#/demo';

export const HEALTH_HASH = '#/health';

/** Адрес просмотрщика загруженного полёта — им же делается редирект. */
export const flightHash = (flightId: string): string => `#/flight/${flightId}`;

/** Путь к .track для просмотрщика; null — показываем лендинг. */
export function trackUrlFromHash(hash: string): string | null {
  if (hash === DEMO_HASH) return '/demo/baseline.track';
  const flight = FLIGHT_HASH.exec(hash);
  return flight ? `/api/v1/flights/${flight[1] ?? ''}/track` : null;
}

export type Route = { kind: 'landing' } | { kind: 'health' } | { kind: 'flight'; trackUrl: string };

export function routeFromHash(hash: string): Route {
  if (hash === HEALTH_HASH) return { kind: 'health' };
  const trackUrl = trackUrlFromHash(hash);
  return trackUrl === null ? { kind: 'landing' } : { kind: 'flight', trackUrl };
}
