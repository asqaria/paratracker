import { TRACK_FLAGS } from '@skyline/core';
import { describe, expect, it } from 'vitest';

import { derivedFixture, expectClose, expectHeadingsClose } from './testing/fixtures.js';
import {
  readTrack,
  TRACK_FIELDS,
  TRACK_FORMAT_VERSION,
  TRACK_HEADER_BYTES,
  TRACK_RANGES,
  trackLayout,
  writeTrack,
  type TrackChannels,
} from './track-file.js';

/**
 * Допуски = половина шага квантования формата (ТЗ §5.4). По координатам шаг 1e-7°,
 * то есть 5e-8, плюс погрешность double на сложении с опорной точкой — берём 6e-8.
 * Ошибка не накапливается: delta-of-delta складывается в целых числах.
 */
const TOLERANCE = { degrees: 6e-8, altitude: 0.5, speed: 0.005, heading: 0.005 };
const ALL_FIELDS = Object.values(TRACK_FIELDS).reduce((mask, bit) => mask | bit, 0);
const T0 = Date.UTC(2026, 6, 15, 9);

/** Гладкий синтетический трек: вторые разности координат нулевые. */
function synthetic(pointCount: number): Required<TrackChannels> {
  const index = Array.from({ length: pointCount }, (_, i) => i);
  return {
    t: Float64Array.from(index, (i) => T0 + i * 1000),
    lat: Float64Array.from(index, (i) => 43.128 + i * 1e-4),
    lon: Float64Array.from(index, (i) => 76.955 + i * 1e-4),
    alt: Float64Array.from(index, (i) => 2350 + i),
    vSpeed: Float64Array.from(index, (i) => ((i % 7) - 3) / 2),
    gSpeed: Float64Array.from(index, (i) => 10 + (i % 5) / 4),
    heading: Float64Array.from(index, (i) => (i * 13) % 360),
    altAgl: Float64Array.from(index, (i) => 500 + (i % 11)),
    flags: Uint8Array.from(index, (i) => (i % 3 === 0 ? TRACK_FLAGS.thermal : 0)),
  };
}

describe('заголовок и раскладка', () => {
  it('magic, версия и число точек', () => {
    const buffer = writeTrack(synthetic(5));
    const header = new DataView(buffer);

    expect(String.fromCharCode(...new Uint8Array(buffer, 0, 4))).toBe('SKTR');
    expect(header.getUint16(4, true)).toBe(TRACK_FORMAT_VERSION);
    expect(readTrack(buffer)).toMatchObject({ pointCount: 5, version: TRACK_FORMAT_VERSION });
  });

  it.each([1, 2, 3, 7, 9, 15, 101, 1001])('нечётное и чётное число точек: колонки выровнены по 8 байт (%i)', (n) => {
    const layout = trackLayout(n, ALL_FIELDS);

    for (const [name, offset] of Object.entries(layout.offsets)) expect(offset % 8, name).toBe(0);
    expect(layout.byteLength % 8).toBe(0);
    expect(layout.offsets.dt).toBe(TRACK_HEADER_BYTES);

    // Главное: чтение не должно бросить RangeError ни при каком pointCount.
    const channels = synthetic(n);
    const file = readTrack(writeTrack(channels));
    expect(file.pointCount).toBe(n);
    expectClose(file.lat, channels.lat, TOLERANCE.degrees, 'lat');
  });

  it('пустой трек', () => {
    const file = readTrack(writeTrack({ t: new Float64Array(), lat: new Float64Array(), lon: new Float64Array() }));
    expect(file).toMatchObject({ pointCount: 0, gaps: [] });
    expect(file.t.length).toBe(0);
  });
});

