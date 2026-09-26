import {
  CLEAN,
  GEO,
  TIME,
  WIND,
  type AirspeedLimits,
  type Circle,
  type CircleWind,
  type Thermal,
  type ThermalWind,
  type Wind,
  type WindAnalysis,
  type WindBand,
} from '@skyline/core';

/**
 * ТЗ §6.5, оценка ветра двумя независимыми методами.
 *
 * Метод B (основной): в вираже воздушная скорость постоянна, и путевая скорость
 * GS = Vair + W описывает окружность радиуса Vair с центром в векторе ветра W.
 * На каждом круге — подгонка (Wx, Wy, Vair) по минимуму Σ(|GS − W| − Vair)²
 * Левенбергом–Марквардтом. Алгебраический фит Kåsa — только начальное
 * приближение: он минимизирует другую функцию и занижает радиус на неполной дуге.
 * Скорость — центральной разностью координат, а не по курсу: против ветра
 * пилот почти стоит, и курс там не наблюдаем.
 *
 * Метод A (сверка): снос центров кругов термика (detectThermals) — это куда
 * дует ветер; в метеорологическое «откуда» — +180°.
 */

export interface WindColumns {
  /** UNIX-время, мс, UTC. */
  t: Float64Array;
  lat: Float64Array;
  lon: Float64Array;
  /** Сглаженная высота, м. */
  altitude: Float64Array;
}

export interface VelocityCircleFit {
  /** Центр окружности скоростей — ветер, куда дует, м/с. */
  centerEast: number;
  centerNorth: number;
  /** Радиус — воздушная скорость, м/с. */
  radius: number;
  /** Корень из среднего квадрата невязки |V − центр| − радиус, м/с. */
  residual: number;
}

const DEG = Math.PI / 180;
const FULL_TURN_DEG = 360;
const HALF_TURN_DEG = 180;
/** Параметров подгонки: Wx, Wy, Vair. */
const PARAMS = 3;
/** Левенберг–Марквардт: начальное демпфирование и множитель его изменения. */
const INITIAL_DAMPING = 1e-3;
const DAMPING_FACTOR = 10;
/** Центральная разность берётся через две секунды сетки; дольше — разрыв. */
const CENTRAL_SPAN_MS = 2 * CLEAN.resampleIntervalS * TIME.msPerSecond;

/** Решение 3×3 методом Гаусса с выбором ведущего; null — матрица вырождена. */
function solve3(matrix: number[][], rhs: number[]): number[] | null {
  const a = matrix.map((row, i) => [...row, rhs[i] ?? 0]);
  for (let col = 0; col < PARAMS; col++) {
    let pivot = col;
    for (let row = col + 1; row < PARAMS; row++) {
      if (Math.abs(a[row]?.[col] ?? 0) > Math.abs(a[pivot]?.[col] ?? 0)) pivot = row;
    }
    const pivotRow = a[pivot];
    if (!pivotRow || Math.abs(pivotRow[col] ?? 0) < Number.EPSILON) return null;
    [a[col], a[pivot]] = [pivotRow, a[col] ?? pivotRow];
    for (let row = 0; row < PARAMS; row++) {
      if (row === col) continue;
      const factor = (a[row]?.[col] ?? 0) / (pivotRow[col] ?? 1);
      for (let k = col; k <= PARAMS; k++) (a[row] as number[])[k] = (a[row]?.[k] ?? 0) - factor * (pivotRow[k] ?? 0);
    }
  }
  return a.map((row, i) => (row[PARAMS] ?? 0) / (row[i] ?? 1));
}

/** Сумма квадратов невязок |V − (e, n)| − r. */
function costOf(vx: Float64Array, vy: Float64Array, e: number, n: number, r: number): number {
  let sum = 0;
  for (let i = 0; i < vx.length; i++) sum += (Math.hypot((vx[i] ?? 0) - e, (vy[i] ?? 0) - n) - r) ** 2;
  return sum;
}

/** Kåsa: z = A·x + B·y + C, z = x² + y² — линейно; центр (A/2, B/2). Только старт. */
function kasa(vx: Float64Array, vy: Float64Array): [number, number, number] | null {
  const m = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const rhs = [0, 0, 0];
  for (let i = 0; i < vx.length; i++) {
    const row = [vx[i] ?? 0, vy[i] ?? 0, 1];
    const z = (vx[i] ?? 0) ** 2 + (vy[i] ?? 0) ** 2;
    for (let r = 0; r < PARAMS; r++) {
      for (let c = 0; c < PARAMS; c++) (m[r] as number[])[c] = (m[r]?.[c] ?? 0) + (row[r] ?? 0) * (row[c] ?? 0);
      rhs[r] = (rhs[r] ?? 0) + (row[r] ?? 0) * z;
    }
  }
  const s = solve3(m, rhs);
  if (!s) return null;
  const [A = 0, B = 0, C = 0] = s;
  const e = A / 2;
  const n = B / 2;
  return [e, n, Math.sqrt(Math.max(0, C + e * e + n * n))];
}

