import { CAMERA_POSES, type CameraMode } from './camera-modes';

/**
 * Мышь в режимах камеры (ТЗ §7.4). В следящих режимах камеру каждый кадр
 * ставит код, поэтому штатное управление Cesium там выключено: колесо и
 * перетаскивание меняют поправки к позе режима, а не саму камеру — иначе
 * кадр перезаписывал бы ввод и камера дёргалась. Здесь только чистая математика.
 */

export type FollowMode = Exclude<CameraMode, 'free'>;

export interface CameraLimits {
  minRangeM: number;
  maxRangeM: number;
  minPitchDeg: number;
  maxPitchDeg: number;
}

export const CAMERA_LIMITS: Record<FollowMode, CameraLimits> = {
  /** ТЗ §7.4: 5–200 м колесом. Наклон — не под пилота и не в зенит. */
  chase: { minRangeM: 5, maxRangeM: 200, minPitchDeg: -80, maxPitchDeg: -2 },
  /** Вид «из кабины»: близко к пилоту, взгляд вниз не круче 45°. */
  cockpit: { minRangeM: 5, maxRangeM: 50, minPitchDeg: -45, maxPitchDeg: 0 },
  /** Вид сверху: от одного термика до всего перехода; наклон фиксирован. */
  top: { minRangeM: 300, maxRangeM: 5000, minPitchDeg: -89, maxPitchDeg: -89 },
};

/** Поправки пилота к позе режима; сбрасываются при смене режима. */
export interface CameraAdjust {
  rangeM: number;
  pitchDeg: number;
  headingOffsetDeg: number;
}

/**
 * Дельта колеса за один щелчок, px: столько даёт WheelEvent.deltaY в Chromium
 * на Windows. Тачпад присылает мелкие дельты — они складываются в тот же шаг.
 */
export const WHEEL_NOTCH = 100;
/** Щелчок колеса меняет дистанцию на 15 %: заметно, но без прыжков. */
export const ZOOM_STEP_PER_NOTCH = 0.15;
/** Градусов поворота на пиксель перетаскивания: полоборота — 720 px. */
export const ORBIT_DEG_PER_PX = 0.25;

/** WheelEvent.deltaMode: 0 — пиксели, 1 — строки, 2 — страницы. */
const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;
/** Firefox прокручивает по 3 строки на щелчок колеса. */
const LINES_PER_NOTCH = 3;

