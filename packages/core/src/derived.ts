import type { AltitudeSource, AnalysisLevel } from './flight.js';

/** Биты флагов точки — те же, что в колонке flags формата .track (ТЗ §5.4). */
export const TRACK_FLAGS = {
  /** Точка на краю разрыва: до или после неё пропуск дольше порога интерполяции. */
  gap: 1 << 0,
  /** Точка внутри термика (детекция термиков, §6.3). */
  thermal: 1 << 1,
  /** В интерполяции точки участвовал 2D-фикс: её высота не из него. */
  fix2d: 1 << 2,
} as const;

/**
 * Трек после чистки и производных (ТЗ §5.2, шаги 3–4): равномерная сетка 1 Гц
 * внутри сегментов, через разрывы точек нет. Колонки одной длины; NaN — нет значения.
 */
export interface DerivedColumns {
  /** UNIX-время, мс, UTC; внутри сегмента шаг ровно 1 с. */
  t: Float64Array;
  /** Градусы WGS84 после медианного фильтра. */
  lat: Float64Array;
  lon: Float64Array;
  /** Барометрическая высота, интерполированная, м. */
  altBaro: Float64Array;
  /** GNSS-высота, интерполированная, м. */
  altGnss: Float64Array;
  /** Сглаженная (Савицкий–Голей) высота источника вариометра, м. */
  altitude: Float64Array;
  /** Вертикальная скорость, м/с, окно VARIO.instantWindowS — для графика и раскраски. */
  vSpeedInstant: Float64Array;
  /** Окно VARIO.dampedWindowS — для термиков. */
  vSpeedDamped: Float64Array;
  /** Окно VARIO.integralWindowS — как у приборов. */
  vSpeedIntegral: Float64Array;
  /** Путевая скорость, м/с. */
  groundSpeed: Float64Array;
  /** Курс от точки к следующей, градусы [0, 360); NaN — стоит на месте. */
  heading: Float64Array;
  /**
   * Скорость изменения курса, °/с; плюс — по часовой. null при analysis_level
   * 'basic': на редком треке форма виража потеряна (ТЗ §5.2).
   */
  turnRate: Float64Array | null;
  /** Биты TRACK_FLAGS. */
  flags: Uint8Array;
}

export interface DerivedTrack {
  points: DerivedColumns;
  analysisLevel: AnalysisLevel;
  altitudeSource: AltitudeSource;
  /** Медианный шаг исходных фиксов, с. */
  medianFixIntervalS: number;
  /** Сколько фиксов отброшено по FXA/SIU. */
  droppedFixes: number;
  /** Сколько разрывов на сетке. */
  gapCount: number;
}

/**
 * Сводка полёта (ТЗ §5.2 шаг 7, задача 1.13). Всё в СИ; единицы для пилота —
 * только при форматировании в UI.
 */
export interface FlightSummary {
  /** От первой точки до последней, с; разрывы входят. */
  durationS: number;
  /** Максимальная высота над эллипсоидом, м; NaN — высоты нет ни в одной точке. */
  maxAltM: number;
  /** Длина трека по большому кругу, м; через разрывы не набегает. */
  distanceTrackM: number;
  /** Наибольший непрерывный прирост высоты max(alt[j] − alt[i]), i < j, м; 0 — только снижение. */
  maxGainM: number;
}

/**
 * Круг (вираж), ТЗ §6.2. Индексы — точки сетки 1 Гц: курс от startIndex
 * повернул на 360° к endIndex. Координаты — WGS84, высоты — метры.
 */
export interface Circle {
  startIndex: number;
  endIndex: number;
  /** UTC, мс. */
  startTimeMs: number;
  endTimeMs: number;
  periodS: number;
  /** cw — по часовой (вправо), ccw — против. */
  direction: 'cw' | 'ccw';
  /** Центр — среднее координат за оборот. */
  centerLat: number;
  centerLon: number;
  /** Медиана расстояний от точек оборота до центра, м. */
  radiusM: number;
  /** Набор высоты за круг, м (отрицательный — снижение). */
  gainM: number;
}

/** Сила термика по среднему набору, ТЗ §6.3. */
export type ThermalStrength = 'weak' | 'medium' | 'strong' | 'powerful';

/**
 * Термик, ТЗ §6.3: полтора оборота и больше подряд с набором. Индексы —
 * точки сетки 1 Гц; всё в СИ.
 */
export interface Thermal {
  startIndex: number;
  endIndex: number;
  /** UTC, мс. */
  startTimeMs: number;
  endTimeMs: number;
  durationS: number;
  entryAltM: number;
  exitAltM: number;
  gainM: number;
  /** gain / duration — основной показатель. */
  avgClimbMs: number;
  /** Максимум демпфированного варио (окно 4 с) внутри. */
  maxClimbMs: number;
  /** Оборотов: полные круги плюс доворот до первого и после последнего. */
  turnCount: number;
  circleCount: number;
  avgRadiusM: number;
  /** Преобладающее направление кругов. */
  direction: 'cw' | 'ccw';
  /**
   * Снос термика, м/с — КУДА сносит (куда дует ветер), по центрам первого и
   * последнего круга. Метеорологическое «откуда» — +180°, в оценке ветра (§6.5).
   * null — один круг, сносу не из чего взяться.
   */
  driftEastMs: number | null;
  driftNorthMs: number | null;
  /** avgClimb / maxClimb — насколько чисто центрировал, 0..1. */
  efficiency: number;
  strength: ThermalStrength;
}
