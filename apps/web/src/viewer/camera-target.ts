/**
 * Точка, на которую смотрят следящие камеры (Chase, Side, Cockpit, Top).
 *
 * Камера жёстко привязана к этой точке: любой её рывок дёргает весь кадр.
 * Позиция пилота из Cesium (Лагранж 2-й степени) непрерывна, но скорость у неё
 * скачет на каждом фиксе — там меняется тройка опорных точек, — плюс шум GPS
 * в несколько метров. На ×4 это четыре толчка кадра в секунду, на ×16 — тряска.
 *
 * Поэтому камера смотрит на сглаженную траекторию: локальная линейная
 * регрессия по фиксам с ядром (1 − u²)³. Прямой полёт она не искажает,
 * а ядро гладкое вместе с двумя производными — точка движется без толчков.
 * Сам пилот (точка на сцене) по-прежнему рисуется по сырым данным.
 */

export interface TargetTrack {
  /** UNIX мс, по возрастанию. */
  t: Float64Array;
  lat: Float64Array;
  lon: Float64Array;
  /** Высота, м (та же, по которой рисуется пилот). */
  alt: Float64Array;
}

export interface TargetPoint {
  lat: number;
  lon: number;
  alt: number;
}

/**
 * Полуширина окна в секундах экрана. Толчок заметен, если он укладывается
 * в доли секунды на экране, — значит, и гладить надо на таком масштабе:
 * на ×4 это 2 с полёта, на ×60 — 30 с (круги термика усредняются, камера
 * идёт за сносом, а пилот описывает круги в кадре).
 */
export const CAMERA_TARGET_SCREEN_HALF_WIDTH_S = 0.5;

/**
 * Не уже, с: .track лежит на сетке 1 Гц (ТЗ §5.2), в окне ±4 с — 8 фиксов,
 * регрессии есть на чём строиться. Отклонение от пилота на вираже при таком
 * окне — единицы метров. Меньше фиксов бывает только у разрыва записи
 * (> 30 с, ТЗ §5.2) — там линейная интерполяция.
 */
export const CAMERA_TARGET_MIN_HALF_WIDTH_S = 4;

const MS_PER_S = 1000;
/** Меньше — регрессия вырождена (точек мало или они в одном моменте). */
const MIN_DETERMINANT = 1e-9;

/** Полуширина окна в секундах полёта для множителя часов. */
export function targetHalfWidthS(speed: number): number {
  return Math.max(CAMERA_TARGET_MIN_HALF_WIDTH_S, Math.abs(speed) * CAMERA_TARGET_SCREEN_HALF_WIDTH_S);
}

