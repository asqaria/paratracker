/**
 * Минимальная маршрутизация по хэшу до появления роутера (ТЗ §8.2):
 * # или #/ — лендинг с дропзоной, #/flight/{id} — просмотрщик по .track
 * из API, #/demo — демо-трек, #/health — состояние сервисов.
 */

const FLIGHT_HASH = /^#\/flight\/([0-9a-f-]{36})$/i;
const DEMO_HASH = '#/demo';
const DEMO_TRACK_URL = '/demo/baseline.track';

export const HEALTH_HASH = '#/health';

/** Адрес просмотрщика загруженного полёта — им же делается редирект. */
export const flightHash = (flightId: string): string => `#/flight/${flightId}`;

/** id полёта из хэша; null — не полёт (демо, лендинг). */
const flightIdFromHash = (hash: string): string | null => FLIGHT_HASH.exec(hash)?.[1] ?? null;

/** Путь к .track для просмотрщика; null — показываем лендинг. */
export function trackUrlFromHash(hash: string): string | null {
  if (hash === DEMO_HASH) return DEMO_TRACK_URL;
  const flightId = flightIdFromHash(hash);
  return flightId === null ? null : `/api/v1/flights/${flightId}/track`;
}

export type Route =
  | { kind: 'landing' }
  | { kind: 'health' }
  /** flightId null — демо-трек: его нет в API, аналитики к нему нет. */
  | { kind: 'flight'; flightId: string | null; trackUrl: string };

export function routeFromHash(hash: string): Route {
  if (hash === HEALTH_HASH) return { kind: 'health' };
  const trackUrl = trackUrlFromHash(hash);
  return trackUrl === null ? { kind: 'landing' } : { kind: 'flight', flightId: flightIdFromHash(hash), trackUrl };
}
