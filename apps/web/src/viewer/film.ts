import { haversineDistance, type CutCamera, type CutScene } from '@skyline/analysis';

import type { HeadingPitchRangeDeg } from './camera-input';
import { shortestTurn, springHeading, type HeadingState } from './camera-modes';
import { cameraTarget, targetHalfWidthS, type TargetTrack } from './camera-target';

/**
 * «Фильм» по автомонтажу (задачи 4.1–4.2, ТЗ §7.6): сцены autoEdit идут подряд,
 * между ними камера отъезжает вверх над треком и подлетает к пилоту в новом
 * месте (кривая Безье по дальности и наклону), время полёта в перелёте
 * проматывается. Здесь только чистая математика: хронометраж, кадр по
 * экранному времени, поза камеры сцены и перелёта.
 */

/**
 * Дистанции подобраны по отзыву владельца на первый черновик («непонятно, где
 * параплан»): с 260 м и 1,2 км крыло было точкой. Теперь оно всегда крупно,
 * а общий вид местности даёт перелёт.
 */
export const FILM = {
  /** Перелёт между сценами, с экрана: успеть увидеть сверху, куда пилот улетел. */
  transitionS: 2.5,
  /** Низкий орбит взлёта: близко к пилоту, чуть сверху, облёт на треть круга. */
  lowOrbit: { rangeM: 45, pitchDeg: -8, sweepDeg: 120 },
  /**
   * Орбитальный подъём в термике: крыло крупно, в кадре — ближний виток
   * (радиусы 30–60 м); полкруга облёта, взгляд опускается — видно набор.
   */
  orbitClimb: { rangeM: 90, pitchFromDeg: -8, pitchToDeg: -22, sweepDeg: 180 },
  /** Chase — как режим Chase просмотрщика (90 м), чуть ближе: крыло во весь кадр. */
  chase: { rangeM: 70, pitchDeg: -12 },
  /** Пролёт у вершины: пилот ещё различим, за ним горы; медленный облёт. */
  wideFlyby: { rangeM: 250, pitchDeg: -15, sweepDeg: 60 },
  /** Конец посадки — вид сверху: поле и последняя коробочка. */
  top: { rangeM: 500, pitchDeg: -89 },
  /**
   * Отъезд перелёта: камера поднимается на дальность, с которой оба места
   * в кадре, — расстояние между ними с запасом, но не дальше 15 км (длинный
   * переход через хребет — достаточно видеть направление) и не ближе 600 м.
   */
  pullbackShare: 1.2,
  minPullbackM: 600,
  maxPullbackM: 15000,
  /** На высшей точке отъезда взгляд сверху под углом — видна земля и трек. */
  pullbackPitchDeg: -55,
} as const;

export interface FilmShot {
  scene: CutScene;
  /** Секунды экрана от начала фильма. */
  startS: number;
  endS: number;
}

export interface Film {
  shots: FilmShot[];
  totalS: number;
}

export function filmTimeline(scenes: readonly CutScene[]): Film {
  const shots: FilmShot[] = [];
  let cursor = 0;
  scenes.forEach((scene, k) => {
    if (k > 0) cursor += FILM.transitionS;
    shots.push({ scene, startS: cursor, endS: cursor + scene.durationS });
    cursor += scene.durationS;
  });
  return { shots, totalS: cursor };
}

export type FilmFrame =
  /** Сцена index, u — доля сцены [0, 1). */
  | { kind: 'scene'; index: number; u: number; flightMs: number }
  /** Перелёт от сцены index к index + 1, u — доля перелёта. */
  | { kind: 'transition'; index: number; u: number; flightMs: number };

/**
 * Мягкий старт и финиш, как CSS cubic-bezier(0.65, 0, 0.35, 1): смещение
 * кривой Безье по времени (решается методом Ньютона), без рывка на концах.
 */
const EASE = { x1: 0.65, y1: 0, x2: 0.35, y2: 1 } as const;
const NEWTON_STEPS = 8;