/** Первый индекс с t[i] ≥ timeMs. */
function lowerBound(t: Float64Array, timeMs: number): number {
  let lo = 0;
  let hi = t.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((t[mid] ?? Number.POSITIVE_INFINITY) < timeMs) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Линейно между соседними фиксами; за краями — крайний фикс. */
function interpolated(track: TargetTrack, timeMs: number): TargetPoint {
  const last = track.t.length - 1;
  const j = Math.min(last, Math.max(0, lowerBound(track.t, timeMs)));
  const i = Math.max(0, j - 1);
  const t0 = track.t[i] ?? 0;
  const t1 = track.t[j] ?? 0;
  const k = t1 > t0 ? Math.min(1, Math.max(0, (timeMs - t0) / (t1 - t0))) : 0;
  const lerp = (column: Float64Array): number => {
    const a = column[i] ?? Number.NaN;
    return a + ((column[j] ?? a) - a) * k;
  };
  return { lat: lerp(track.lat), lon: lerp(track.lon), alt: lerp(track.alt) };
}

/** Локальная прямая по каналам lat, lon, alt: значение в t и наклон в единицах за секунду. */
interface LocalFit {
  value: [number, number, number];
  slopePerS: [number, number, number];
}

/**
 * Взвешенная прямая p(τ) = a + b·(τ − t) по фиксам в окне ±halfWidthS:
 * a — сглаженное значение в t, b — скорость. null — точек мало (разрыв, край).
 */
function localFit(track: TargetTrack, timeMs: number, halfWidthS: number): LocalFit | null {
  const count = track.t.length;
  const half = halfWidthS * MS_PER_S;
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  const sp = [0, 0, 0];
  const stp = [0, 0, 0];
  for (let i = lowerBound(track.t, timeMs - half); i < count; i++) {
    const dt = (track.t[i] ?? Number.NaN) - timeMs;
    if (dt > half) break;
    const u = dt / half;
    const w = (1 - u * u) ** 3;
    if (!(w > 0)) continue;
    const x = dt / MS_PER_S;
    s0 += w;
    s1 += w * x;
    s2 += w * x * x;
    const values = [track.lat[i] ?? Number.NaN, track.lon[i] ?? Number.NaN, track.alt[i] ?? Number.NaN];
    for (let k = 0; k < 3; k++) {
      sp[k] = (sp[k] ?? 0) + w * (values[k] ?? Number.NaN);
      stp[k] = (stp[k] ?? 0) + w * x * (values[k] ?? Number.NaN);
    }
  }

  const determinant = s0 * s2 - s1 * s1;
  if (!(determinant > MIN_DETERMINANT * Math.max(1, s0 * s0))) return null;
  const a = (k: number): number => (s2 * (sp[k] ?? 0) - s1 * (stp[k] ?? 0)) / determinant;
  const b = (k: number): number => (s0 * (stp[k] ?? 0) - s1 * (sp[k] ?? 0)) / determinant;
  const fit: LocalFit = { value: [a(0), a(1), a(2)], slopePerS: [b(0), b(1), b(2)] };
  return [...fit.value, ...fit.slopePerS].every(Number.isFinite) ? fit : null;
}

/**
 * Сглаженная позиция в момент timeMs. halfWidthS — полуширина окна в секундах
 * полёта (targetHalfWidthS). Мало точек в окне (разрыв записи, край трека) —
 * линейно между соседними фиксами.
 */
export function cameraTarget(track: TargetTrack, timeMs: number, halfWidthS: number): TargetPoint {
  if (track.t.length === 0) return { lat: Number.NaN, lon: Number.NaN, alt: Number.NaN };
  const fit = localFit(track, timeMs, halfWidthS);
  if (!fit) return interpolated(track, timeMs);
  const [lat, lon, alt] = fit.value;
  return { lat, lon, alt };
}

export interface TrackVelocity {
  eastMs: number;
  northMs: number;
  upMs: number;
}

const EARTH_RADIUS_M = 6_371_000;
const DEG = Math.PI / 180;

/**
 * Скорость по сглаженной траектории, м/с (восток, север, верх) — наклон той же
 * локальной прямой. Без рывков на фиксах, в отличие от разности соседних точек.
 * null — в окне мало точек.
 */
export function trackVelocity(track: TargetTrack, timeMs: number, halfWidthS: number): TrackVelocity | null {
  const fit = localFit(track, timeMs, halfWidthS);
  if (!fit) return null;
  const [lat] = fit.value;
  const [dLat, dLon, dAlt] = fit.slopePerS;
  return {
    eastMs: dLon * DEG * EARTH_RADIUS_M * Math.cos(lat * DEG),
    northMs: dLat * DEG * EARTH_RADIUS_M,
    upMs: dAlt,
  };
}

/**
 * За сколько секунд экрана окно подтягивается к новой скорости. Ширина окна
 * сдвигает точку камеры (на ×60 она уходит в центр круга термика): сменить её
 * мгновенно — значит дёрнуть кадр при нажатии кнопки скорости.
 */
export const HALF_WIDTH_EASE_TAU_S = 0.5;

/** Шаг сглаживания ширины окна; previous = null — первый кадр, берём нужное. */
export function easeHalfWidth(previous: number | null, desired: number, elapsedS: number): number {
  if (previous === null || !Number.isFinite(previous)) return desired;
  return previous + (desired - previous) * (1 - Math.exp(-Math.max(0, elapsedS) / HALF_WIDTH_EASE_TAU_S));
}
