import type { TrackColumns } from '@skyline/core';

import { breakAfterGap, forEachSegment } from './grid.js';

export interface MedianFilterOptions {
  /** Нечётный размер окна. */
  window: number;
  /** Соседи через пропуск дольше этого не берутся. */
  maxGapS: number;
}

function windowMedian(values: Float64Array, from: number, buffer: Float64Array): number {
  for (let k = 0; k < buffer.length; k++) buffer[k] = values[from + k] ?? Number.NaN;
  buffer.sort();
  return buffer[buffer.length >> 1] ?? Number.NaN;
}

/**
 * ТЗ §5.2 шаг 3: медианный фильтр широты и долготы — убирает одиночные выбросы.
 * Покомпонентно, внутри сегментов; у краёв сегмента полного окна нет — точки не меняются.
 * Возвращает новые lat/lon; остальные колонки — те же массивы.
 */
export function medianFilterCoordinates(points: TrackColumns, options: MedianFilterOptions): TrackColumns {
  const lat = Float64Array.from(points.lat);
  const lon = Float64Array.from(points.lon);
  const half = options.window >> 1;
  const buffer = new Float64Array(options.window);

  forEachSegment(points.t, breakAfterGap(options.maxGapS), (start, end) => {
    for (let i = start + half; i <= end - half; i++) {
      lat[i] = windowMedian(points.lat, i - half, buffer);
      lon[i] = windowMedian(points.lon, i - half, buffer);
    }
  });

  return { ...points, lat, lon };
}
