/**
 * Режимы камеры (ТЗ §7.4). Значения подобраны на docs/prototypes/prototype-viewer.html:
 * при смене цифр правится и §7.4 ТЗ.
 */

export const CAMERA_MODES = ['chase', 'free', 'cockpit', 'top'] as const;
export type CameraMode = (typeof CAMERA_MODES)[number];

export const DEFAULT_CAMERA_MODE: CameraMode = 'chase';

/** Порядок горячих клавиш 1–4 (ТЗ §7.5). */
export const CAMERA_HOTKEY_ORDER: readonly CameraMode[] = ['chase', 'free', 'cockpit', 'top'];

export interface CameraPose {
  /** Курс: null — брать сглаженный курс полёта. */
  headingDeg: number | null;
  pitchDeg: number;
  /** Дистанция до пилота, м. */
  rangeM: number;
}

/** null — режим без слежения: камера свободна. */
export const CAMERA_POSES: Record<CameraMode, CameraPose | null> = {
  chase: { headingDeg: null, pitchDeg: -14, rangeM: 90 },
  cockpit: { headingDeg: null, pitchDeg: -6, rangeM: 12 },
  top: { headingDeg: 0, pitchDeg: -89, rangeM: 1400 },
  free: null,
};

/**
 * ТЗ §7.4: экспоненциальное сглаживание курса, τ ≈ 2 с. Без него камера
 * в спирали дёргается и укачивает. τ подобран на прототипе.
 */
export const CHASE_SMOOTHING_TAU_S = 2;

const FULL_TURN_DEG = 360;
const HALF_TURN_DEG = 180;

/** Разность курсов в (−180, 180]. */
export function shortestTurn(fromDeg: number, toDeg: number): number {
  const delta = ((toDeg - fromDeg) % FULL_TURN_DEG + FULL_TURN_DEG) % FULL_TURN_DEG;
  return delta > HALF_TURN_DEG ? delta - FULL_TURN_DEG : delta;
}

/**
 * Шаг сглаживания курса. previous = null — первый кадр, берём цель как есть.
 * elapsedS — сколько секунд трека прошло за кадр (зависит от множителя часов).
 */
export function smoothHeading(previous: number | null, targetDeg: number, elapsedS: number): number {
  if (previous === null || Number.isNaN(previous)) return targetDeg;
  if (Number.isNaN(targetDeg)) return previous;
  const k = Math.min(1, Math.max(0, elapsedS / CHASE_SMOOTHING_TAU_S));
  return previous + shortestTurn(previous, targetDeg) * k;
}
