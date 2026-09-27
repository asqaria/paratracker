import { haversineDistance, type CutCamera, type CutScene } from '@skyline/analysis';

import type { HeadingPitchRangeDeg } from './camera-input';
import { shortestTurn, springHeading, type HeadingState } from './camera-modes';
import { cameraTarget, targetHalfWidthS, type TargetTrack } from './camera-target';

/**
 * «Фильм» по автомонтажу (задачи 4.1–4.2, ТЗ §7.6): сцены autoEdit идут подряд,
 * между ними камера перелетает по кривой Безье с подъёмом, время полёта в
 * перелёте проматывается к началу следующей сцены. Здесь только чистая
 * математика: хронометраж, кадр по экранному времени, поза камеры сцены.
 */

export const FILM = {
  /** Перелёт между сценами, с экрана: короче — рывок, длиннее — зритель ждёт. */
  transitionS: 1.2,
  /** Низкий орбит взлёта: близко к пилоту, чуть сверху, облёт на треть круга. */
  lowOrbit: { rangeM: 70, pitchDeg: -10, sweepDeg: 120 },
  /**
   * Орбитальный подъём в термике: дальше, чтобы спираль была в кадре целиком
   * (радиусы 30–60 м, как у Side), полкруга облёта, взгляд опускается — видно набор.
   */
  orbitClimb: { rangeM: 260, pitchFromDeg: -10, pitchToDeg: -30, sweepDeg: 180 },
  /** Chase — как режим Chase просмотрщика, чуть дальше: на ускорении пилот не выпрыгивает из кадра. */
  chase: { rangeM: 110, pitchDeg: -14 },
  /** Широкий пролёт у вершины: видно, над чем пилот, медленный облёт. */
  wideFlyby: { rangeM: 1200, pitchDeg: -25, sweepDeg: 60 },
  /** Конец посадки — вид сверху издалека: поле и последняя коробочка. */
  top: { rangeM: 1200, pitchDeg: -89 },
  /**
   * Подъём перелёта: доля расстояния между сценами, но не выше 1,5 км —
   * иначе на 100-километровом маршруте камера улетала бы в стратосферу.
   */
  arcLiftShare: 0.3,
  maxArcLiftM: 1500,
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
 * Точка перелёта: квадратичная Безье от a к b, контрольная точка — над
 * серединой отрезка на liftM. Посередине перелёта камера выше прямой на liftM/2.
 */
export function arcPoint(a: FilmPoint, b: FilmPoint, u: number, liftM: number): FilmPoint {
  if (u <= 0) return a;
  if (u >= 1) return b;
  const w0 = (1 - u) ** 2;
  const w1 = 2 * (1 - u) * u;
  const w2 = u * u;
  const mid = { lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2, alt: (a.alt + b.alt) / 2 + liftM };
  return {
    lat: w0 * a.lat + w1 * mid.lat + w2 * b.lat,
    lon: w0 * a.lon + w1 * mid.lon + w2 * b.lon,
    alt: w0 * a.alt + w1 * mid.alt + w2 * b.alt,
  };
}

/** Подъём перелёта по расстоянию между точками сцен, м. */
export const arcLiftM = (distanceM: number): number => Math.min(FILM.maxArcLiftM, distanceM * FILM.arcLiftShare);

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
 * как в просмотрщике. В перелёте — дуга Безье между стыками сцен, поза
 * плавно переходит, курс поворачивает кратчайшим путём; пружина курса
 * встаёт на курс следующей сцены, чтобы chase начался без рывка.
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
  const e = easeInOut(frame.u);
  const a = shot.out;
  const b = next.in;
  heading.current = { headingDeg: next.startDeg, rateDegS: 0 };
  return {
    at: arcPoint(a.at, b.at, e, arcLiftM(haversineDistance(a.at.lat, a.at.lon, b.at.lat, b.at.lon))),
    pose: {
      headingDeg: a.pose.headingDeg + shortestTurn(a.pose.headingDeg, b.pose.headingDeg) * e,
      pitchDeg: lerp(a.pose.pitchDeg, b.pose.pitchDeg, e),
      rangeM: lerp(a.pose.rangeM, b.pose.rangeM, e),
    },
  };
}