const bezier1d = (p1: number, p2: number, s: number): number => 3 * (1 - s) ** 2 * s * p1 + 3 * (1 - s) * s * s * p2 + s ** 3;
const bezier1dSlope = (p1: number, p2: number, s: number): number =>
  3 * (1 - s) ** 2 * p1 + 6 * (1 - s) * s * (p2 - p1) + 3 * s * s * (1 - p2);

export function easeInOut(u: number): number {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  let s = u;
  for (let k = 0; k < NEWTON_STEPS; k++) {
    const slope = bezier1dSlope(EASE.x1, EASE.x2, s);
    if (slope === 0) break;
    s = Math.min(1, Math.max(0, s - (bezier1d(EASE.x1, EASE.x2, s) - u) / slope));
  }
  return bezier1d(EASE.y1, EASE.y2, s);
}

/** Кадр фильма на секунде экрана; после конца — null. */
export function filmFrameAt(film: Film, screenS: number): FilmFrame | null {
  const first = film.shots[0];
  if (!first) return null;
  if (screenS < 0) return { kind: 'scene', index: 0, u: 0, flightMs: first.scene.fromMs };
  if (screenS >= film.totalS) return null;
  for (let k = 0; k < film.shots.length; k++) {
    const shot = film.shots[k];
    if (!shot) break;
    if (screenS < shot.endS) {
      const u = (screenS - shot.startS) / (shot.endS - shot.startS);
      return { kind: 'scene', index: k, u, flightMs: shot.scene.fromMs + u * (shot.scene.toMs - shot.scene.fromMs) };
    }
    const next = film.shots[k + 1];
    if (next && screenS < next.startS) {
      const u = (screenS - shot.endS) / (next.startS - shot.endS);
      return { kind: 'transition', index: k, u, flightMs: shot.scene.toMs + easeInOut(u) * (next.scene.fromMs - shot.scene.toMs) };
    }
  }
  return null;
}

export interface FilmPoint {
  lat: number;
  lon: number;
  alt: number;
}

/**
 * Перелёт между сценами: камера смотрит на точку, скользящую по прямой от
 * пилота в конце сцены к пилоту в начале следующей, а дальность и наклон
 * идут по квадратичной Безье через «отъезд» — высоко над серединой, взгляд
 * сверху. u — уже сглаженная доля перелёта.
 */
export function pullback(
  a: { at: FilmPoint; pose: HeadingPitchRangeDeg },
  b: { at: FilmPoint; pose: HeadingPitchRangeDeg },
  u: number,
): { at: FilmPoint; pose: HeadingPitchRangeDeg } {
  if (u <= 0) return a;
  if (u >= 1) return b;
  const distanceM = haversineDistance(a.at.lat, a.at.lon, b.at.lat, b.at.lon);
  const topM = Math.min(FILM.maxPullbackM, Math.max(FILM.minPullbackM, distanceM * FILM.pullbackShare));
  // Контрольная точка Безье — там, где кривая проходит через вершину в середине.
  const control = (from: number, to: number, top: number): number => 2 * top - (from + to) / 2;
  const bezier = (from: number, to: number, top: number): number =>
    (1 - u) ** 2 * from + 2 * (1 - u) * u * control(from, to, top) + u * u * to;
  return {
    at: { lat: lerp(a.at.lat, b.at.lat, u), lon: lerp(a.at.lon, b.at.lon, u), alt: lerp(a.at.alt, b.at.alt, u) },
    pose: {
      headingDeg: a.pose.headingDeg + shortestTurn(a.pose.headingDeg, b.pose.headingDeg) * u,
      pitchDeg: bezier(a.pose.pitchDeg, b.pose.pitchDeg, FILM.pullbackPitchDeg),
      rangeM: bezier(a.pose.rangeM, b.pose.rangeM, topM),
    },
  };
}

const lerp = (a: number, b: number, u: number): number => a + (b - a) * u;

