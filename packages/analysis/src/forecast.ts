import {
  COMPASS_POINTS,
  FORECAST,
  type CompassPoint,
  type ForecastConfidence,
  type ForecastHour,
  type ForecastModel,
  type ForecastReason,
  type ForecastSite,
  type ForecastVerdict,
  type ModelHour,
  type ModelSeries,
  type ModelVerdict,
  type StormRisk,
} from '@skyline/core';

/**
 * Прогноз для пилотов (ТЗ §6.9): по данным моделей — потолок термиков, база
 * кучёвки, сила термиков, риск гроз и вердикт часа для места старта. Чистые
 * функции; пороги — FORECAST в core/constants.ts.
 */

const FULL_TURN_DEG = 360;
const HALF_TURN_DEG = 180;
const DEG_PER_POINT = FULL_TURN_DEG / COMPASS_POINTS.length;

/** Разность направлений по кругу, [0, 180]. */
const angleBetween = (a: number, b: number): number => {
  const d = (((a - b) % FULL_TURN_DEG) + FULL_TURN_DEG) % FULL_TURN_DEG;
  return d > HALF_TURN_DEG ? FULL_TURN_DEG - d : d;
};

/** Ветер «откуда» попадает в сектор старта: румб ± FORECAST.compassHalfWidthDeg. */
export function inSector(dirDeg: number, sectors: readonly CompassPoint[]): boolean {
  return sectors.some((point) => angleBetween(dirDeg, COMPASS_POINTS.indexOf(point) * DEG_PER_POINT) <= FORECAST.compassHalfWidthDeg);
}

/**
 * Потолок термиков: высота, где воздух, поднимающийся от земли по сухой
 * адиабате, становится не теплее окружающего. Профиль — земля модели и уровни
 * давления над ней, между ними линейно. Устойчиво с земли — потолок у земли;
 * неустойчиво до верхнего уровня — верхний уровень. Нет уровней — null.
 */
export function thermalTop(hour: ModelHour, surfaceM: number): number | null {
  const above = hour.levels.filter((level) => level.heightM > surfaceM);
  if (above.length === 0) return null;
  const excess = (heightM: number, envC: number): number =>
    hour.temperatureC - FORECAST.dryLapseCPerM * (heightM - surfaceM) - envC;
  let prevHeight = surfaceM;
  let prevExcess = 0;
  for (const level of above) {
    const e = excess(level.heightM, level.temperatureC);
    if (e <= 0) {
      if (prevExcess <= 0) return prevHeight;
      return prevHeight + ((level.heightM - prevHeight) * prevExcess) / (prevExcess - e);
    }
    prevHeight = level.heightM;
    prevExcess = e;
  }
  return prevHeight;
}

/**
 * Потолок термиков модели: земля плюс пограничный слой, если модель его
 * считает (ECMWF, GFS — на своём полном вертикальном разрешении), иначе —
 * сухая адиабата по уровням давления (ICON; грубее: уровни через 0,5–1,2 км).
 */
export function thermalCeiling(hour: ModelHour, surfaceM: number): number | null {
  return hour.boundaryLayerM !== null ? surfaceM + hour.boundaryLayerM : thermalTop(hour, surfaceM);
}

/** База кучёвки по формуле Эспи, над эллипсоидом, м. */
export function cloudBase(hour: ModelHour, surfaceM: number): number {
  return surfaceM + Math.max(0, hour.temperatureC - hour.dewPointC) * FORECAST.espyMPerC;
}

/**
 * Средний подъём в термиках — конвективная скорость Дирдорфа
 * w* = (g/T · H/(ρ·cp) · D)^(1/3), D — толщина слоя перемешивания.
 * Нет потока тепла у модели — null; земля не греет (H ≤ 0) — 0.
 */
export function thermalStrength(hour: ModelHour, depthM: number): number | null {
  const flux = hour.sensibleHeatFluxWm2;
  if (flux === null) return null;
  if (flux <= 0 || depthM <= 0) return 0;
  const buoyancy = FORECAST.gravityMs2 / (hour.temperatureC + FORECAST.celsiusToKelvin);
  return Math.cbrt(buoyancy * (flux / (FORECAST.airDensityKgM3 * FORECAST.airHeatCapacityJkgK)) * depthM);
}

export function stormRisk(hour: ModelHour): StormRisk {
  const cape = hour.capeJkg ?? 0;
  const li = hour.liftedIndex;
  if (cape >= FORECAST.capeHighJkg && (hour.precipitationMm > 0 || (li !== null && li <= FORECAST.liftedIndexStorm))) return 'high';
  if (cape >= FORECAST.capeMediumJkg || (li !== null && li <= 0)) return 'medium';
  return 'low';
}

