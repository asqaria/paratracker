import { writeTrack } from '@skyline/track-format';
import { describe, expect, it } from 'vitest';

import { decodeTrack, transferables } from './decode-track';

const track = (pointCount: number): ArrayBuffer => {
  const index = Array.from({ length: pointCount }, (_, i) => i);
  return writeTrack({
    t: Float64Array.from(index, (i) => Date.UTC(2026, 6, 15, 9) + i * 1000),
    lat: Float64Array.from(index, (i) => 43.128 + i * 1e-4),
    lon: Float64Array.from(index, (i) => 76.955 + i * 1e-4),
    alt: Float64Array.from(index, (i) => 2350 + i),
    vSpeed: Float64Array.from(index, (i) => (i % 2 === 0 ? 1.5 : -1.5)),
    flags: new Uint8Array(pointCount),
  });
};

describe('decodeTrack', () => {
  it('отдаёт колонки типизированными массивами', () => {
    const decoded = decodeTrack(track(5));

    expect(decoded.pointCount).toBe(5);
    expect(decoded.lat).toBeInstanceOf(Float64Array);
    expect(decoded.lat.length).toBe(5);
    expect(decoded.alt[0]).toBeCloseTo(2350, 6);
    expect(decoded.vSpeed[1]).toBeCloseTo(-1.5, 2);
  });

  it('каналов нет в файле — колонки из NaN, длина сохраняется', () => {
    const minimal = writeTrack({
      t: Float64Array.of(0, 1000),
      lat: Float64Array.of(43, 43.1),
      lon: Float64Array.of(76, 76.1),
    });

    const decoded = decodeTrack(minimal);
    expect(decoded.alt.every(Number.isNaN)).toBe(true);
    expect(decoded.vSpeed.every(Number.isNaN)).toBe(true);
    expect(Array.from(decoded.flags)).toEqual([0, 0]);
  });

  it('буферы колонок можно передать в основной поток как transferable', () => {
    const decoded = decodeTrack(track(3));
    const buffers = transferables(decoded);

    expect(buffers).toHaveLength(6);
    expect(new Set(buffers).size).toBe(6);
    for (const buffer of buffers) expect(buffer.byteLength).toBeGreaterThan(0);
  });
});
