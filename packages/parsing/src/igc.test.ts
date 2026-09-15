import { readFileSync } from 'node:fs';

import { pointAt, type ParsedTrack, type ParseWarningCode } from '@skyline/core';
import { describe, expect, it } from 'vitest';

import { parseIgc, type IgcParseOptions } from './igc.js';

const FIXTURES = new URL('../../../fixtures/', import.meta.url);

/** Эталоны сверяются с допуском 1e-9, а не «примерно» (CLAUDE.md). */
const TOLERANCE_DEG = 1e-9;

/** Фикстуры датированы до 22.11.2026 (south-west.igc) — «сейчас» должно быть позже. */
const NOW = Date.UTC(2027, 0, 1);

interface Sample {
  index: number;
  timeUtcSeconds: number;
  lat: number;
  lon: number;
  altBaro: number | null;
  altGnss: number;
  valid: boolean;
}

interface FixtureExpectation {
  pointCount: number;
  dateHeaderRaw: string;
  altitudeSource: 'baro' | 'gnss';
  iRecord: string | null;
  medianFixIntervalSeconds: number;
  maxFixIntervalSeconds: number;
  invalidFixCount: number;
  minWarnings: number;
  samples: { first: Sample; middle: Sample; last: Sample };
  bounds: { minLat: number; maxLat: number; minLon: number; maxLon: number; minAlt: number; maxAlt: number };
}

const expected = JSON.parse(readFileSync(new URL('expected.json', FIXTURES), 'utf8')) as Record<
  string,
  FixtureExpectation
>;

/** Даты заголовков фикстур, записанные вручную по §3.3 (DDMMYY, YY < 80 → 20YY). */
const HEADER_DATES: Record<string, string> = {
  HFDTE150726: '2026-07-15',
  'HFDTEDATE:150726,01': '2026-07-15',
  HFDTE221126: '2026-11-22',
  HFDTE030426: '2026-04-03',
};

const readFixture = (name: string): Uint8Array => readFileSync(new URL(name, FIXTURES));

function parse(input: string | Uint8Array, options: Partial<IgcParseOptions> = {}): ParsedTrack {
  const result = parseIgc(input, { now: NOW, ...options });
  if (!result.ok) throw new Error(`parse failed: ${result.code}`);
  return result.track;
}

function expectDeg(actual: number, wanted: number, label: string): void {
  expect(Math.abs(actual - wanted), `${label}: ${actual} vs ${wanted}`).toBeLessThanOrEqual(TOLERANCE_DEG);
}

const igc = (...lines: string[]): string => lines.join('\r\n') + '\r\n';
const HEADER = ['AXSKFIXTURE', 'HFDTE150726'];
/** Эталонная строка из ТЗ §3.3. */
const REFERENCE_FIX = 'B0940094646616N01308990EA0175201889';
const fixAt = (hhmmss: string): string => `B${hhmmss}4646616N01308990EA0175201889`;
const codes = (track: ParsedTrack): ParseWarningCode[] => track.warnings.map((w) => w.code);

describe.each(Object.entries(expected))('%s', (name, exp) => {
  const track = parse(readFixture(name));
  const { points } = track;
  const count = points.t.length;

  it('количество точек, источник высоты, 2D-фиксы', () => {
    expect(count).toBe(exp.pointCount);
    expect(track.altitudeSource).toBe(exp.altitudeSource);
    expect(points.valid.filter((v) => v === 0).length).toBe(exp.invalidFixCount);
    const { t, lat, lon, altBaro, altGnss, valid, fxa, siu } = points;
    for (const column of [t, lat, lon, altBaro, altGnss, valid, fxa, siu]) expect(column.length).toBe(count);
  });

  it('дата из заголовка', () => {
    expect(track.meta).toMatchObject({ date: HEADER_DATES[exp.dateHeaderRaw], dateSource: 'header' });
  });

  it.each(['first', 'middle', 'last'] as const)('контрольная точка %s', (key) => {
    const sample = exp.samples[key];
    const point = pointAt(points, sample.index);
    const dayStart = Date.parse(`${HEADER_DATES[exp.dateHeaderRaw]}T00:00:00Z`);

    expect(point.t).toBe(dayStart + sample.timeUtcSeconds * 1000);
    expectDeg(point.lat, sample.lat, 'lat');
    expectDeg(point.lon, sample.lon, 'lon');
    expect(point.altBaro).toBe(sample.altBaro);
    expect(point.altGnss).toBe(sample.altGnss);
    expect(point.valid).toBe(sample.valid);
  });

  it('границы по всем точкам', () => {
    expectDeg(Math.min(...points.lat), exp.bounds.minLat, 'minLat');
    expectDeg(Math.max(...points.lat), exp.bounds.maxLat, 'maxLat');
    expectDeg(Math.min(...points.lon), exp.bounds.minLon, 'minLon');
    expectDeg(Math.max(...points.lon), exp.bounds.maxLon, 'maxLon');
    expect(Math.min(...points.altGnss)).toBe(exp.bounds.minAlt);
    expect(Math.max(...points.altGnss)).toBe(exp.bounds.maxAlt);
  });

  it('интервалы между фиксами', () => {
    const steps = Array.from(points.t.subarray(1), (t, i) => (t - (points.t[i] ?? 0)) / 1000).sort((a, b) => a - b);
    expect(steps.every((s) => s > 0)).toBe(true);
    expect(steps[Math.floor(steps.length / 2)]).toBe(exp.medianFixIntervalSeconds);
    expect(steps.at(-1)).toBe(exp.maxFixIntervalSeconds);
  });

  it('предупреждений не меньше эталона', () => {
    expect(track.warnings.length).toBeGreaterThanOrEqual(exp.minWarnings);
  });
});

