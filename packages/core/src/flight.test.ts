import { describe, expect, it } from 'vitest';

import {
  fileExtension,
  SOURCE_FORMAT_BY_EXTENSION,
  SOURCE_FORMATS,
  sourceFormatForFilename,
  TRACK_FILE_EXTENSIONS,
} from './flight.js';

describe('расширение файла', () => {
  it('берётся после последней точки и приводится к нижнему регистру', () => {
    expect(fileExtension('track.IGC')).toBe('igc');
    expect(fileExtension('2024-07-14.flight.gpx')).toBe('gpx');
  });

  it('без точки расширения нет', () => {
    // Файл с именем «igc» — не IGC: иначе приняли бы что угодно.
    expect(fileExtension('igc')).toBe('');
    expect(fileExtension('')).toBe('');
  });
});

describe('sourceFormatForFilename', () => {
  it('KMZ разбирает тот же парсер, что KML', () => {
    expect(sourceFormatForFilename('track.kmz')).toBe('kml');
    expect(sourceFormatForFilename('track.kml')).toBe('kml');
  });

  it('поддерживаемые расширения дают формат', () => {
    expect(sourceFormatForFilename('track.igc')).toBe('igc');
    expect(sourceFormatForFilename('track.GPX')).toBe('gpx');
  });

  it('прочее — null, решение об отказе принимает вызывающий', () => {
    expect(sourceFormatForFilename('track.fit')).toBeNull();
    expect(sourceFormatForFilename('photo.jpg')).toBeNull();
    expect(sourceFormatForFilename('track')).toBeNull();
  });
});

describe('TRACK_FILE_EXTENSIONS', () => {
  it('перечисляет ключи сопоставления', () => {
    expect(TRACK_FILE_EXTENSIONS).toEqual(['igc', 'gpx', 'kml', 'kmz']);
  });

  it('каждый формат — из списка форматов домена', () => {
    for (const format of Object.values(SOURCE_FORMAT_BY_EXTENSION)) {
      expect(SOURCE_FORMATS, format).toContain(format);
    }
  });
});
