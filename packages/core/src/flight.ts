import { z } from 'zod';

/**
 * Статус обработки — единственный источник правды (ТЗ §4.2, §9).
 * Восстановительный проход воркера переставляет в очередь все незавершённые.
 */
export const FLIGHT_STATUSES = ['pending', 'parsing', 'analyzing', 'ready', 'failed'] as const;
export const FlightStatus = z.enum(FLIGHT_STATUSES);
export type FlightStatus = z.infer<typeof FlightStatus>;

/**
 * Незавершённые статусы. При старте воркер переставляет их в очередь заново
 * (ТЗ §4.2, §5.2): иначе файл, загруженный перед перезапуском, зависнет навсегда.
 */
export const UNFINISHED_FLIGHT_STATUSES = ['pending', 'parsing', 'analyzing'] as const satisfies readonly FlightStatus[];

/** Форматы исходных файлов (ТЗ §3.1, §3.2, §9). */
export const SOURCE_FORMATS = ['igc', 'gpx', 'kml', 'fit', 'csv'] as const;
export const SourceFormat = z.enum(SOURCE_FORMATS);
export type SourceFormat = z.infer<typeof SourceFormat>;

/**
 * Расширение файла → формат разбора (ТЗ §3.1). Список общий для API и фронта:
 * сервер по нему выбирает парсер, фронт — что писать в accept и что отклонить
 * ещё до отправки. Два таких списка в двух приложениях неизбежно разъедутся.
 */
export const SOURCE_FORMAT_BY_EXTENSION = {
  igc: 'igc',
  gpx: 'gpx',
  kml: 'kml',
  // KMZ — zip с doc.kml внутри, разбирает тот же парсер (ТЗ §3.1).
  kmz: 'kml',
} as const satisfies Record<string, SourceFormat>;

export type TrackFileExtension = keyof typeof SOURCE_FORMAT_BY_EXTENSION;

/** Поддерживаемые расширения — для accept и сообщений об ошибке. */
export const TRACK_FILE_EXTENSIONS = Object.keys(SOURCE_FORMAT_BY_EXTENSION) as TrackFileExtension[];

/** Расширение в нижнем регистре без точки. Нет точки — пустая строка. */
export function fileExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot < 0 ? '' : filename.slice(dot + 1).toLowerCase();
}

/** Формат по имени файла или null, если расширение не поддерживается. */
export function sourceFormatForFilename(filename: string): SourceFormat | null {
  const formats: Record<string, SourceFormat | undefined> = SOURCE_FORMAT_BY_EXTENSION;
  return formats[fileExtension(filename)] ?? null;
}

/** Откуда взята высота трека (ТЗ §9): барометр или GNSS, если баро нет. */
export const ALTITUDE_SOURCES = ['baro', 'gnss'] as const;
export const AltitudeSource = z.enum(ALTITUDE_SOURCES);
export type AltitudeSource = z.infer<typeof AltitudeSource>;

/** Глубина анализа (ТЗ §5.2): basic — редкий трек, термики и ветер не считаются. */
export const ANALYSIS_LEVELS = ['full', 'basic'] as const;
export const AnalysisLevel = z.enum(ANALYSIS_LEVELS);
export type AnalysisLevel = z.infer<typeof AnalysisLevel>;