/**
 * Поза камеры сцены на доле u. courseDeg — сглаженный курс полёта сейчас
 * (для chase), startDeg — курс в начале сцены: облёты считаются от него,
 * чтобы орбита не крутилась вместе с пилотом.
 */
export function scenePose(camera: CutCamera, u: number, courseDeg: number, startDeg: number): HeadingPitchRangeDeg {
  switch (camera) {
    case 'lowOrbit':
      return { headingDeg: startDeg + FILM.lowOrbit.sweepDeg * u, pitchDeg: FILM.lowOrbit.pitchDeg, rangeM: FILM.lowOrbit.rangeM };
    case 'orbitClimb':
      return {
        headingDeg: startDeg + FILM.orbitClimb.sweepDeg * u,
        pitchDeg: lerp(FILM.orbitClimb.pitchFromDeg, FILM.orbitClimb.pitchToDeg, u),
        rangeM: FILM.orbitClimb.rangeM,
      };
    case 'chase':
      return { headingDeg: courseDeg, pitchDeg: FILM.chase.pitchDeg, rangeM: FILM.chase.rangeM };
    case 'wideFlyby':
      return { headingDeg: startDeg + FILM.wideFlyby.sweepDeg * u, pitchDeg: FILM.wideFlyby.pitchDeg, rangeM: FILM.wideFlyby.rangeM };
    case 'chaseToTop': {
      const e = easeInOut(u);
      return {
        headingDeg: startDeg,
        pitchDeg: lerp(FILM.chase.pitchDeg, FILM.top.pitchDeg, e),
        rangeM: lerp(FILM.chase.rangeM, FILM.top.rangeM, e),
      };
    }
  }
}

/** Стыки сцены: где камера и как смотрит в начале и в конце — для перелётов. */
export interface FilmPlanShot {
  scene: CutScene;
  /** Курс в начале сцены: от него считаются облёты. */
  startDeg: number;
  in: { at: FilmPoint; pose: HeadingPitchRangeDeg };
  out: { at: FilmPoint; pose: HeadingPitchRangeDeg };
}

/** Точка, на которую смотрит камера сцены: сглаженная траектория, окно — по ускорению сцены. */
const aimOf = (track: TargetTrack, scene: CutScene, ms: number): FilmPoint => cameraTarget(track, ms, targetHalfWidthS(scene.timeScale));

export function filmPlan(film: Film, track: TargetTrack, courseAt: (ms: number) => number): FilmPlanShot[] {
  return film.shots.map(({ scene }) => {
    const startDeg = courseAt(scene.fromMs);
    return {
      scene,
      startDeg,
      in: { at: aimOf(track, scene, scene.fromMs), pose: scenePose(scene.camera, 0, startDeg, startDeg) },
      out: { at: aimOf(track, scene, scene.toMs), pose: scenePose(scene.camera, 1, courseAt(scene.toMs), startDeg) },
    };
  });
}

/**
 * Камера кадра фильма. В сцене — поза её камеры; курс для chase — пружиной,
 * как в просмотрщике. В перелёте — отъезд над треком (pullback); пружина
 * курса встаёт на курс следующей сцены, чтобы chase начался без рывка.
 */
export function filmCamera(
  plan: readonly FilmPlanShot[],
  frame: FilmFrame,
  track: TargetTrack,
  courseAt: (ms: number) => number,
  heading: { current: HeadingState | null },
  elapsedS: number,
): { at: FilmPoint; pose: HeadingPitchRangeDeg } | null {
  const shot = plan[frame.index];
  if (!shot) return null;
  if (frame.kind === 'scene') {
    heading.current = springHeading(heading.current, courseAt(frame.flightMs), elapsedS);
    return {
      at: aimOf(track, shot.scene, frame.flightMs),
      pose: scenePose(shot.scene.camera, frame.u, heading.current.headingDeg, shot.startDeg),
    };
  }
  const next = plan[frame.index + 1];
  if (!next) return null;
  heading.current = { headingDeg: next.startDeg, rateDegS: 0 };
  return pullback(shot.out, next.in, easeInOut(frame.u));
}
