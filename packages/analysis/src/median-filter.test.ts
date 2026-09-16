import { describe, expect, it } from 'vitest';

import { medianFilterCoordinates } from './median-filter.js';
import { seconds, track } from './testing/tracks.js';

const OPTIONS = { window: 3, maxGapS: 30 };

describe('medianFilterCoordinates', () => {
  it('одиночный выброс убран, плавный ход не тронут', () => {
    const input = track({
      t: seconds(0, 1, 2, 3, 4),
      lat: [43.0, 43.001, 50.0, 43.003, 43.004],
      lon: [77.0, 77.001, 77.002, -10.0, 77.004],
    });

    const { lat, lon } = medianFilterCoordinates(input, OPTIONS);

    expect(Array.from(lat)).toEqual([43.0, 43.001, 43.003, 43.004, 43.004]);
    expect(Array.from(lon)).toEqual([77.0, 77.001, 77.001, 77.002, 77.004]);
  });

  it('края сегмента не меняются — полного окна там нет', () => {
    const { lat } = medianFilterCoordinates(track({ t: seconds(0, 1, 2), lat: [99, 1, 2] }), OPTIONS);
    expect(Array.from(lat)).toEqual([99, 2, 2]);
  });

  it('через разрыв дольше 30 с соседи не берутся', () => {
    const { lat } = medianFilterCoordinates(track({ t: seconds(0, 1, 2, 100, 101), lat: [1, 2, 3, 10, 11] }), OPTIONS);
    // Точки 2 и 100 — края сегментов, у каждой нет соседа с одной стороны.
    expect(Array.from(lat)).toEqual([1, 2, 3, 10, 11]);
  });

  it('прочие колонки те же, исходные массивы не изменены', () => {
    const input = track({ t: seconds(0, 1, 2), lat: [1, 50, 3], altBaro: [10, 11, 12] });
    const before = Array.from(input.lat);

    const output = medianFilterCoordinates(input, OPTIONS);

    expect(Array.from(input.lat)).toEqual(before);
    expect(output.altBaro).toBe(input.altBaro);
    expect(output.t).toBe(input.t);
  });
});
