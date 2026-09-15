import { z } from 'zod';

/**
 * Статус обработки — единственный источник правды (ТЗ §4.2, §9).
 * Восстановительный проход воркера переставляет в очередь все незавершённые.
 */
export const FLIGHT_STATUSES = ['pending', 'parsing', 'analyzing', 'ready', 'failed'] as const;
export const FlightStatus = z.enum(FLIGHT_STATUSES);
export type FlightStatus = z.infer<typeof FlightStatus>;

/** Форматы исходных файлов (ТЗ §3.1, §3.2, §9). */
export const SOURCE_FORMATS = ['igc', 'gpx', 'kml', 'fit', 'csv'] as const;
export const SourceFormat = z.enum(SOURCE_FORMATS);
export type SourceFormat = z.infer<typeof SourceFormat>;

/** Откуда взята высота трека (ТЗ §9): барометр или GNSS, если баро нет. */
export const ALTITUDE_SOURCES = ['baro', 'gnss'] as const;
export const AltitudeSource = z.enum(ALTITUDE_SOURCES);
export type AltitudeSource = z.infer<typeof AltitudeSource>;

/** Глубина анализа (ТЗ §5.2): basic — редкий трек, термики и ветер не считаются. */
export const ANALYSIS_LEVELS = ['full', 'basic'] as const;
export const AnalysisLevel = z.enum(ANALYSIS_LEVELS);
export type AnalysisLevel = z.infer<typeof AnalysisLevel>;
