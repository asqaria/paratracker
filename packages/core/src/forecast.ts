/**
 * Прогноз для пилотов (ТЗ §6.9): данные моделей погоды по месту старта и
 * оценка лётности по часам. Высоты — над эллипсоидом WGS84, как везде в
 * системе; модели отдают их над уровнем моря — пересчёт на границе (parsing).
 * Температура — °C: так её отдают модели и так она входит в формулы
 * метеорологии (сухая адиабата, формула Эспи).
 */

/** Модели прогноза (решение владельца 29.09.2026: бесплатный Open-Meteo, три модели). */
export const FORECAST_MODELS = ['ecmwf', 'gfs', 'icon'] as const;
export type ForecastModel = (typeof FORECAST_MODELS)[number];

/** Румбы сектора старта — как в paragliding.earth. */
export const COMPASS_POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
export type CompassPoint = (typeof COMPASS_POINTS)[number];

/** Уровень давления в час прогноза. */
export interface PressureLevel {
  hPa: number;
  /** Высота уровня над эллипсоидом, м. */
  heightM: number;
  temperatureC: number;
  windSpeedMs: number;
  /** Откуда дует, [0, 360). */
  windDirDeg: number;
}

/** Час прогноза одной модели. null — модель этого не считает. */
export interface ModelHour {
  /** UTC, мс. */
  timeMs: number;
  temperatureC: number;
  dewPointC: number;
  /** Ветер 10 м над поверхностью модели. */
  windSpeedMs: number;
  windDirDeg: number;
  gustMs: number;
  /** Осадки за час, мм. */
  precipitationMm: number;
  /** Общая облачность, %. */
  cloudCoverPct: number;
  capeJkg: number | null;
  liftedIndex: number | null;
  /** Поток явного тепла от земли вверх, Вт/м² — из него сила термиков. */
  sensibleHeatFluxWm2: number | null;
  /**
   * Высота пограничного слоя над землёй модели, м: где кончается перемешивание
   * — фактически потолок термиков. Есть у ECMWF и GFS, у ICON — null.
   */
  boundaryLayerM: number | null;
  /** По возрастанию высоты; пусто — у модели нет уровней давления. */
  levels: PressureLevel[];
}

export interface ModelSeries {
  model: ForecastModel;
  /** Высота, к которой модель привела приземные поля (высота старта), над эллипсоидом, м. */
  surfaceM: number;
  hours: ModelHour[];
}

/** Место в прогнозе: высота старта, сектор, допустимый ветер. */
export interface ForecastSite {
  /** Над эллипсоидом, м. */
  elevationM: number;
  windSectors: readonly CompassPoint[];
  /** Допустимый ветер на старте, м/с; null — FORECAST.defaultMaxWindMs. */
  maxWindMs: number | null;
}

export const FORECAST_VERDICTS = ['xc', 'flyable', 'marginal', 'nofly'] as const;
export type ForecastVerdict = (typeof FORECAST_VERDICTS)[number];

/** Почему час хуже «лётного» — подписи в UI. */
export const FORECAST_REASONS = [
  'wind_sector',
  'wind_strong',
  'gusts',
  'rain',
  'storm',
  'upper_wind',
  'low_ceiling',
  'no_data',
] as const;
export type ForecastReason = (typeof FORECAST_REASONS)[number];

export const STORM_RISKS = ['low', 'medium', 'high'] as const;
export type StormRisk = (typeof STORM_RISKS)[number];

export const FORECAST_CONFIDENCES = ['high', 'medium', 'low'] as const;
export type ForecastConfidence = (typeof FORECAST_CONFIDENCES)[number];

/** Оценка часа по одной модели. */
export interface ModelVerdict {
  model: ForecastModel;
  verdict: ForecastVerdict;
  reasons: ForecastReason[];
  windSpeedMs: number;
  windDirDeg: number;
  gustMs: number;
  /** Потолок термиков над эллипсоидом, м; null — нет профиля. */
  ceilingM: number | null;
  /** База кучёвки, м; null — сухо, облаков не будет. */
  cloudBaseM: number | null;
  /** Средний подъём в термиках, м/с (w*); null — модель не даёт поток тепла. */
  thermalMs: number | null;
  stormRisk: StormRisk;
  /** Сильнейший ветер в слое полёта, м/с. */
  upperWindMs: number;
}

/** Точка профиля: высота над эллипсоидом, температура, ветер «откуда». */
export interface ProfilePoint {
  heightM: number;
  temperatureC: number;
  speedMs: number;
  dirDeg: number;
}

/** Час прогноза места: главная модель + согласие остальных. */
export interface ForecastHour {
  timeMs: number;
  verdict: ForecastVerdict;
  confidence: ForecastConfidence;
  reasons: ForecastReason[];
  /** Оценки всех моделей, главная — первой. */
  models: ModelVerdict[];
  /** Разброс потолка по моделям, м; null — ни у одной нет профиля. */
  ceilingRangeM: [number, number] | null;
  /**
   * Профиль главной модели для диаграммы «время × высота» (задача П.6):
   * земля модели (2 м и ветер 10 м) и уровни давления над ней по возрастанию.
   */
  surface: ProfilePoint;
  profile: ProfilePoint[];
  cloudCoverPct: number;
  precipitationMm: number;
}
