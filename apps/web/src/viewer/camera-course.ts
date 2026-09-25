/**
 * Курс для следящих камер (Chase, Side): куда пилот в целом летит, а не
 * мгновенный курс между двумя фиксами. Мгновенный в термике обходит полный
 * круг за вираж и шумит от GPS на десятки градусов — камера за ним крутилась
 * и дёргалась (ТЗ §7.4: «иначе укачивает в виражах»).
 *
 * Курс — направление от центра тяжести позиций за предыдущее окно к центру
 * тяжести за последнее. Круг термика внутри окна почти целиком гасится
 * (ровно — если вираж длится окно), остаётся снос или направление глайда.
 * Позиции берутся на равномерной сетке времени с интерполяцией между
 * фиксами, поэтому курс меняется непрерывно, без ступенек раз в секунду.
 */

export interface CourseTrack {
  /** UNIX мс, по возрастанию. */
  t: Float64Array;
  lat: Float64Array;
  lon: Float64Array;
}

/**
 * Окно, с. Длительность одного виража параплана в термике — 15–25 с: за окно
 * круг почти замыкается и его вклад в центр тяжести мал (для виража 22 с
 * при сносе 3 м/с остаток — около 7°). Длиннее — камера запаздывает на
 * разворотах глайда: курс отстаёт примерно на одно окно.
 */
export const COURSE_WINDOW_S = 20;

/**
 * Меньше этого сдвига центров, м, — курса нет (NaN): пилот стоит или крутит
 * без сноса. Камера тогда держит прежний курс, а не ловит шум. 20 м за 20 с —
 * 1 м/с, медленнее пешехода.
 */
export const COURSE_MIN_SHIFT_M = 20;

/** Шаг сетки времени, с: фиксы у приборов — раз в 1–5 с, чаще брать незачем. */
const SAMPLE_STEP_S = 1;

const MS_PER_S = 1000;
const EARTH_RADIUS_M = 6_371_000;
const DEG = Math.PI / 180;
const FULL_TURN_DEG = 360;

/** Индекс последнего фикса не позже timeMs (двоичный поиск); −1 — раньше трека. */
function fixBefore(t: Float64Array, timeMs: number): number {
  let lo = 0;
  let hi = t.length - 1;
  if (hi < 0 || timeMs < (t[0] ?? Number.NaN)) return -1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((t[mid] ?? Number.NaN) <= timeMs) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Позиция в момент timeMs: линейно между фиксами, за краями трека — крайний фикс. */
function positionAt(track: CourseTrack, timeMs: number): { lat: number; lon: number } {
  const last = track.t.length - 1;
  const i = Math.max(0, fixBefore(track.t, timeMs));
  const j = Math.min(last, i + 1);
  const t0 = track.t[i] ?? 0;
  const t1 = track.t[j] ?? 0;
  const k = t1 > t0 ? Math.min(1, Math.max(0, (timeMs - t0) / (t1 - t0))) : 0;
  const lat0 = track.lat[i] ?? Number.NaN;
  const lon0 = track.lon[i] ?? Number.NaN;
  return { lat: lat0 + ((track.lat[j] ?? lat0) - lat0) * k, lon: lon0 + ((track.lon[j] ?? lon0) - lon0) * k };
}

/** Центр тяжести позиций на [fromMs, toMs] в метрах от опорной точки (восток, север). */
function centroid(
  track: CourseTrack,
  fromMs: number,
  toMs: number,
  origin: { lat: number; lon: number },
): { east: number; north: number } {
  const steps = Math.max(1, Math.round((toMs - fromMs) / (SAMPLE_STEP_S * MS_PER_S)));
  const cosLat = Math.cos(origin.lat * DEG);
  let east = 0;
  let north = 0;
  for (let s = 0; s <= steps; s++) {
    const p = positionAt(track, fromMs + ((toMs - fromMs) * s) / steps);
    east += (p.lon - origin.lon) * DEG * EARTH_RADIUS_M * cosLat;
    north += (p.lat - origin.lat) * DEG * EARTH_RADIUS_M;
  }
  return { east: east / (steps + 1), north: north / (steps + 1) };
}

/**
 * Курс перемещения к моменту timeMs, градусы [0, 360), 0 — север.
 * NaN — курса нет: трек пуст, пилот стоит или крутит без сноса.
 * В начале трека окна сжимаются до того, что уже пролетено.
 */
export function travelCourse(track: CourseTrack, timeMs: number): number {
  const count = track.t.length;
  if (count === 0) return Number.NaN;
  const startMs = track.t[0] ?? Number.NaN;
  const nowMs = Math.min(timeMs, track.t[count - 1] ?? Number.NaN);
  const spanMs = Math.min(2 * COURSE_WINDOW_S * MS_PER_S, nowMs - startMs);
  if (!(spanMs > 0)) return Number.NaN;

  const origin = positionAt(track, nowMs);
  const half = spanMs / 2;
  const earlier = centroid(track, nowMs - spanMs, nowMs - half, origin);
  const later = centroid(track, nowMs - half, nowMs, origin);
  const east = later.east - earlier.east;
  const north = later.north - earlier.north;
  if (!(Math.hypot(east, north) >= COURSE_MIN_SHIFT_M)) return Number.NaN;
  return ((Math.atan2(east, north) / DEG) % FULL_TURN_DEG + FULL_TURN_DEG) % FULL_TURN_DEG;
}