/**
 * Окружность по точкам (vx, vy): геометрическая подгонка Левенбергом–Марквардтом
 * по минимуму Σ(|V − центр| − радиус)². null — меньше трёх точек или вырождено.
 */
export function fitVelocityCircle(vx: Float64Array, vy: Float64Array): VelocityCircleFit | null {
  const count = vx.length;
  if (count < PARAMS) return null;
  const start = kasa(vx, vy);
  if (!start) return null;
  let [e, n, r] = start;
  let cost = costOf(vx, vy, e, n, r);
  let damping = INITIAL_DAMPING;

  for (let iteration = 0; iteration < WIND.maxIterations; iteration++) {
    // Нормальные уравнения JᵀJ·δ = −Jᵀres; d(res)/d(e, n, r) = (−(x−e)/d, −(y−n)/d, −1).
    const jtj = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    const jtr = [0, 0, 0];
    for (let i = 0; i < count; i++) {
      const dx = (vx[i] ?? 0) - e;
      const dy = (vy[i] ?? 0) - n;
      const d = Math.hypot(dx, dy);
      if (d < Number.EPSILON) continue;
      const jac = [-dx / d, -dy / d, -1];
      const res = d - r;
      for (let a = 0; a < PARAMS; a++) {
        for (let b = 0; b < PARAMS; b++) (jtj[a] as number[])[b] = (jtj[a]?.[b] ?? 0) + (jac[a] ?? 0) * (jac[b] ?? 0);
        jtr[a] = (jtr[a] ?? 0) - (jac[a] ?? 0) * res;
      }
    }
    let improved = false;
    while (!improved && damping < 1 / INITIAL_DAMPING ** 2) {
      const damped = jtj.map((row, a) => row.map((value, b) => (a === b ? value * (1 + damping) : value)));
      const step = solve3(damped, jtr);
      if (!step) break;
      const [de = 0, dn = 0, dr = 0] = step;
      const next = costOf(vx, vy, e + de, n + dn, r + dr);
      if (next <= cost) {
        [e, n, r] = [e + de, n + dn, r + dr];
        const moved = Math.hypot(de, dn, dr);
        cost = next;
        damping /= DAMPING_FACTOR;
        improved = true;
        if (moved < WIND.convergenceMs) return { centerEast: e, centerNorth: n, radius: r, residual: Math.sqrt(cost / count) };
      } else {
        damping *= DAMPING_FACTOR;
      }
    }
    if (!improved) break;
  }
  return { centerEast: e, centerNorth: n, radius: r, residual: Math.sqrt(cost / count) };
}

/** Ветер из вектора «куда дует»: направление — метеорологическое, откуда. */
function windOf(eastMs: number, northMs: number): Wind {
  const toDeg = Math.atan2(eastMs, northMs) / DEG;
  return {
    eastMs,
    northMs,
    speedMs: Math.hypot(eastMs, northMs),
    dirDeg: (((toDeg + HALF_TURN_DEG) % FULL_TURN_DEG) + FULL_TURN_DEG) % FULL_TURN_DEG,
  };
}

function meanWind(winds: readonly Wind[]): Wind | null {
  if (winds.length === 0) return null;
  const east = winds.reduce((sum, w) => sum + w.eastMs, 0) / winds.length;
  const north = winds.reduce((sum, w) => sum + w.northMs, 0) / winds.length;
  return windOf(east, north);
}