/** Оценка часа по одной модели. surfaceM — высота, к которой модель привела приземные поля. */
export function evaluateModelHour(model: ForecastModel, hour: ModelHour, surfaceM: number, site: ForecastSite): ModelVerdict {
  const maxWind = site.maxWindMs ?? FORECAST.defaultMaxWindMs;
  const top = thermalCeiling(hour, surfaceM);
  const base = cloudBase(hour, surfaceM);
  const cumulus = top !== null && base < top;
  const ceilingM = top === null ? null : cumulus ? base : top;
  const depthM = ceilingM === null ? 0 : ceilingM - surfaceM;
  const thermalMs = thermalStrength(hour, depthM);
  const storm = stormRisk(hour);
  const bandTopM = Math.max(ceilingM ?? site.elevationM, site.elevationM + FORECAST.upperWindBandM);
  const upperWindMs = hour.levels
    .filter((level) => level.heightM > site.elevationM && level.heightM <= bandTopM)
    .reduce((max, level) => Math.max(max, level.windSpeedMs), 0);

  const nofly: ForecastReason[] = [];
  if (hour.precipitationMm >= FORECAST.rainMmPerHour) nofly.push('rain');
  if (storm === 'high') nofly.push('storm');
  if (hour.windSpeedMs > maxWind) nofly.push('wind_strong');
  if (hour.gustMs > maxWind + FORECAST.gustMarginMs) nofly.push('gusts');
  if (hour.windSpeedMs >= FORECAST.calmWindMs && !inSector(hour.windDirDeg, site.windSectors)) nofly.push('wind_sector');
  if (upperWindMs >= FORECAST.upperWindNoFlyMs) nofly.push('upper_wind');

  const marginal: ForecastReason[] = [];
  if (hour.windSpeedMs > maxWind * FORECAST.marginalWindShare && !nofly.includes('wind_strong')) marginal.push('wind_strong');
  if (upperWindMs >= FORECAST.upperWindMarginalMs && !nofly.includes('upper_wind')) marginal.push('upper_wind');
  if (storm === 'medium') marginal.push('storm');

  const aboveTakeoffM = ceilingM === null ? null : ceilingM - site.elevationM;
  let verdict: ForecastVerdict;
  let reasons: ForecastReason[];
  if (nofly.length > 0) {
    verdict = 'nofly';
    reasons = nofly;
  } else if (marginal.length > 0) {
    verdict = 'marginal';
    reasons = marginal;
  } else if (aboveTakeoffM === null) {
    verdict = 'flyable';
    reasons = ['no_data'];
  } else if (aboveTakeoffM < FORECAST.minSoarableM) {
    verdict = 'flyable';
    reasons = ['low_ceiling'];
  } else {
    const strongEnough = thermalMs === null || thermalMs >= FORECAST.xcThermalMs;
    verdict = aboveTakeoffM >= FORECAST.xcCeilingM && strongEnough ? 'xc' : 'flyable';
    reasons = [];
  }

  return {
    model,
    verdict,
    reasons,
    windSpeedMs: hour.windSpeedMs,
    windDirDeg: hour.windDirDeg,
    gustMs: hour.gustMs,
    ceilingM,
    cloudBaseM: cumulus ? base : null,
    thermalMs,
    stormRisk: storm,
    upperWindMs,
  };
}

/** Лётные вердикты между собой согласны: XC и «лётно» — одно решение «лететь». */
const decision = (verdict: ForecastVerdict): 'fly' | ForecastVerdict => (verdict === 'xc' || verdict === 'flyable' ? 'fly' : verdict);

function confidenceOf(verdicts: readonly ModelVerdict[]): ForecastConfidence {
  const [primary, ...others] = verdicts;
  if (!primary || others.length === 0) return 'medium';
  const agree = others.filter((v) => decision(v.verdict) === decision(primary.verdict)).length;
  if (agree === others.length) return 'high';
  return agree * 2 >= others.length ? 'medium' : 'low';
}

/**
 * Прогноз места по часам. Часы — главной модели (FORECAST.primaryModel, её
 * нет — первой из списка); остальные модели сопоставляются по времени и дают
 * уверенность и разброс потолка.
 */
export function evaluateForecast(series: readonly ModelSeries[], site: ForecastSite): ForecastHour[] {
  const ordered = [...series].sort((a, b) => Number(b.model === FORECAST.primaryModel) - Number(a.model === FORECAST.primaryModel));
  const [primary, ...others] = ordered;
  if (!primary) return [];
  const byTime = others.map((s) => ({ series: s, at: new Map(s.hours.map((h) => [h.timeMs, h])) }));

  return primary.hours.map((hour) => {
    const models = [
      evaluateModelHour(primary.model, hour, primary.surfaceM, site),
      ...byTime.flatMap(({ series: s, at }) => {
        const other = at.get(hour.timeMs);
        return other ? [evaluateModelHour(s.model, other, s.surfaceM, site)] : [];
      }),
    ];
    const ceilings = models.map((m) => m.ceilingM).filter((c): c is number => c !== null);
    const head = models[0];
    return {
      timeMs: hour.timeMs,
      verdict: head?.verdict ?? 'nofly',
      confidence: confidenceOf(models),
      reasons: head?.reasons ?? ['no_data'],
      models,
      ceilingRangeM: ceilings.length > 0 ? [Math.min(...ceilings), Math.max(...ceilings)] : null,
      windProfile: hour.levels
        .filter((level) => level.heightM > site.elevationM)
        .map((level) => ({ heightM: level.heightM, speedMs: level.windSpeedMs, dirDeg: level.windDirDeg })),
      cloudCoverPct: hour.cloudCoverPct,
      precipitationMm: hour.precipitationMm,
    };
  });
}
