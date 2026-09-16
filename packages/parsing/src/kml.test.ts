import { pointAt, type ParsedTrack, type ParseWarningCode } from '@skyline/core';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { parseKml } from './kml.js';
import { defineFixtureChecks, fixtureCases, NOW, readFixture, readFixtureText, unwrap } from './testing/fixtures.js';
import type { ParseOptions } from './track-builder.js';

const parse = (input: string | Uint8Array, options: Partial<ParseOptions> = {}): ParsedTrack =>
  unwrap(parseKml(input, { now: NOW, ...options }));

const codes = (track: ParsedTrack): ParseWarningCode[] => track.warnings.map((w) => w.code);

const kml = (...body: string[]): string =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2"><Document>\n${body.join('\n')}\n</Document></kml>\n`;

const track = (whens: string[], coords: string[], altitudeMode = 'absolute'): string =>
  `<Placemark><gx:Track><altitudeMode>${altitudeMode}</altitudeMode>${whens
    .map((w) => `<when>${w}</when>`)
    .join('')}${coords.map((c) => `<gx:coord>${c}</gx:coord>`).join('')}</gx:Track></Placemark>`;

const T0 = '2026-07-15T09:00:00Z';
const T1 = '2026-07-15T09:00:01Z';
const T2 = '2026-07-15T09:00:02Z';

describe.each(fixtureCases('kml', 'kmz'))('%s', (name, exp) => {
  defineFixtureChecks(parse(readFixture(name)), exp, 'fix_time');
});

describe('KML: gx:Track', () => {
  it('источник высоты gnss, единственное предупреждение — нет баро', () => {
    const result = parse(readFixture('gx-track.kml'));
    expect(result.altitudeSource).toBe('gnss');
    expect(codes(result)).toEqual(['no_baro_altitude']);
  });

  it('сегменты MultiTrack склеены по времени, LineString рядом с gx:Track проигнорирован', () => {
    expect(codes(parse(readFixture('multitrack.kml')))).toEqual(['no_baro_altitude']);
  });

  it('число <when> и <gx:coord> не совпадает — берётся минимум, предупреждение', () => {
    const result = parse(kml(track([T0, T1, T2], ['76.955 43.128 2400', '76.956 43.129 2401'])));
    expect(result.points.t.length).toBe(2);
    expect(codes(result)).toContain('track_length_mismatch');
  });

  it('битая координата — точка пропущена с предупреждением', () => {
    const result = parse(kml(track([T0, T1, T2], ['76.955 43.128 2400', 'abc 43.1 2400', '76.957 43.130 2402'])));
    expect(result.points.t.length).toBe(2);
    expect(codes(result)).toContain('malformed_fix');
  });

  it('высоты не абсолютные — отброшены с предупреждением', () => {
    const result = parse(kml(track([T0, T1], ['76.955 43.128 30', '76.956 43.129 31'], 'relativeToGround')));
    expect(pointAt(result.points, 0).altGnss).toBeNull();
    expect(codes(result)).toEqual(['altitude_not_absolute', 'no_baro_altitude', 'no_gnss_altitude']);
  });

  it('документ оборван внутри gx:Track — всё до обрыва сохранено', () => {
    const text = `<kml><Document><Placemark><gx:Track><when>${T0}</when><when>${T1}</when><gx:coord>76.955 43.128 2400</gx:coord><gx:coord>76.9`;
    const result = parse(text);
    expect(result.points.t.length).toBe(1);
    expect(codes(result)).toEqual(expect.arrayContaining(['truncated_document', 'track_length_mismatch']));
  });

  it('строка и байты дают один результат', () => {
    expect(parse(readFixtureText('gx-track.kml'))).toEqual(parse(readFixture('gx-track.kml')));
  });
});

describe('KML: LineString', () => {
  it('время из TimeSpan метки, предупреждение об интерполяции', () => {
    expect(codes(parse(readFixture('linestring-timespan.kml')))).toContain('timestamps_interpolated');
  });

  it('LineString без времени — no_timestamps', () => {
    const text = kml('<Placemark><LineString><coordinates>76.955,43.128,2400 76.956,43.129,2401</coordinates></LineString></Placemark>');
    expect(parseKml(text, { now: NOW })).toMatchObject({ ok: false, code: 'no_timestamps' });
  });
});

describe('KMZ', () => {
  const kmlWith = (count: number): Uint8Array =>
    strToU8(
      kml(
        track(
          [T0, T1, T2].slice(0, count),
          ['76.955 43.128 2400', '76.956 43.129 2401', '76.957 43.130 2402'].slice(0, count),
        ),
      ),
    );

  it('doc.kml важнее других .kml в архиве', () => {
    const archive = zipSync({ 'a.kml': kmlWith(1), 'doc.kml': kmlWith(3) });
    expect(parse(archive).points.t.length).toBe(3);
  });

  it('нет doc.kml — первый .kml', () => {
    expect(parse(zipSync({ 'readme.txt': strToU8('x'), 'files/track.kml': kmlWith(2) })).points.t.length).toBe(2);
  });

  it('архив без KML и битый архив — invalid_archive', () => {
    expect(parseKml(zipSync({ 'readme.txt': strToU8('x') }), { now: NOW })).toMatchObject({
      ok: false,
      code: 'invalid_archive',
    });
    expect(parseKml(Uint8Array.of(0x50, 0x4b, 0x03, 0x04, 1, 2, 3), { now: NOW })).toMatchObject({
      ok: false,
      code: 'invalid_archive',
    });
  });

  it('распакованный документ больше лимита — file_too_large (защита от zip-бомбы)', () => {
    const huge = zipSync({ 'doc.kml': strToU8(kml(' '.repeat(200_000))) });
    expect(huge.byteLength).toBeLessThan(10_000);
    expect(parseKml(huge, { now: NOW, limits: { maxFileBytes: 100_000 } })).toMatchObject({
      ok: false,
      code: 'file_too_large',
    });
  });
});

describe('KML: отказ по файлу целиком', () => {
  it.each(['', '<html/>', '<kml><Document><Placemark><name>Точка</name></Placemark></Document></kml>'])(
    'трека нет — no_fixes: %j',
    (text) => {
      expect(parseKml(text, { now: NOW })).toMatchObject({ ok: false, code: 'no_fixes' });
    },
  );
});