describe('B-запись', () => {
  it('эталонная строка ТЗ §3.3: широта 8 символов, долгота 9', () => {
    const point = pointAt(parse(igc(...HEADER, REFERENCE_FIX)).points, 0);

    expect(point.t).toBe(Date.UTC(2026, 6, 15, 9, 40, 9));
    expectDeg(point.lat, 46.776933333, 'lat'); // 46° 46.616′
    expectDeg(point.lon, 13.149833333, 'lon'); // 13° 08.990′
    expect(point).toMatchObject({ altBaro: 1752, altGnss: 1889, valid: true });
  });

  it('строка и байты дают один результат', () => {
    const bytes = readFixture('baseline.igc');
    const text = String.fromCharCode(...bytes);
    expect(parse(text)).toEqual(parse(bytes));
  });

  it('расширения FXA и SIU читаются по позициям из I-записи', () => {
    const { points } = parse(readFixture('extensions-full.igc'));
    expect(pointAt(points, 0)).toMatchObject({ fxa: 12, siu: 9 });
    expect(pointAt(parse(readFixture('baseline.igc')).points, 0)).not.toHaveProperty('fxa');
  });

  it('строка короче расширения — точка есть, расширения нет', () => {
    const { points } = parse(igc(...HEADER, 'I023638FXA3940SIU', `${REFERENCE_FIX}012`));
    expect(pointAt(points, 0)).toMatchObject({ fxa: 12 });
    expect(pointAt(points, 0)).not.toHaveProperty('siu');
  });

  it('битая I-запись — предупреждение, точки разбираются', () => {
    const track = parse(igc(...HEADER, 'I02363', REFERENCE_FIX));
    expect(track.warnings).toEqual([{ code: 'malformed_extensions', line: 3 }]);
    expect(track.points.t.length).toBe(1);
  });
});

describe('время', () => {
  it('переход через полночь UTC — +1 сутки, трек монотонен', () => {
    const { points } = parse(readFixture('midnight.igc'));
    expect(points.t.every((t, i) => i === 0 || t > (points.t[i - 1] ?? Infinity))).toBe(true);
  });

  it('дубликат по времени отброшен (первый остаётся), фикс не по порядку пропущен', () => {
    const track = parse(
      igc(...HEADER, fixAt('100000'), fixAt('100001'), fixAt('100001'), fixAt('100000'), fixAt('100002')),
    );
    expect(Array.from(track.points.t, (t) => (t - Date.UTC(2026, 6, 15, 10)) / 1000)).toEqual([0, 1, 2]);
    expect(track.warnings).toEqual([
      { code: 'duplicate_fix', line: 5 },
      { code: 'out_of_order_fix', line: 6 },
    ]);
  });
});

describe('дата', () => {
  it('HFDTEDATE:DDMMYY,NN — современный формат', () => {
    expect(parse(igc('HFDTEDATE:030426,02', REFERENCE_FIX)).meta.date).toBe('2026-04-03');
  });

  it('невозможная дата в заголовке — предупреждение, даты нет', () => {
    const track = parse(igc('HFDTE320726', REFERENCE_FIX));
    expect(track.meta).toMatchObject({ date: null, dateSource: null });
    expect(codes(track)).toEqual(['date_header_invalid', 'date_missing']);
  });

  it('дата раньше 1990 — битый заголовок', () => {
    const track = parse(igc('HFDTE150789', REFERENCE_FIX));
    expect(track.meta.date).toBeNull();
    expect(codes(track)).toEqual(['date_out_of_range', 'date_missing']);
  });

  it('дата в будущем — битый заголовок; опережение до суток допускается', () => {
    const text = igc('HFDTE150726', REFERENCE_FIX);
    expect(parse(text, { now: Date.UTC(2026, 6, 1) }).meta.date).toBeNull();
    expect(parse(text, { now: Date.UTC(2026, 6, 14, 12) }).meta.date).toBe('2026-07-15');
  });

  it('без заголовка — дата из длинного имени файла IGC', () => {
    const track = parse(igc(REFERENCE_FIX), { fileName: 'C:\\tracks\\2026-07-15-XCT-ABC-01.igc' });
    expect(track.meta).toMatchObject({ date: '2026-07-15', dateSource: 'filename' });
    expect(codes(track)).toEqual(['date_from_filename']);
    expect(track.points.t[0]).toBe(Date.UTC(2026, 6, 15, 9, 40, 9));
  });

  it('без заголовка — дата из короткого имени YMDCXXXF (год — ближайший не позже «сейчас»)', () => {
    expect(parse(igc(REFERENCE_FIX), { fileName: '67FXABC1.IGC' }).meta.date).toBe('2026-07-15');
  });

  it('заголовок важнее имени файла', () => {
    const track = parse(igc('HFDTE030426', REFERENCE_FIX), { fileName: '2026-07-15-XCT-ABC-01.igc' });
    expect(track.meta).toMatchObject({ date: '2026-04-03', dateSource: 'header' });
  });

  it('даты нет нигде — date null, время от начала эпохи, предупреждение', () => {
    const track = parse(igc(REFERENCE_FIX));
    expect(track.meta).toMatchObject({ date: null, dateSource: null });
    expect(codes(track)).toEqual(['date_missing']);
    expect(track.points.t[0]).toBe((9 * 3600 + 40 * 60 + 9) * 1000);
  });
});

