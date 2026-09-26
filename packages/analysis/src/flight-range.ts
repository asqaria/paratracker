import { FLIGHT, TIME, type FlightRange } from '@skyline/core';

const medianOf = (values: number[]): number => {
  const sorted = values.map((v) => (Number.isFinite(v) ? v : 0)).sort((a, b) => a - b);
  return sorted[sorted.length >> 1] ?? 0;
};

/**
 * Взлёт — первый момент, с которого скорость держится выше FLIGHT.flyingSpeedMs
 * FLIGHT.flyingWindowS секунд; уточняется до первой точки быстрее порога, иначе
 * медиана окна ставила бы взлёт на полокна раньше. Посадка — то же с конца.
 * Полёта нет вовсе — вся запись земля (takeoff = landing = последняя точка).
 */
export function flightRange(t: Float64Array, speed: Float64Array): FlightRange {
  const n = t.length;
  const windowMs = FLIGHT.flyingWindowS * TIME.msPerSecond;
  const flying = (i: number): boolean => (speed[i] ?? 0) > FLIGHT.flyingSpeedMs;
  const windowFrom = (i: number, step: 1 | -1): number[] => {
    const values: number[] = [];
    for (let j = i; j >= 0 && j < n && Math.abs((t[j] ?? 0) - (t[i] ?? 0)) <= windowMs; j += step) {
      values.push(speed[j] ?? 0);
    }
    return values;
  };

  let takeoff = 0;
  while (takeoff < n && !(medianOf(windowFrom(takeoff, 1)) > FLIGHT.flyingSpeedMs)) takeoff++;
  if (takeoff >= n) return { takeoff: n - 1, landing: n - 1 };
  while (takeoff < n - 1 && !flying(takeoff)) takeoff++;

  let landing = n - 1;
  while (landing > takeoff && !(medianOf(windowFrom(landing, -1)) > FLIGHT.flyingSpeedMs)) landing--;
  while (landing > takeoff && !flying(landing)) landing--;
  return { takeoff, landing };
}
