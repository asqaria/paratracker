import { indexAt, MS_PER_SECOND } from './playback';
import { varioRgb, type Rgb } from './vario-palette';

/**
 * Колонны термиков на сцене (ТЗ §7.2, задача 2.7) — расчёт без Cesium.
 * Колонна от высоты входа до высоты выхода (высота = набор), ось — от центра
 * кругов в начале термика к центру в конце: наклон показывает снос ветром.
 * Высоты — по треку сцены, откалиброванному по земле: иначе колонна висела бы
 * мимо спирали на поправку калибровки.
 */

export const THERMAL_COLUMN = {
  /**
   * Окно, по которому ищется центр кругов, с: круг параплана — 10–35 с (ТЗ §6.2),
   * 20 с — типичный; среднее координат за полный оборот ложится в его центр.
   * У короткого термика окно — не больше половины его длительности.
   */
  centerWindowS: 20,
} as const;

/**
 * Прозрачность колонн, 0…1: текущая плотнее, чтобы найти её среди соседних.
 * Стеной трек закрывала только колонна, в которой пилот, при камере рядом с ним
 * — в следящих режимах она теперь прячется (CurrentColumnStyle). Ниже 0.2
 * колонна на зелёном рельефе с 300 м уже не видна.
 */
export const COLUMN_ALPHA = { current: 0.35, other: 0.2 } as const;

/**
 * Что делать с колонной, в которой пилот: в следящих камерах (Chase, Side,
 * Cockpit) камера рядом с пилотом, то есть у стенки или внутри колонны, —
 * её прячем; в Free и Top смотрят со стороны — подсвечиваем.
 */
export type CurrentColumnStyle = 'highlight' | 'hide';

/** Трек сцены: время, координаты и высоты, уже откалиброванные по земле. */
export interface ColumnTrack {
  t: Float64Array;
  lat: Float64Array;
  lon: Float64Array;
  alt: Float64Array;
}

export interface ColumnThermal {
  startMs: number;
  endMs: number;
  avgClimbMs: number;
  avgRadiusM: number;
}

export interface ColumnPoint {
  lat: number;
  lon: number;
  alt: number;
}

export interface ThermalColumn {
  /** Номер термика во входном списке. */
  index: number;
  startMs: number;
  endMs: number;
  bottom: ColumnPoint;
  top: ColumnPoint;
  radiusM: number;
  /** Цвет палитры варио по среднему набору, 0…255. */
  rgb: Rgb;
}

/** Средние координаты точек трека с временем в [fromMs, toMs); высота — точки altIndex. */
function centre(track: ColumnTrack, fromMs: number, toMs: number, altIndex: number): ColumnPoint | null {
  let lat = 0;
  let lon = 0;
  let count = 0;
  for (let i = indexAt(track.t, fromMs); i < track.t.length && (track.t[i] ?? Infinity) < toMs; i++) {
    lat += track.lat[i] ?? 0;
    lon += track.lon[i] ?? 0;
    count += 1;
  }
  if (count === 0) return null;
  return { lat: lat / count, lon: lon / count, alt: track.alt[altIndex] ?? Number.NaN };
}

export function thermalColumns(track: ColumnTrack, thermals: readonly ColumnThermal[]): ThermalColumn[] {
  const first = track.t[0] ?? Infinity;
  const last = track.t[track.t.length - 1] ?? -Infinity;
  const columns: ThermalColumn[] = [];
  thermals.forEach((thermal, index) => {
    if (thermal.startMs < first || thermal.endMs > last || thermal.endMs <= thermal.startMs) return;
    const windowMs = Math.min(THERMAL_COLUMN.centerWindowS * MS_PER_SECOND, (thermal.endMs - thermal.startMs) / 2);
    const bottom = centre(track, thermal.startMs, thermal.startMs + windowMs, indexAt(track.t, thermal.startMs));
    // Окно конца — (end − W, end]: сдвиг на миллисекунду включает саму точку выхода.
    const top = centre(track, thermal.endMs - windowMs + 1, thermal.endMs + 1, indexAt(track.t, thermal.endMs));
    if (!bottom || !top || !(top.alt > bottom.alt)) return;
    columns.push({
      index,
      startMs: thermal.startMs,
      endMs: thermal.endMs,
      bottom,
      top,
      radiusM: thermal.avgRadiusM,
      rgb: varioRgb(thermal.avgClimbMs),
    });
  });
  return columns;
}

/** Номер колонны (в выходе thermalColumns), в чьём времени пилот; null — не в термике. */
export function currentColumn(columns: readonly ThermalColumn[], timeMs: number): number | null {
  const found = columns.findIndex((c) => timeMs >= c.startMs && timeMs <= c.endMs);
  return found === -1 ? null : found;
}
