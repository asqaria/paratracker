/**
 * Минимальная маршрутизация по хэшу до появления роутера (ТЗ §8.2):
 * #/flight/{id} — просмотрщик по .track из API, #/demo — демо-трек.
 */

const FLIGHT_HASH = /^#\/flight\/([0-9a-f-]{36})$/i;
const DEMO_HASH = '#/demo';

/** Путь к .track для просмотрщика; null — показываем лендинг. */
export function trackUrlFromHash(hash: string): string | null {
  if (hash === DEMO_HASH) return '/demo/baseline.track';
  const flight = FLIGHT_HASH.exec(hash);
  return flight ? `/api/v1/flights/${flight[1] ?? ''}/track` : null;
}
