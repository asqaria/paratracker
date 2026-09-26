import { trackVelocity, type TargetTrack } from './camera-target';
import { shortestTurn } from './camera-modes';

/**
 * Поза модели параплана (ТЗ §12, задача 2.9): курс и крен.
 *
 * Курс — направление скорости по сглаженной траектории (camera-target.ts),
 * а не VelocityOrientationProperty Cesium: тот берёт сырую точку, у которой
 * скорость скачет на каждом фиксе, — крыло дёргалось бы, как дёргалась камера.
 *
 * Крен — координированный вираж: tan(крен) = v·ω / g, где v — путевая скорость,
 * ω — скорость поворота курса. Для термика (круг 40 м на 36 км/ч) это ~14°.
 * На фиксах раз в секунду поворот различим до ~1 рад/с; спираль быстрее
 * по таким данным не восстановить — крен там будет занижен.
 */

/** Модель параплана в public/, путь от BASE_URL (генерирует tools/make-paraglider.mjs). */
export const PARAGLIDER_MODEL_PATH = 'models/paraglider.glb';

export interface AttitudeTrack extends TargetTrack {
  /** Путевая скорость, м/с (колонка .track). */
  gSpeed: Float64Array;
}

export interface GliderAttitude {
  /** Курс, градусы от севера по часовой; NaN — пилот стоит, курса нет. */
  headingDeg: number;
  /** Крен, градусы: положительный — правое крыло вниз (вираж вправо). */
  bankDeg: number;
}

/** Полуширина окна сглаживания, с полёта: гасит шум GPS, но держит вираж. */
export const ATTITUDE_HALF_WIDTH_S = 3;
/** Скорость поворота — по курсам в t ± 1 с. */
export const TURN_RATE_BASE_S = 1;
/** Медленнее — курса нет: стоит или топчется, направление скорости — шум. */
export const MIN_SPEED_FOR_HEADING_MS = 1;
/** Предел крена: больше — это уже спираль, которую по 1 Гц не восстановить. */
export const MAX_BANK_DEG = 60;
/** Стандартное ускорение свободного падения, м/с². */
const STANDARD_GRAVITY_MS2 = 9.80665;

const MS_PER_S = 1000;
const DEG = Math.PI / 180;
const FULL_TURN_DEG = 360;

function headingAt(track: TargetTrack, timeMs: number): number {
  const v = trackVelocity(track, timeMs, ATTITUDE_HALF_WIDTH_S);
  if (!v || Math.hypot(v.eastMs, v.northMs) < MIN_SPEED_FOR_HEADING_MS) return Number.NaN;
  return ((Math.atan2(v.eastMs, v.northMs) / DEG) % FULL_TURN_DEG + FULL_TURN_DEG) % FULL_TURN_DEG;
}

/** Путевая скорость в момент timeMs — линейно между фиксами. */
function speedAt(track: AttitudeTrack, timeMs: number): number {
  const t = track.t;
  let lo = 0;
  let hi = t.length - 1;
  if (hi < 0) return Number.NaN;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((t[mid] ?? Number.NaN) <= timeMs) lo = mid;
    else hi = mid - 1;
  }
  const next = Math.min(lo + 1, t.length - 1);
  const t0 = t[lo] ?? 0;
  const t1 = t[next] ?? 0;
  const k = t1 > t0 ? Math.min(1, Math.max(0, (timeMs - t0) / (t1 - t0))) : 0;
  const s0 = track.gSpeed[lo] ?? Number.NaN;
  return s0 + ((track.gSpeed[next] ?? s0) - s0) * k;
}

/** Поза в момент timeMs; inFlight = false (ходьба до взлёта, после посадки) — без крена. */
export function gliderAttitude(track: AttitudeTrack, timeMs: number, inFlight: boolean): GliderAttitude {
  const headingDeg = headingAt(track, timeMs);
  if (!inFlight || Number.isNaN(headingDeg)) return { headingDeg, bankDeg: 0 };

  const base = TURN_RATE_BASE_S * MS_PER_S;
  const before = headingAt(track, timeMs - base);
  const after = headingAt(track, timeMs + base);
  const speed = speedAt(track, timeMs);
  if (Number.isNaN(before) || Number.isNaN(after) || !Number.isFinite(speed)) return { headingDeg, bankDeg: 0 };

  const turnRadS = (shortestTurn(before, after) * DEG) / (2 * TURN_RATE_BASE_S);
  const bank = Math.atan((speed * turnRadS) / STANDARD_GRAVITY_MS2) / DEG;
  return { headingDeg, bankDeg: Math.max(-MAX_BANK_DEG, Math.min(MAX_BANK_DEG, bank)) };
}

/** Сколько секунд полёта после взлёта искать направление разбега. */
export const LAUNCH_SEARCH_S = 30;

/**
 * Направление разбега — курс в первые секунды после взлёта. До взлёта пилот,
 * стоящий на месте, курса не имеет, и модель смотрела на север: крыло,
 * разложенное «позади», ложилось куда придётся — на склоне часто вниз и в
 * воздух или вверх и в гору. На старте пилот стоит лицом к разбегу, крыло —
 * за спиной вверх по склону. NaN — курса не нашлось.
 */
export function launchHeadingDeg(track: TargetTrack, takeoffMs: number): number {
  for (let s = 0; s <= LAUNCH_SEARCH_S; s++) {
    const heading = headingAt(track, takeoffMs + s * MS_PER_S);
    if (!Number.isNaN(heading)) return heading;
  }
  return Number.NaN;
}
