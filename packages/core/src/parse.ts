import type { ParsedTrack } from './track.js';

/**
 * Предупреждения парсеров — коды, а не текст: UI локализует их сам (CLAUDE.md, i18n).
 * Парсер не бросает исключение на кривой строке, а пишет предупреждение и идёт дальше.
 */
export const PARSE_WARNING_CODES = [
  /** Строка с неизвестным типом записи или мусор. Пустая строка предупреждения не заслуживает. */
  'unknown_record',
  /** Точка не разобрана: битые координаты, время или флаг валидности, нет времени. */
  'malformed_fix',
  /** Определение расширений (IGC I-запись) не разобрано. */
  'malformed_extensions',
  /** Точка с тем же временем, что предыдущая — оставлена первая. */
  'duplicate_fix',
  /** Точка раньше предыдущей, но это не переход через полночь — пропущена. */
  'out_of_order_fix',
  /** Заголовок даты есть, но не разбирается или дата невозможна. */
  'date_header_invalid',
  /** Дата раньше 1990 или в будущем — заголовок считается битым (ТЗ §3.3). */
  'date_out_of_range',
  /** Дата взята из имени файла, а не из заголовка. */
  'date_from_filename',
  /** Даты нет ни в заголовке, ни в имени файла — нужно спросить пользователя. */
  'date_missing',
  /** Датум не WGS84. */
  'unexpected_datum',
  /** IGC HFALG с незнакомым кодом — высота принята над геоидом (CIVL 7H §3.2.1). */
  'unknown_altitude_datum',
  /** Барометрической высоты нет — вариометр по GNSS, менее точен (ТЗ §3.3). */
  'no_baro_altitude',
  /** GNSS-высоты нет. */
  'no_gnss_altitude',
  /** KML: высоты не абсолютные (relativeToGround, clampToGround…) — отброшены. */
  'altitude_not_absolute',
  /** KML LineString: времени у точек нет, оно равномерно распределено по TimeSpan метки. */
  'timestamps_interpolated',
  /** KML gx:Track: число <when> и <gx:coord> не совпадает — взят минимум. */
  'track_length_mismatch',
  /** Документ оборван (прибор выключился при записи) — взято всё до обрыва. */
  'truncated_document',
  /** Предупреждений больше лимита, остальные отброшены. */
  'warnings_truncated',
] as const;
export type ParseWarningCode = (typeof PARSE_WARNING_CODES)[number];

export interface ParseWarning {
  code: ParseWarningCode;
  /** Номер строки исходного файла, 1-based. */
  line?: number;
}

/** Причины, по которым файл целиком отклоняется. */
export const PARSE_FAILURE_CODES = [
  'file_too_large',
  'too_many_points',
  'no_fixes',
  /** Точки есть, но ни у одной нет времени — трек нельзя проиграть и посчитать вариометр. */
  'no_timestamps',
  /** KMZ повреждён или внутри нет KML. */
  'invalid_archive',
] as const;
export type ParseFailureCode = (typeof PARSE_FAILURE_CODES)[number];

export type ParseResult =
  | { ok: true; track: ParsedTrack }
  | { ok: false; code: ParseFailureCode; warnings: ParseWarning[] };