/** Метод B на одном круге; null — дуга коротка или окружность неправдоподобна. */
function circleWind(points: WindColumns, circle: Circle, circleIndex: number, airspeed: AirspeedLimits): CircleWind | null {
  const { t, lat, lon, altitude } = points;
  const mPerDegLat = GEO.meanEarthRadiusM * DEG;
  const vx: number[] = [];
  const vy: number[] = [];
  let altitudeSum = 0;
  // Отсчёты полного оборота: от начала круга до точки перед замыканием.
  for (let i = circle.startIndex; i < circle.endIndex; i++) {
    const [a, b] = [i - 1, i + 1];
    const dtMs = (t[b] ?? Number.NaN) - (t[a] ?? Number.NaN);
    if (!(dtMs > 0 && dtMs <= CENTRAL_SPAN_MS)) continue;
    const mPerDegLon = mPerDegLat * Math.cos((lat[i] ?? 0) * DEG);
    const dtS = dtMs / TIME.msPerSecond;
    vx.push((((lon[b] ?? 0) - (lon[a] ?? 0)) * mPerDegLon) / dtS);
    vy.push((((lat[b] ?? 0) - (lat[a] ?? 0)) * mPerDegLat) / dtS);
    altitudeSum += altitude[i] ?? 0;
  }
  if (vx.length < WIND.minCircleSamples) return null;
  const fit = fitVelocityCircle(Float64Array.from(vx), Float64Array.from(vy));
  if (!fit) return null;
  const windSpeed = Math.hypot(fit.centerEast, fit.centerNorth);
  const plausible =
    fit.radius >= airspeed.minMs &&
    fit.radius <= airspeed.maxMs &&
    // Ветер не быстрее воздушной: иначе пилота несёт назад, и окружность неустойчива.
    windSpeed < fit.radius &&
    fit.residual <= WIND.maxResidualFraction * fit.radius;
  if (!plausible) return null;
  // Центральная разность — хорда дуги: вращающаяся часть скорости укорочена в
  // sin(ωΔ)/(ωΔ) раз (−1.6 % при круге за 20 с), снос — нет. Центр окружности
  // (ветер) от этого не сдвигается, радиус (воздушная) — возвращается делением.
  const omegaDelta = ((2 * Math.PI) / circle.periodS) * CLEAN.resampleIntervalS;
  const chordFactor = Math.sin(omegaDelta) / omegaDelta;
  return {
    circleIndex,
    timeMs: (circle.startTimeMs + circle.endTimeMs) / 2,
    altitudeM: altitudeSum / vx.length,
    wind: windOf(fit.centerEast, fit.centerNorth),
    airspeedMs: fit.radius / chordFactor,
    residualMs: fit.residual,
  };
}

/** Слои по WIND.bandHeightM: ветер слоя — среднее векторов, уверенность — число и согласие. */
function profileOf(circles: readonly CircleWind[]): WindBand[] {
  const bands = new Map<number, CircleWind[]>();
  for (const circle of circles) {
    const bottom = Math.floor(circle.altitudeM / WIND.bandHeightM) * WIND.bandHeightM;
    bands.set(bottom, [...(bands.get(bottom) ?? []), circle]);
  }
  return [...bands.entries()]
    .sort(([a], [b]) => a - b)
    .map(([bottom, members]) => {
      const mean = meanWind(members.map((m) => m.wind)) ?? windOf(0, 0);
      const spread = Math.sqrt(
        members.reduce((sum, m) => sum + (m.wind.eastMs - mean.eastMs) ** 2 + (m.wind.northMs - mean.northMs) ** 2, 0) / members.length,
      );
      const coverage = Math.min(1, members.length / WIND.fullConfidenceCircles);
      const agreement = Math.max(0, 1 - spread / WIND.maxSpreadMs);
      return {
        altitudeBand: [bottom, bottom + WIND.bandHeightM] as [number, number],
        windSpeedMs: mean.speedMs,
        windDirDeg: mean.dirDeg,
        confidence: coverage * agreement,
        circleCount: members.length,
      };
    });
}

/**
 * Ветер полёта по найденным кругам (detectCircles) и термикам (detectThermals).
 * airspeed — пределы воздушной скорости типа ЛА (WIND[тип]).
 */
export function estimateWind(
  points: WindColumns,
  circles: readonly Circle[],
  thermals: readonly Thermal[],
  airspeed: AirspeedLimits,
): WindAnalysis {
  const accepted: CircleWind[] = [];
  circles.forEach((circle, index) => {
    const wind = circleWind(points, circle, index, airspeed);
    if (wind) accepted.push(wind);
  });

  const thermalWinds: ThermalWind[] = thermals.map((thermal, thermalIndex) => {
    const drift = thermal.driftEastMs === null || thermal.driftNorthMs === null ? null : windOf(thermal.driftEastMs, thermal.driftNorthMs);
    const inside = accepted.filter((c) => {
      const circle = circles[c.circleIndex];
      return circle !== undefined && circle.startIndex >= thermal.startIndex && circle.endIndex <= thermal.endIndex;
    });
    const byCircles = meanWind(inside.map((c) => c.wind));
    return {
      thermalIndex,
      drift,
      circles: byCircles,
      disagreementMs: drift && byCircles ? Math.hypot(drift.eastMs - byCircles.eastMs, drift.northMs - byCircles.northMs) : null,
    };
  });

  return {
    circles: accepted,
    profile: profileOf(accepted),
    thermals: thermalWinds,
    flight: meanWind(accepted.map((c) => c.wind)),
  };
}
