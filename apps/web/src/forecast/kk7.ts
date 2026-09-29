import { sunPosition } from '@skyline/analysis';

/**
 * Карта термиков kk7 (thermal.kk7.ch, М. фон Кенель; CC BY-NC-SA 4.0,
 * разрешение автора получено владельцем 30.09.2026): собрана по миллионам
 * реальных полётов. Слои — по сезону и времени суток от восхода, как на
 * самом kk7: так на карте видно, где термики работают в выбранный час.
 * Только некоммерческое использование — при монетизации слой пересмотреть.
 */

export type Kk7Kind = 'thermals' | 'skyways';
export type Kk7Season = 'jan' | 'apr' | 'jul' | 'oct';
export type Kk7TimeOfDay = '04' | '07' | '10';

/** Сезоны kk7: «jan» — декабрь–февраль и т. д. (подсказки на thermal.kk7.ch). */
const SEASON_BY_MONTH: readonly Kk7Season[] = ['jan', 'jan', 'apr', 'apr', 'apr', 'jul', 'jul', 'jul', 'oct', 'oct', 'oct', 'jan'];

export const kk7Season = (monthUtc: number): Kk7Season => SEASON_BY_MONTH[monthUtc] ?? 'jul';

/** Утро — до 6 ч после восхода, день — 6–9 ч, вечер — позже (границы kk7). */
const MORNING_UNTIL_H = 6;
const MIDDAY_UNTIL_H = 9;
/** Восход ищется шагом 5 мин назад, не дальше суток. */
const SEARCH_STEP_MS = 5 * 60_000;
const MAX_SEARCH_MS = 24 * 3_600_000;
const MS_PER_HOUR = 3_600_000;

/** Время суток kk7 для момента; солнце под горизонтом — null. */
export function kk7TimeOfDay(lat: number, lon: number, timeMs: number): Kk7TimeOfDay | null {
  if (sunPosition(lat, lon, timeMs).elevationDeg <= 0) return null;
  let sunrise = timeMs;
  while (timeMs - sunrise < MAX_SEARCH_MS && sunPosition(lat, lon, sunrise - SEARCH_STEP_MS).elevationDeg > 0) sunrise -= SEARCH_STEP_MS;
  const hours = (timeMs - sunrise) / MS_PER_HOUR;
  return hours < MORNING_UNTIL_H ? '04' : hours < MIDDAY_UNTIL_H ? '07' : '10';
}

/** Имя слоя kk7 для места и часа: ночью — «весь день» сезона. */
export function kk7Layer(kind: Kk7Kind, lat: number, lon: number, timeMs: number): string {
  const season = kk7Season(new Date(timeMs).getUTCMonth());
  return `${kind}_${season}_${kk7TimeOfDay(lat, lon, timeMs) ?? 'all'}`;
}

/** Шаблон из конфига (VITE_THERMAL_TILE_URL) с {layer}; {z}/{x}/{y} подставит MapLibre. */
export const kk7TileUrl = (template: string, layer: string): string => template.replace('{layer}', layer);