/** Дельта колеса в пикселях «приближения»: колесо от себя (deltaY < 0) — ближе. */
export function wheelZoomInPx(event: { deltaY: number; deltaMode: number }): number {
  const scale =
    event.deltaMode === DOM_DELTA_LINE ? WHEEL_NOTCH / LINES_PER_NOTCH : event.deltaMode === DOM_DELTA_PAGE ? WHEEL_NOTCH : 1;
  return -event.deltaY * scale;
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export function initialAdjust(mode: FollowMode): CameraAdjust {
  const pose = CAMERA_POSES[mode];
  if (!pose) throw new Error(`Camera mode ${mode} has no pose`);
  return { rangeM: pose.rangeM, pitchDeg: pose.pitchDeg, headingOffsetDeg: 0 };
}

/** zoomInPx > 0 — ближе (колесо от себя), < 0 — дальше. */
export function zoomBy(adjust: CameraAdjust, mode: FollowMode, zoomInPx: number): CameraAdjust {
  const { minRangeM, maxRangeM } = CAMERA_LIMITS[mode];
  const factor = (1 + ZOOM_STEP_PER_NOTCH) ** (zoomInPx / WHEEL_NOTCH);
  return { ...adjust, rangeM: clamp(adjust.rangeM / factor, minRangeM, maxRangeM) };
}

/** Перетаскивание: вправо — облёт по курсу, вверх — к горизонту. */
export function orbitBy(adjust: CameraAdjust, mode: FollowMode, dxPx: number, dyPx: number): CameraAdjust {
  // ТЗ §7.4: Top следит за пилотом «без вращения».
  if (mode === 'top') return adjust;
  const { minPitchDeg, maxPitchDeg } = CAMERA_LIMITS[mode];
  return {
    ...adjust,
    headingOffsetDeg: adjust.headingOffsetDeg + dxPx * ORBIT_DEG_PER_PX,
    pitchDeg: clamp(adjust.pitchDeg - dyPx * ORBIT_DEG_PER_PX, minPitchDeg, maxPitchDeg),
  };
}

/** Поза кадра: курс режима или сглаженный курс полёта плюс поправки пилота. */
export function poseFor(
  mode: FollowMode,
  adjust: CameraAdjust,
  flightHeadingDeg: number,
): { headingDeg: number; pitchDeg: number; rangeM: number } {
  const base = CAMERA_POSES[mode]?.headingDeg ?? flightHeadingDeg;
  return { headingDeg: base + adjust.headingOffsetDeg, pitchDeg: adjust.pitchDeg, rangeM: adjust.rangeM };
}

/**
 * Свободный режим — штатное управление Cesium, но мягче его умолчаний
 * (zoomFactor 5, инерция 0.8–0.9): у склона щелчок колеса бросал камеру
 * почти до земли, а после отпускания мыши она долго «доезжала».
 */
export const FREE_CAMERA = {
  zoomFactor: 2,
  inertiaZoom: 0.3,
  inertiaSpin: 0.5,
  inertiaTranslate: 0.5,
  /** Ближе 5 м к рельефу камера не подходит — не проваливается под склон. */
  minimumZoomDistanceM: 5,
} as const;

/** Смещение камеры от пилота в локальной системе восток–север–верх, м. */
export interface EnuOffset {
  east: number;
  north: number;
  up: number;
}

export interface HeadingPitchRangeDeg {
  headingDeg: number;
  pitchDeg: number;
  rangeM: number;
}

const DEG_PER_RAD = 180 / Math.PI;

/**
 * Курс, наклон и дистанция камеры, смотрящей на пилота, — в соглашении
 * Cesium HeadingPitchRange: курс — куда смотрит камера (0 — север, 90 — восток),
 * наклон отрицательный — вниз. Камера стоит против направления взгляда.
 */
export function hprFromOffset(offset: EnuOffset): HeadingPitchRangeDeg {
  const rangeM = Math.hypot(offset.east, offset.north, offset.up);
  if (rangeM === 0) return { headingDeg: 0, pitchDeg: 0, rangeM: 0 };
  return {
    headingDeg: Math.atan2(-offset.east, -offset.north) * DEG_PER_RAD,
    pitchDeg: Math.asin(-offset.up / rangeM) * DEG_PER_RAD,
    rangeM,
  };
}

/** Обратное к hprFromOffset — так Cesium ставит камеру в camera.lookAt. */
export function offsetFromHpr(hpr: HeadingPitchRangeDeg): EnuOffset {
  const heading = hpr.headingDeg / DEG_PER_RAD;
  const pitch = hpr.pitchDeg / DEG_PER_RAD;
  return {
    east: -hpr.rangeM * Math.cos(pitch) * Math.sin(heading),
    north: -hpr.rangeM * Math.cos(pitch) * Math.cos(heading),
    up: -hpr.rangeM * Math.sin(pitch),
  };
}

/**
 * Наклон при облёте в Free: не ниже горизонта у пилота (камера ушла бы под
 * него) и не строго в надир — там курс вырождается и облёт «залипает».
 */
export const FREE_ORBIT_PITCH = { minDeg: -88, maxDeg: -2 } as const;

/** Ctrl + перетаскивание в Free: облёт пилота на той же дистанции. */
export function orbitAroundPilot(hpr: HeadingPitchRangeDeg, dxPx: number, dyPx: number): HeadingPitchRangeDeg {
  return {
    headingDeg: hpr.headingDeg + dxPx * ORBIT_DEG_PER_PX,
    pitchDeg: clamp(hpr.pitchDeg - dyPx * ORBIT_DEG_PER_PX, FREE_ORBIT_PITCH.minDeg, FREE_ORBIT_PITCH.maxDeg),
    rangeM: hpr.rangeM,
  };
}