describe('round-trip', () => {
  it('все каналы возвращаются типизированными массивами', () => {
    const channels = synthetic(31);
    const file = readTrack(writeTrack(channels));

    expect(file.t).toBeInstanceOf(Float64Array);
    expect(file.lat).toBeInstanceOf(Float64Array);
    expect(file.flags).toBeInstanceOf(Uint8Array);

    expect(Array.from(file.t)).toEqual(Array.from(channels.t));
    expectClose(file.lat, channels.lat, TOLERANCE.degrees, 'lat');
    expectClose(file.lon, channels.lon, TOLERANCE.degrees, 'lon');
    expectClose(file.alt, channels.alt, TOLERANCE.altitude, 'alt');
    expectClose(file.vSpeed, channels.vSpeed, TOLERANCE.speed, 'vSpeed');
    expectClose(file.gSpeed, channels.gSpeed, TOLERANCE.speed, 'gSpeed');
    expectHeadingsClose(file.heading, channels.heading, TOLERANCE.heading);
    expectClose(file.altAgl, channels.altAgl, TOLERANCE.altitude, 'altAgl');
    expect(Array.from(file.flags ?? [])).toEqual(Array.from(channels.flags));
  });

  it('необязательные каналы: чего не записали, того нет', () => {
    const { t, lat, lon, alt } = synthetic(9);
    const file = readTrack(writeTrack({ t, lat, lon, alt }));

    expect(file.alt).toBeInstanceOf(Float64Array);
    expect(file.vSpeed).toBeUndefined();
    expect(file.heading).toBeUndefined();
    expect(file.flags).toBeUndefined();
  });

  it('один и тот же вход даёт одинаковые байты', () => {
    const channels = synthetic(17);
    expect(new Uint8Array(writeTrack(channels))).toEqual(new Uint8Array(writeTrack(channels)));
  });

  it('координаты пишутся delta-of-delta: на гладком треке вторые разности нулевые', () => {
    const channels = synthetic(64);
    const layout = trackLayout(64, ALL_FIELDS);
    const dLat = new Int32Array(writeTrack(channels), layout.offsets.dLat, 64);

    // Первое значение — смещение от lat0 (нулевое), дальше — разность разностей.
    expect(dLat[0]).toBe(0);
    expect(Array.from(dLat.subarray(2))).toEqual(Array<number>(62).fill(0));
  });

  it('высота ниже уровня моря и отрицательная скороподъёмность', () => {
    const channels = { ...synthetic(11) };
    channels.alt = Float64Array.from(channels.alt, (_, i) => -400 - i);
    channels.vSpeed = Float64Array.from(channels.vSpeed, () => -3.25);

    const file = readTrack(writeTrack(channels));
    expectClose(file.alt, channels.alt, TOLERANCE.altitude, 'alt');
    expectClose(file.vSpeed, channels.vSpeed, TOLERANCE.speed, 'vSpeed');
  });

  it('трек через антимеридиан', () => {
    const lon = Float64Array.of(179.9998, 179.9999, -179.9999, -179.9998, -179.9997);
    const channels = { ...synthetic(5), lon };

    expectClose(readTrack(writeTrack(channels)).lon, lon, TOLERANCE.degrees, 'lon');
  });

  it('курс у 360° не переворачивается', () => {
    const heading = Float64Array.of(0, 359.999, 180.004, 359.996, 90);
    const channels = { ...synthetic(5), heading };

    expectHeadingsClose(readTrack(writeTrack(channels)).heading, heading, TOLERANCE.heading);
  });

  it('NaN сохраняется как «нет значения»', () => {
    const channels = { ...synthetic(6) };
    channels.alt[2] = Number.NaN;
    channels.vSpeed[3] = Number.NaN;
    channels.gSpeed[4] = Number.NaN;
    channels.heading[5] = Number.NaN;

    const file = readTrack(writeTrack(channels));
    expect(file.alt?.[2]).toBeNaN();
    expect(file.vSpeed?.[3]).toBeNaN();
    expect(file.gSpeed?.[4]).toBeNaN();
    expect(file.heading?.[5]).toBeNaN();
    expect(file.alt?.[1]).toBeCloseTo(2351, 6);
  });

  it('значения вне диапазона колонки клипуются, а не переполняются', () => {
    const channels = { ...synthetic(3) };
    channels.alt = Float64Array.of(40_000, -40_000, 0);
    channels.gSpeed = Float64Array.of(900, 0, 1);

    const file = readTrack(writeTrack(channels));
    expect(file.alt?.[0]).toBe(32_767);
    expect(file.alt?.[1]).toBe(-32_767);
    expect(file.gSpeed?.[0]).toBeCloseTo(655.34, 2);
  });
});

describe('разрывы', () => {
  it('dt дольше 65 534 мс — 0xFFFF и запись в таблице разрывов', () => {
    const t = Float64Array.of(T0, T0 + 1000, T0 + 91_000, T0 + 92_000);
    const channels = { ...synthetic(4), t };
    const buffer = writeTrack(channels);
    const layout = trackLayout(4, ALL_FIELDS);
    const dt = new Uint16Array(buffer, layout.offsets.dt, 4);

    expect(Array.from(dt)).toEqual([0, 1000, 0xffff, 1000]);
    const file = readTrack(buffer);
    expect(file.gaps).toEqual([{ index: 2, durationMs: 90_000 }]);
    expect(Array.from(file.t)).toEqual(Array.from(t));
  });

  it('несколько разрывов, включая ровно 65 535 мс', () => {
    const t = Float64Array.of(T0, T0 + 65_534, T0 + 131_069, T0 + 196_604);
    const channels = { ...synthetic(4), t };
    const file = readTrack(writeTrack(channels));

    expect(file.gaps.map((gap) => gap.index)).toEqual([2, 3]);
    expect(Array.from(file.t)).toEqual(Array.from(t));
  });
});