describe('заголовки и высоты', () => {
  it('метаданные из A- и H-записей, подпись из G', () => {
    const { meta } = parse(readFixture('baseline.igc'));
    expect(meta).toEqual({
      date: '2026-07-15',
      dateSource: 'header',
      logger: 'XCT Skyline fixture generator',
      pilot: 'Test Pilot',
      glider: 'Ozone Zeno 2',
      gliderId: 'FIXTURE',
      device: 'Skyline,Fixture',
      signature: 'DEADBEEF00000000000000000000000000000000',
    });
  });

  it('датум не WGS84 — предупреждение', () => {
    expect(codes(parse(igc(...HEADER, 'HFDTM100GPSDATUM:NAD27', REFERENCE_FIX)))).toEqual(['unexpected_datum']);
  });

  it('нет баровысоты — источник GNSS и предупреждение (ТЗ §3.3)', () => {
    const track = parse(readFixture('no-baro.igc'));
    expect(codes(track)).toContain('no_baro_altitude');
    expect(track.points.altBaro.every(Number.isNaN)).toBe(true);
  });

  it('нет GNSS-высоты — предупреждение, баро остаётся', () => {
    const track = parse(igc(...HEADER, 'B0940094646616N01308990EA0175200000'));
    expect(codes(track)).toEqual(['no_gnss_altitude']);
    expect(pointAt(track.points, 0)).toMatchObject({ altBaro: 1752, altGnss: null });
  });
});

describe('устойчивость: парсер не бросает на кривых строках', () => {
  it('broken-lines.igc: мусор пропущен, у каждой непустой битой строки — предупреждение', () => {
    const track = parse(readFixture('broken-lines.igc'));
    expect(track.points.t.length).toBe(expected['broken-lines.igc']?.pointCount);
    expect(track.warnings).toEqual([
      { code: 'malformed_fix', line: 21 }, // обрезанная B-запись
      { code: 'unknown_record', line: 61 }, // текст вместо записи
      { code: 'unknown_record', line: 141 }, // неизвестный тип Q
      { code: 'malformed_fix', line: 181 }, // широта на символ короче — полушарие не на месте
    ]);
  });

  it('набор злых строк посреди трека', () => {
    const nasty = [
      'B',
      `B${'9'.repeat(40)}`,
      'B0940094646616X01308990EA0175201889', // полушарие
      'B0940099946616N01308990EA0175201889', // широта 99°
      'B0940094646616N18108990EA0175201889', // долгота 181°
      'B0940094666616N01308990EA0175201889', // 66 минут
      'B0940094646616N01308990EX0175201889', // флаг валидности
      'B0940094646616N01308990EA01x5201889', // высота
      '\u0000\u0001',
      '\u00ff\u00ff\u00ff',
      'I',
      'H',
      '   ',
    ];
    const lines = igc(...HEADER, ...nasty, fixAt('100000'), fixAt('100001'));

    const track = parse(lines);
    expect(track.points.t.length).toBe(2);
    expect(codes(track)).toEqual([
      ...Array<ParseWarningCode>(8).fill('malformed_fix'),
      'unknown_record',
      'unknown_record',
      'malformed_extensions',
    ]);
  });

  it('UTF-8 BOM в начале файла не мешает', () => {
    expect(parse(`\uFEFF${igc(...HEADER, REFERENCE_FIX)}`).warnings).toEqual([]);
  });
});

describe('отказ по файлу целиком', () => {
  it('файл больше лимита', () => {
    expect(parseIgc(readFixture('baseline.igc'), { now: NOW, limits: { maxFileBytes: 1000 } })).toMatchObject({
      ok: false,
      code: 'file_too_large',
    });
  });

  it('точек больше лимита', () => {
    expect(parseIgc(readFixture('baseline.igc'), { now: NOW, limits: { maxPoints: 959 } })).toMatchObject({
      ok: false,
      code: 'too_many_points',
    });
  });

  it('ни одной точки', () => {
    expect(parseIgc(igc(...HEADER, 'B1701'), { now: NOW })).toEqual({
      ok: false,
      code: 'no_fixes',
      warnings: [{ code: 'malformed_fix', line: 3 }],
    });
  });
});
