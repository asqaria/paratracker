import { THERMAL } from './constants.js';
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
 * Упрощённая линия трека для карт логбука (задача 2.11): колонки точек,
 * оставленных Дугласом–Пекером. Сотни точек — обычные массивы, не типизированные.
 */
export interface SimplifiedLine {
  lat: number[];
  lon: number[];
  /** Высота над эллипсоидом, м; NaN — высоты нет. */
  altM: number[];
  /** UTC, мс. */
  timeMs: number[];
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
  direction: TurnDirection;
  /** Центр — среднее координат за оборот. */
  centerLat: number;
  centerLon: number;
  /** Медиана расстояний от точек оборота до центра, м. */
  radiusM: number;
  /** Набор высоты за круг, м (отрицательный — снижение). */
  gainM: number;
}

/** Направление виража: по часовой (вправо) или против. Одни значения для БД и API. */
export const TURN_DIRECTIONS = ['cw', 'ccw'] as const;
export type TurnDirection = (typeof TURN_DIRECTIONS)[number];

/** Сила термика по среднему набору, ТЗ §6.3. */
export const THERMAL_STRENGTHS = ['weak', 'medium', 'strong', 'powerful'] as const;
export type ThermalStrength = (typeof THERMAL_STRENGTHS)[number];

/** Класс термика по среднему набору: слабый < 1, средний 1–3, сильный 3–5, мощный > 5 м/с (§6.3). */
export function thermalStrength(avgClimbMs: number): ThermalStrength {
  const bounds = THERMAL.strengthUpperBoundsMs;
  if (avgClimbMs < bounds.weak) return 'weak';
  if (avgClimbMs < bounds.medium) return 'medium';
  if (avgClimbMs < bounds.strong) return 'strong';
  return 'powerful';
}

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
  direction: TurnDirection;
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

/** Полёт — от взлёта до посадки, индексы точек трека; вне него — ходьба по земле. */
export interface FlightRange {
  takeoff: number;
  landing: number;
}

/**
 * Ветер, ТЗ §6.5. east/north — вектор, КУДА дует (м/с); dirDeg — метеорологическое
 * направление, ОТКУДА дует, [0, 360) — единая конвенция БД, API и UI.
 */
export interface Wind {
  eastMs: number;
  northMs: number;
  speedMs: number;
  dirDeg: number;
}

/** Метод B на одном круге: окружность в пространстве путевых скоростей. */
export interface CircleWind {
  /** Номер круга в выходе detectCircles. */
  circleIndex: number;
  /** Середина круга, UTC, мс. */
  timeMs: number;
  /** Средняя высота круга, м. */
  altitudeM: number;
  wind: Wind;
  /** Радиус окружности скоростей — воздушная скорость в вираже, м/с. */
  airspeedMs: number;
  /** Корень из среднего квадрата невязки |V − W| − Vair, м/с. */
  residualMs: number;
}

/** Слой профиля ветра, ТЗ §6.5. */
export interface WindBand {
  /** [низ, верх), м над эллипсоидом. */
  altitudeBand: [number, number];
  windSpeedMs: number;
  /** Метеорологическое, откуда дует. */
  windDirDeg: number;
  /** 0..1: число кругов в слое и согласие их оценок. */
  confidence: number;
  circleCount: number;
}

/** Сверка методов на термике: A — снос центров кругов, B — среднее по его кругам. */
export interface ThermalWind {
  /** Номер термика в выходе detectThermals. */
  thermalIndex: number;
  /** Метод A: снос термика, развёрнутый в «откуда дует»; null — один круг. */
  drift: Wind | null;
  /** Метод B по кругам термика; null — ни один круг не прошёл отбраковку. */
  circles: Wind | null;
  /** |A − B|, м/с; null — нет одного из методов. */
  disagreementMs: number | null;
}

export interface WindAnalysis {
  circles: CircleWind[];
  /** Слои снизу вверх; только слои, где есть круги. */
  profile: WindBand[];
  thermals: ThermalWind[];
  /** Средний ветер полёта (колонки wind_* в flights); null — кругов нет. */
  flight: Wind | null;
}

/** 'dynamic' — высота почти не терялась (ТЗ §6.4): качество не определено. */
export const GLIDE_KINDS = ['glide', 'dynamic'] as const;
export type GlideKind = (typeof GLIDE_KINDS)[number];

/**
 * Глайд (переход), ТЗ §6.4: от взлёта или конца термика до начала следующего
 * термика или посадки. Круги поиска, не ставшие термиком, — часть перехода.
 * Индексы — точки сетки 1 Гц; всё в СИ.
 */
export interface Glide {
  startIndex: number;
  endIndex: number;
  /** UTC, мс. */
  startTimeMs: number;
  endTimeMs: number;
  durationS: number;
  /** Путь по земле, м: сумма шагов трека; через разрывы записи не набегает. */
  distanceM: number;
  /** Высота входа минус высота выхода, м; отрицательная — пилот набрал. */
  altLossM: number;
  /** distance / altLoss, не больше GLIDE.maxGlideRatio; null — 'dynamic'. */
  glideRatio: number | null;
  kind: GlideKind;
  /** distance / duration. */
  avgGroundSpeedMs: number;
  /** −altLoss / duration: снижение — отрицательное. */
  avgVzMs: number;
  /** Азимут от начала к концу, градусы [0, 360); NaN — вернулся в точку старта. */
  headingDeg: number;
  /** Насколько прямо шёл: расстояние по прямой / путь, 0..1. */
  headingConsistency: number;
}

/** Термик для хранения: с точками входа и выхода и сносом в «откуда дует». */
export interface ThermalSegment extends Thermal {
  entryLat: number;
  entryLon: number;
  exitLat: number;
  exitLon: number;
  /** Снос (метод A, §6.5), метеорологическое направление; null — один круг. */
  drift: Wind | null;
}

/**
 * Анализ полёта целиком (ТЗ §5.2 шаг 5–6, §6.2–6.5): то, что воркер пишет в
 * thermals, glides и агрегаты flights.
 */
export interface FlightAnalysis {
  thermals: ThermalSegment[];
  glides: Glide[];
  /** Σ набор / Σ время в термиках, м/с; null — термиков нет. */
  avgClimbMs: number | null;
  /** Σ путь / Σ потеря по глайдам вида 'glide' ('dynamic' не входит, §6.4); null — таких нет. */
  avgGlideRatio: number | null;
  /** Ветер полёта (метод B, среднее по кругам); null — кругов нет. */
  wind: Wind | null;
  windProfile: WindBand[];
}