describe('ошибки', () => {
  it('чужой файл — понятная ошибка', () => {
    const alien = new Uint8Array(TRACK_HEADER_BYTES);
    alien.set([0x50, 0x4b, 0x03, 0x04]);
    expect(() => readTrack(alien)).toThrow(/SKTR/);
  });

  it('другая версия формата', () => {
    const buffer = writeTrack(synthetic(4));
    new DataView(buffer).setUint16(4, TRACK_FORMAT_VERSION + 1, true);
    expect(() => readTrack(buffer)).toThrow(/version/i);
  });

  it('обрезанный файл', () => {
    const buffer = writeTrack(synthetic(20));
    expect(() => readTrack(buffer.slice(0, TRACK_HEADER_BYTES + 8))).toThrow(/truncated|short/i);
  });

  it('колонки разной длины — ошибка программиста, а не тихая порча', () => {
    const channels = synthetic(5);
    expect(() => writeTrack({ ...channels, alt: Float64Array.of(1, 2) })).toThrow(/length/i);
  });
});

describe('фикстуры: round-trip после разбора и чистки', () => {
  it.each(['baseline.igc', 'gaps.igc', 'sparse-10s.igc', 'v-fixes.igc', 'no-baro.igc', 'negative-alt.igc', 'time-offset.gpx'])(
    '%s',
    (name) => {
      const { points } = derivedFixture(name);
      const channels: TrackChannels = {
        t: points.t,
        lat: points.lat,
        lon: points.lon,
        alt: points.altitude,
        vSpeed: points.vSpeedInstant,
        gSpeed: points.groundSpeed,
        heading: points.heading,
        flags: points.flags,
      };

      const file = readTrack(writeTrack(channels));

      expect(file.pointCount).toBe(points.t.length);
      expect(Array.from(file.t)).toEqual(Array.from(points.t));
      expectClose(file.lat, points.lat, TOLERANCE.degrees, 'lat');
      expectClose(file.lon, points.lon, TOLERANCE.degrees, 'lon');
      expectClose(file.alt, points.altitude, TOLERANCE.altitude, 'alt');
      expectClose(file.vSpeed, points.vSpeedInstant, TOLERANCE.speed, 'vSpeed');
      // Колонка gSpeed — Uint16 × 100, потолок 655 м/с (ТЗ §5.4). На стыке цикла
      // генератор «телепортирует» трек на 5.4 км за секунду — запись это клипует.
      const clampedGSpeed = Float64Array.from(points.groundSpeed, (v) => Math.min(v, TRACK_RANGES.maxGroundSpeedMs));
      expectClose(file.gSpeed, clampedGSpeed, TOLERANCE.speed, 'gSpeed');
      expectHeadingsClose(file.heading, points.heading, TOLERANCE.heading);
      expect(Array.from(file.flags ?? [])).toEqual(Array.from(points.flags));
    },
  );

  it('sparse-10s.igc даёт нечётное число точек — выравнивание проверено на реальном треке', () => {
    expect(derivedFixture('sparse-10s.igc').points.t.length % 2).toBe(1);
  });

  it('gaps.igc: разрывы 90 с и 12 мин попадают в таблицу разрывов', () => {
    const { points } = derivedFixture('gaps.igc');
    const file = readTrack(writeTrack({ t: points.t, lat: points.lat, lon: points.lon, flags: points.flags }));

    // Разрывы 90 с и 12 мин поверх шага сетки 1 с.
    expect(file.gaps.map((gap) => gap.durationMs)).toEqual([91_000, 721_000]);
    expect(Array.from(file.t)).toEqual(Array.from(points.t));
    // Края разрывов остаются помеченными флагом gap (ТЗ §5.4, бит 0).
    expect(file.flags?.filter((f) => (f & TRACK_FLAGS.gap) !== 0).length).toBe(4);
  });
});

describe('размер', () => {
  it('15 000 точек со всеми каналами — 315 КБ ± 5% (ТЗ §5.4: 21 байт на точку)', () => {
    const bytes = writeTrack(synthetic(15_000)).byteLength;
    const target = 21 * 15_000;

    expect(Math.abs(bytes / target - 1)).toBeLessThan(0.05);
  });
});
