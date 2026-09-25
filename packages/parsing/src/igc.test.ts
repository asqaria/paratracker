import { pointAt, type ParsedTrack, type ParseWarningCode } from '@skyline/core';
import { describe, expect, it } from 'vitest';

import { geoidHeightM } from './geoid.js';
import { parseIgc } from './igc.js';
import {
  defineFixtureChecks,
  expectation,
  expectDegrees,
  fixtureCases,
  NOW,
  readFixture,
  unwrap,
} from './testing/fixtures.js';
import type { ParseOptions } from './track-builder.js';

const parse = (input: string | Uint8Array, options: Partial<ParseOptions> = {}): ParsedTrack =>
  unwrap(parseIgc(input, { now: NOW, ...options }));

const igc = (...lines: string[]): string => lines.join('\r\n') + '\r\n';
const HEADER = ['AXSKFIXTURE', 'HFDTE150726'];
/** Эталонная строка из ТЗ §3.3. */
const REFERENCE_FIX = 'B0940094646616N01308990EA0175201889';
const fixAt = (hhmmss: string): string => `B${hhmmss}4646616N01308990EA0175201889`;
const codes = (track: ParsedTrack): ParseWarningCode[] => track.warnings.map((w) => w.code);

describe.each(fixtureCases('igc'))('%s', (name, exp) => {
  const track = parse(readFixture(name));
  defineFixtureChecks(track, exp, 'header');

  it('заголовок даты из эталона', () => {
    expect(exp.dateHeaderRaw).toMatch(/^HFDTE/);
  });
});

describe('B-запись', () => {
  it('эталонная строка ТЗ §3.3: широта 8 символов, долгота 9', () => {
    const point = pointAt(parse(igc(...HEADER, REFERENCE_FIX)).points, 0);

    expect(point.t).toBe(Date.UTC(2026, 6, 15, 9, 40, 9));
    expectDegrees(point.lat, 46.776933333, 'lat'); // 46° 46.616′
    expectDegrees(point.lon, 13.149833333, 'lon'); // 13° 08.990′
    expect(point).toMatchObject({ altBaro: 1752, valid: true });
    // Без HFALG высота над геоидом (CIVL 7H §3.2.1) → в эллипсоид.
    expect(point.altGnss).toBeCloseTo(1889 + geoidHeightM(point.lat, point.lon), 9);
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
      // baseline.igc без HFALG — высота над геоидом (CIVL 7H §3.2.1).
      gnssAltitudeDatum: 'assumed-geoid',
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
    expect(track.points.t.length).toBe(expectation('broken-lines.igc').pointCount);
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

describe('датум GNSS-высоты (HF ALG)', () => {
  const N = geoidHeightM(46.776933333333, 13.149833333333);
  const altGnssOf = (...headers: string[]): number | null =>
    pointAt(parse(igc(...HEADER, ...headers, REFERENCE_FIX)).points, 0).altGnss;

  it.each([
    ['HFALG:GEO', 'geoid'],
    ['HFALGALTGPS:GEO', 'geoid'],
    ['HFALG:ELL', 'ellipsoid'],
    ['HFALGALTGPS:NKN', 'assumed-geoid'],
  ] as const)('%s → meta %s', (header, datum) => {
    expect(parse(igc(...HEADER, header, REFERENCE_FIX)).meta.gnssAltitudeDatum).toBe(datum);
  });

  it('GEO — высота переводится в эллипсоид, ELL — остаётся', () => {
    expect(altGnssOf('HFALG:GEO')).toBeCloseTo(1889 + N, 6);
    expect(altGnssOf('HFALG:ELL')).toBe(1889);
  });

  it('NIL — GNSS-высоты нет, даже если в B-записи число', () => {
    const track = parse(igc(...HEADER, 'HFALG:NIL', REFERENCE_FIX));
    expect(pointAt(track.points, 0).altGnss).toBeNull();
    expect(track.meta.gnssAltitudeDatum).toBe('none');
    expect(codes(track)).toContain('no_gnss_altitude');
  });

  it('заголовок после B-записей — действует на весь трек', () => {
    const track = parse(igc(...HEADER, REFERENCE_FIX, 'HFALG:ELL'));
    expect(pointAt(track.points, 0).altGnss).toBe(1889);
  });

  it('два заголовка — действует первый', () => {
    expect(altGnssOf('HFALG:ELL', 'HFALG:GEO')).toBe(1889);
  });

  it('незнакомый код — геоид и предупреждение со строкой', () => {
    const track = parse(igc(...HEADER, 'HFALG:WGS', REFERENCE_FIX));
    expect(track.meta.gnssAltitudeDatum).toBe('assumed-geoid');
    expect(track.warnings).toContainEqual({ code: 'unknown_altitude_datum', line: 3 });
  });

  it('прибор не пишет GNSS-высоту (00000) — NaN, а не высота геоида', () => {
    const track = parse(igc(...HEADER, 'B0940094646616N01308990EA0175200000'));
    expect(pointAt(track.points, 0).altGnss).toBeNull();
    expect(track.meta.gnssAltitudeDatum).toBe('none');
  });
});
