import { readTrack } from '@skyline/track-format';

/**
 * Декодирование .track в колонки для сцены. ТЗ §7.7: делается в Web Worker,
 * буфер приходит как transferable; здесь — чистая функция, чтобы её можно
 * было проверить тестом без воркера.
 */

export interface DecodedTrack {
  pointCount: number;
  t: Float64Array;
  lat: Float64Array;
  lon: Float64Array;
  alt: Float64Array;
  vSpeed: Float64Array;
  flags: Uint8Array;
}

export function decodeTrack(buffer: ArrayBuffer): DecodedTrack {
  const file = readTrack(buffer);
  const count = file.pointCount;
  return {
    pointCount: count,
    t: file.t,
    lat: file.lat,
    lon: file.lon,
    alt: file.alt ?? new Float64Array(count).fill(Number.NaN),
    vSpeed: file.vSpeed ?? new Float64Array(count).fill(Number.NaN),
    flags: file.flags ?? new Uint8Array(count),
  };
}

/** Буферы всех колонок — для postMessage(..., transfer). */
export function transferables(track: DecodedTrack): ArrayBuffer[] {
  return [track.t, track.lat, track.lon, track.alt, track.vSpeed, track.flags].map(
    (column) => column.buffer as ArrayBuffer,
  );
}
