import { refsFromQuery, type FlightRef } from './compare/compare-refs';

/**
 * Минимальная маршрутизация по хэшу до появления роутера (ТЗ §8.2):
 * # или #/ — лендинг с дропзоной, #/flight/{id} — просмотрщик по .track
 * из API, #/demo — демо-трек, #/health — состояние сервисов, #/auth-failed —
 * лендинг с сообщением о неудачном входе, #/logbook — логбук.
 */

const FLIGHT_HASH = /^#\/flight\/([0-9a-f-]{36})(\/review)?$/i;
const DEMO_HASH = '#/demo';
const DEMO_TRACK_URL = '/demo/baseline.track';

export const HEALTH_HASH = '#/health';
/** Сюда API возвращает после неудачного входа через Google (apps/api auth/routes.ts). */
export const AUTH_FAILED_HASH = '#/auth-failed';
/** Логбук вошедшего (задача 2.11, ТЗ §8.2 /logbook). */
export const LOGBOOK_HASH = '#/logbook';
/** Настройки: пока — «Мои крылья» (задача 2.13б, ТЗ §8.2 /settings). */
export const SETTINGS_HASH = '#/settings';
/** Ссылка «по ссылке» (задача 3.7): #/s/{токен}. */
const SHARE_HASH = /^#\/s\/([\w-]{8,64})$/;
/**
 * Встраиваемый просмотрщик (задача 3.9): путь /embed/{токен}, а не хэш —
 * сервер видит путь и разрешает встраивать в чужие сайты только его.
 */
const EMBED_PATH = /^\/embed\/([\w-]{8,64})\/?$/;

/** Сравнение треков (задача 3.12): #/compare?f=… — состав в адресе (compare-refs.ts). */
const COMPARE_HASH = /^#\/compare(?:\?(.*))?$/;

/** Лента сообщества (задача 3.10а). */
export const FEED_HASH = '#/feed';

/** Прогноз для пилотов (задача П.3, ТЗ §6.9): #/map, место — #/map?site={slug}. */
export const MAP_HASH = '#/map';
const MAP_HASH_RE = /^#\/map(?:\?site=([a-z0-9-]{1,200}))?$/;
export const mapHash = (site: string | null): string => (site === null ? MAP_HASH : `${MAP_HASH}?site=${site}`);

/** Публичный профиль пилота (задача 3.11): #/u/{имя}. */
const PROFILE_HASH = /^#\/u\/([a-z0-9._-]{3,24})$/i;
export const profileHash = (username: string): string => `#/u/${username}`;

/** Адрес iframe для чужого сайта. */
export const embedPath = (token: string): string => `/embed/${token}`;
/** Полная страница полёта по ссылке — из встроенного просмотрщика «Открыть в Skyline». */
export const shareHash = (token: string): string => `#/s/${token}`;

/** Адрес просмотрщика загруженного полёта — им же делается редирект. */
export const flightHash = (flightId: string): string => `#/flight/${flightId}`;
/** Сверка термиков владельцем (DoD фазы 2): просмотрщик с панелью сверки. */
export const reviewHash = (flightId: string): string => `#/flight/${flightId}/review`;

/** id полёта из хэша; null — не полёт (демо, лендинг). */
const flightIdFromHash = (hash: string): string | null => FLIGHT_HASH.exec(hash)?.[1] ?? null;

/** Путь к .track для просмотрщика; null — показываем лендинг. */
export function trackUrlFromHash(hash: string): string | null {
  if (hash === DEMO_HASH) return DEMO_TRACK_URL;
  const flightId = flightIdFromHash(hash);
  return flightId === null ? null : `/api/v1/flights/${flightId}/track`;
}

export type Route =
  /** authFailed — вернулись с неудачного входа: показать, что не вышло. */
  | { kind: 'landing'; authFailed?: true }
  | { kind: 'health' }
  | { kind: 'logbook' }
  | { kind: 'settings' }
  | { kind: 'shared'; token: string }
  /** Встроенный в чужой сайт просмотрщик (задача 3.9): облегчённый, без входа. */
  | { kind: 'embed'; token: string }
  /** Сравнение треков (задача 3.12). */
  | { kind: 'compare'; refs: FlightRef[] }
  /** Публичный профиль пилота (задача 3.11). */
  | { kind: 'profile'; username: string }
  /** Лента сообщества (задача 3.10а). */
  | { kind: 'feed' }
  /** Прогноз на карте (задача П.3); site — открытое место. */
  | { kind: 'map'; site: string | null }
  /** flightId null — демо-трек: его нет в API, аналитики к нему нет. */
  | { kind: 'flight'; flightId: string | null; trackUrl: string; review?: true };

/** Маршрут по адресу страницы: встраивание — по пути, остальное — по хэшу. */
export function routeFromLocation(pathname: string, hash: string): Route {
  const embed = EMBED_PATH.exec(pathname)?.[1];
  return embed === undefined ? routeFromHash(hash) : { kind: 'embed', token: embed };
}

export function routeFromHash(hash: string): Route {
  if (hash === HEALTH_HASH) return { kind: 'health' };
  if (hash === LOGBOOK_HASH) return { kind: 'logbook' };
  if (hash === SETTINGS_HASH) return { kind: 'settings' };
  if (hash === FEED_HASH) return { kind: 'feed' };
  const map = MAP_HASH_RE.exec(hash);
  if (map) return { kind: 'map', site: map[1] ?? null };
  const profile = PROFILE_HASH.exec(hash)?.[1];
  if (profile !== undefined) return { kind: 'profile', username: profile.toLowerCase() };
  const compare = COMPARE_HASH.exec(hash);
  if (compare) return { kind: 'compare', refs: refsFromQuery(compare[1] ?? '') };
  const share = SHARE_HASH.exec(hash)?.[1];
  if (share !== undefined) return { kind: 'shared', token: share };
  if (hash === AUTH_FAILED_HASH) return { kind: 'landing', authFailed: true };
  const trackUrl = trackUrlFromHash(hash);
  if (trackUrl === null) return { kind: 'landing' };
  const review = FLIGHT_HASH.exec(hash)?.[2] !== undefined;
  return { kind: 'flight', flightId: flightIdFromHash(hash), trackUrl, ...(review ? { review: true as const } : {}) };
}
