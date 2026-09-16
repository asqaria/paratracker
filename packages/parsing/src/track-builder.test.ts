import { PARSER, type TrackColumns } from '@skyline/core';
import { describe, expect, it } from 'vitest';

import { summarizeAltitudes, TrackBuilder, WarningLog, type FixValues } from './track-builder.js';

const fix = (t: number, overrides: Partial<FixValues> = {}): FixValues => ({
  t,
  lat: 43.128,
  lon: 76.955,
  altBaro: Number.NaN,
  altGnss: 2400,
  valid: 1,
  fxa: Number.NaN,
  siu: Number.NaN,
  ...overrides,
});

describe('TrackBuilder', () => {
  it('копит точки, растит ёмкость и отдаёт колонки ровно нужной длины', () => {
    const builder = new TrackBuilder({ maxPoints: 100, warnings: new WarningLog(), initialCapacity: 2 });
    for (let t = 0; t < 5; t++) expect(builder.push(fix(t, { lat: t }), t + 1)).toBe('added');

    const columns = builder.finish();
    expect(Array.from(columns.t)).toEqual([0, 1, 2, 3, 4]);
    expect(Array.from(columns.lat)).toEqual([0, 1, 2, 3, 4]);
    // Отдельный буфер точного размера — можно передать в другой поток.
    expect(columns.t.buffer.byteLength).toBe(5 * Float64Array.BYTES_PER_ELEMENT);
    expect(builder.lastTime).toBe(4);
  });

  it('дубликат по времени и точка раньше предыдущей пропускаются с предупреждением', () => {
    const warnings = new WarningLog();
    const builder = new TrackBuilder({ maxPoints: 100, warnings });

    expect([0, 1, 1, 0, 2].map((t, i) => builder.push(fix(t), i + 1))).toEqual([
      'added',
      'added',
      'skipped',
      'skipped',
      'added',
    ]);
    expect(builder.count).toBe(3);
    expect(warnings.list()).toEqual([
      { code: 'duplicate_fix', line: 3 },
      { code: 'out_of_order_fix', line: 4 },
    ]);
  });

  it('точка сверх лимита — limit', () => {
    const builder = new TrackBuilder({ maxPoints: 2, warnings: new WarningLog() });
    expect([0, 1, 2].map((t) => builder.push(fix(t), undefined))).toEqual(['added', 'added', 'limit']);
  });
});

describe('WarningLog', () => {
  it('после лимита — одно warnings_truncated в конце', () => {
    const log = new WarningLog();
    for (let i = 0; i < PARSER.maxWarnings + 5; i++) log.add('malformed_fix', i + 1);

    const list = log.list();
    expect(list).toHaveLength(PARSER.maxWarnings + 1);
    expect(list.at(-1)).toEqual({ code: 'warnings_truncated' });
  });
});

describe('summarizeAltitudes', () => {
  const columns = (altBaro: number[], altGnss: number[]): TrackColumns => ({
    t: Float64Array.from(altBaro, (_, i) => i),
    lat: new Float64Array(altBaro.length),
    lon: new Float64Array(altBaro.length),
    altBaro: Float64Array.from(altBaro),
    altGnss: Float64Array.from(altGnss),
    valid: new Uint8Array(altBaro.length),
    fxa: new Float64Array(altBaro.length),
    siu: new Float64Array(altBaro.length),
  });

  it('баро есть хотя бы у одной точки — источник baro', () => {
    const warnings = new WarningLog();
    expect(summarizeAltitudes(columns([Number.NaN, 2350], [2400, 2410]), warnings)).toBe('baro');
    expect(warnings.list()).toEqual([]);
  });

  it('баро нет — gnss и предупреждение; нет ничего — оба предупреждения', () => {
    const warnings = new WarningLog();
    expect(summarizeAltitudes(columns([Number.NaN], [2400]), warnings)).toBe('gnss');
    expect(summarizeAltitudes(columns([Number.NaN], [Number.NaN]), warnings)).toBe('gnss');
    expect(warnings.list().map((w) => w.code)).toEqual(['no_baro_altitude', 'no_baro_altitude', 'no_gnss_altitude']);
  });
});
