import type { FlightRange } from '@skyline/core';

import { indexAt, MS_PER_SECOND } from './playback';

/**
 * Позы пилота и крыла на сцене — расчёт без Cesium. Узлы модели
 * (tools/make-paraglider.mjs): купол со стропами, пилот в коконе, пилот стоя,
 * две ноги, рюкзак. Сцена задаёт им преобразования (nodeTransformations)
 * в каждом кадре по этой позе.
 *
 * До взлёта пилот идёт с рюкзаком или стоит у разложенного крыла; последние
 * секунды — разбег, крыло поднимается над головой. После посадки купол
 * опадает, потом пилот стоит у крыла или уходит с рюкзаком.
 */

export const POSE = {
  /**
   * На земле быстрее — идёт: GPS у стоящего пилота «гуляет» на 0.2–0.4 м/с,
   * шаг — от 0.8 м/с.
   */
  walkSpeedMs: 0.6,
  /** Сглаживание скорости, точек в каждую сторону: одиночный скачок GPS — не шаг. */
  speedWindow: 3,
  /** Разбег с подъёмом крыла — столько секунд до взлёта (обычный старт — 4–8 с). */
  inflationS: 6,
  /** После касания купол опадает за столько секунд. */
  collapseS: 3,
  /**
   * Лежащее крыло: купол повёрнут вокруг точки подвеса назад на этот угол —
   * как маятник, стропы остаются у пилота. 98° = 90° плюс наклон строп к
   * земле: подвеска в метре над землёй, купол — в 7.4 м, asin(1 / 7.4) ≈ 8°.
   * Купол ложится дугой позади пилота — так крыло раскладывают перед стартом.
   */
  lyingAngleDeg: 98,
  /** Лежащее крыло сплющено по хорде до этой доли — лежит на земле, а не стоит ребром. */
  lyingFlatten: 0.12,
  /** Размах шага ноги, градусы, и частота шагового цикла, Гц. */
  gait: { walking: { amplitudeDeg: 25, hz: 1 }, running: { amplitudeDeg: 40, hz: 1.5 } },
  /** Наклон корпуса вперёд на разбеге, градусы. */
  runLeanDeg: 12,
} as const;

export type PilotPose = 'flying' | 'standing' | 'walking' | 'running';
export type WingPose = 'flying' | 'lying' | 'packed' | 'rising' | 'falling';

export interface GliderPose {
  pilot: PilotPose;
  wing: WingPose;
  /** Купол: 0 — лежит на земле, 1 — над головой. */
  wingProgress: number;
  /** Фаза шагового цикла, радианы. */
  gaitPhase: number;
}

export interface PoseTrack {
  t: Float64Array;
  /** Путевая скорость, м/с. */
  gSpeed: Float64Array;
}

function smoothedSpeed(track: PoseTrack, index: number): number {
  let sum = 0;
  let count = 0;
  for (let k = index - POSE.speedWindow; k <= index + POSE.speedWindow; k++) {
    const v = track.gSpeed[k];
    if (v === undefined || !Number.isFinite(v)) continue;
    sum += v;
    count += 1;
  }
  return count > 0 ? sum / count : 0;
}

export function gliderPose(track: PoseTrack, range: FlightRange, timeMs: number): GliderPose {
  const index = indexAt(track.t, timeMs);
  const takeoffMs = track.t[range.takeoff] ?? Infinity;
  const landingMs = track.t[range.landing] ?? -Infinity;
  const onFoot = (): { pilot: PilotPose; wing: WingPose } =>
    smoothedSpeed(track, index) > POSE.walkSpeedMs ? { pilot: 'walking', wing: 'packed' } : { pilot: 'standing', wing: 'lying' };

  let pose: { pilot: PilotPose; wing: WingPose; wingProgress: number };
  if (timeMs < takeoffMs) {
    const leftS = (takeoffMs - timeMs) / MS_PER_SECOND;
    pose =
      leftS <= POSE.inflationS
        ? { pilot: 'running', wing: 'rising', wingProgress: 1 - leftS / POSE.inflationS }
        : { ...onFoot(), wingProgress: 0 };
  } else if (timeMs > landingMs) {
    const sinceS = (timeMs - landingMs) / MS_PER_SECOND;
    pose =
      sinceS <= POSE.collapseS
        ? { pilot: 'standing', wing: 'falling', wingProgress: 1 - sinceS / POSE.collapseS }
        : { ...onFoot(), wingProgress: 0 };
  } else {
    pose = { pilot: 'flying', wing: 'flying', wingProgress: 1 };
  }
  const gait = pose.pilot === 'walking' || pose.pilot === 'running' ? POSE.gait[pose.pilot] : null;
  return { ...pose, gaitPhase: gait ? (2 * Math.PI * gait.hz * timeMs) / MS_PER_SECOND : 0 };
}

