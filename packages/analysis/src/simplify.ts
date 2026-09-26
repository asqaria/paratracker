import { GEO, SIMPLIFY } from '@skyline/core';

/**
 * Упрощение трека для карты логбука (задача 2.11): Дуглас–Пекер в
 * равнопромежуточной проекции у широты первой точки. На масштабах одного
 * полёта (десятки км) её искажение — доли процента, меньше допуска.
 *
 * Расстояние — до отрезка, а не до бесконечной прямой: в спирали термика
 * точка может лежать на продолжении хорды далеко за её концом.
 */

export interface SimplifiedTrack {
  /** Индексы оставленных точек по возрастанию; первая и последняя — всегда. */
  indices: Int32Array;
  /** Допуск, с которым трек уложился в SIMPLIFY.maxPoints, м. */
  toleranceM: number;
}

const RADIANS_PER_DEGREE = Math.PI / 180;
const METRES_PER_DEGREE = GEO.meanEarthRadiusM * RADIANS_PER_DEGREE;
const DOUBLING = 2;

function douglasPeucker(xs: Float64Array, ys: Float64Array, toleranceM: number): Int32Array {
  const n = xs.length;
  if (n === 0) return new Int32Array(0);
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;

  // Стек вместо рекурсии: у многочасового трека глубина могла бы быть в тысячи.
  const stack: [number, number][] = [[0, n - 1]];
  for (let range = stack.pop(); range; range = stack.pop()) {
    const [a, b] = range;
    const ax = xs[a] ?? 0;
    const ay = ys[a] ?? 0;
    const dx = (xs[b] ?? 0) - ax;
    const dy = (ys[b] ?? 0) - ay;
    const lengthSq = dx * dx + dy * dy;

    let worst = -1;
    let worstDistance = 0;
    for (let i = a + 1; i < b; i++) {
      let px = (xs[i] ?? 0) - ax;
      let py = (ys[i] ?? 0) - ay;
      if (lengthSq > 0) {
        const u = Math.max(0, Math.min(1, (px * dx + py * dy) / lengthSq));
        px -= u * dx;
        py -= u * dy;
      }
      const distance = Math.hypot(px, py);
      if (distance > worstDistance) {
        worstDistance = distance;
        worst = i;
      }
    }
    if (worst >= 0 && worstDistance > toleranceM) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }

  let count = 0;
  for (const k of keep) count += k;
  const indices = new Int32Array(count);
  for (let i = 0, j = 0; i < n; i++) if (keep[i]) indices[j++] = i;
  return indices;
}

export function simplifyTrack(
  lat: Float64Array,
  lon: Float64Array,
  options: { toleranceM: number; maxPoints: number } = SIMPLIFY,
): SimplifiedTrack {
  const cosLat0 = Math.cos((lat[0] ?? 0) * RADIANS_PER_DEGREE);
  const xs = Float64Array.from(lon, (value) => value * cosLat0 * METRES_PER_DEGREE);
  const ys = Float64Array.from(lat, (value) => value * METRES_PER_DEGREE);

  let toleranceM = options.toleranceM;
  let indices = douglasPeucker(xs, ys, toleranceM);
  while (indices.length > options.maxPoints) {
    toleranceM *= DOUBLING;
    indices = douglasPeucker(xs, ys, toleranceM);
  }
  return { indices, toleranceM };
}