export type Vec3 = readonly [number, number, number];
export type Quat = readonly [number, number, number, number];

/** Преобразование узла: перенос, поворот (кватернион x, y, z, w), масштаб; масштаб 0 — узел скрыт. */
export interface NodeTransform {
  translation: Vec3;
  rotation: Quat;
  scale: Vec3;
}

export const GLIDER_NODES = ['canopy', 'pilot-seated', 'pilot-standing', 'leg-left', 'leg-right', 'backpack'] as const;
export type GliderNode = (typeof GLIDER_NODES)[number];

const DEG = Math.PI / 180;
const IDENTITY_ROTATION: Quat = [0, 0, 0, 1];
const SHOWN: NodeTransform = { translation: [0, 0, 0], rotation: IDENTITY_ROTATION, scale: [1, 1, 1] };
const HIDDEN: NodeTransform = { translation: [0, 0, 0], rotation: IDENTITY_ROTATION, scale: [0, 0, 0] };
/** Поворот вокруг оси X модели (плюс — верх к носу, +Z). */
const aroundX = (radians: number): Quat => (radians === 0 ? IDENTITY_ROTATION : [Math.sin(radians / 2), 0, 0, Math.cos(radians / 2)]);
/** Плавный старт и остановка подъёма и опадания купола. */
const smoothstep = (x: number): number => x * x * (3 - 2 * x);

/**
 * Купол — маятник вокруг точки подвеса: лежит позади (повёрнут на
 * POSE.lyingAngleDeg и сплющен по хорде), поднимается над головой, опадает.
 * Стропы — в том же узле и поворачиваются с ним: всегда идут от пилота.
 */
function canopyTransform(pose: GliderPose): NodeTransform {
  if (pose.wing === 'packed') return HIDDEN;
  if (pose.wing === 'flying') return SHOWN;
  const q = smoothstep(Math.min(1, Math.max(0, pose.wingProgress)));
  if (q === 1) return SHOWN;
  return {
    translation: [0, 0, 0],
    rotation: aroundX(-POSE.lyingAngleDeg * DEG * (1 - q)),
    scale: [1, 1, POSE.lyingFlatten + (1 - POSE.lyingFlatten) * q],
  };
}

/** Преобразования всех узлов модели для позы. */
export function nodeTransforms(pose: GliderPose): Record<GliderNode, NodeTransform> {
  const flying = pose.pilot === 'flying';
  const gait = pose.pilot === 'walking' || pose.pilot === 'running' ? POSE.gait[pose.pilot] : null;
  const swing = gait ? gait.amplitudeDeg * DEG * Math.sin(pose.gaitPhase) : 0;
  const leg = (sign: 1 | -1): NodeTransform => (flying ? HIDDEN : { ...SHOWN, rotation: aroundX(sign * swing) });
  return {
    canopy: canopyTransform(pose),
    'pilot-seated': flying ? SHOWN : HIDDEN,
    'pilot-standing': flying ? HIDDEN : { ...SHOWN, rotation: aroundX(pose.pilot === 'running' ? POSE.runLeanDeg * DEG : 0) },
    'leg-left': leg(1),
    'leg-right': leg(-1),
    backpack: pose.wing === 'packed' ? SHOWN : HIDDEN,
  };
}
