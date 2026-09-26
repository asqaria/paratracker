import { initialBearing } from '@skyline/analysis';
import { describe, expect, it } from 'vitest';

import { COURSE_WINDOW_S, travelCourse, type CourseTrack } from './camera-course';
import { shortestTurn } from './camera-modes';

/**
 * Курс для камеры — направление перемещения за окно, а не мгновенный курс
 * между фиксами. Треки синтетические, с известной геометрией: так видно,
 * что именно гасится (круги термика), а что остаётся (снос, глайд).
 */

const START_MS = Date.UTC(2026, 6, 15, 10);
const LAT0 = 43.2;
const LON0 = 76.9;
const M_PER_DEG_LAT = 111_320;
const mPerDegLon = M_PER_DEG_LAT * Math.cos((LAT0 * Math.PI) / 180);

/** Трек с шагом 1 с по функции смещения в метрах (восток, север) от времени. */
function trackOf(seconds: number, offset: (s: number) => { east: number; north: number }): CourseTrack {
  const t = new Float64Array(seconds + 1);
  const lat = new Float64Array(seconds + 1);
  const lon = new Float64Array(seconds + 1);
  for (let s = 0; s <= seconds; s++) {
    const { east, north } = offset(s);
    t[s] = START_MS + s * 1000;
    lat[s] = LAT0 + north / M_PER_DEG_LAT;
    lon[s] = LON0 + east / mPerDegLon;
  }
  return { t, lat, lon };
}

const at = (s: number): number => START_MS + s * 1000;

describe('travelCourse — куда пилот в целом летит', () => {
  it('прямой глайд на север — 0°, на восток — 90°', () => {
    const north = trackOf(120, (s) => ({ east: 0, north: 10 * s }));
    const east = trackOf(120, (s) => ({ east: 10 * s, north: 0 }));
    expect(shortestTurn(0, travelCourse(north, at(90)))).toBeCloseTo(0, 3);
    expect(shortestTurn(90, travelCourse(east, at(90)))).toBeCloseTo(0, 3);
  });

  it('в термике со сносом курс держит направление сноса, пока пилот крутит круги', () => {
    // Круг радиусом 40 м за 22 с (типичный вираж параплана), снос ветром 3 м/с на восток.
    const radiusM = 40;
    const periodS = 22;
    const driftMs = 3;
    const thermal = trackOf(300, (s) => {
      const angle = (2 * Math.PI * s) / periodS;
      return { east: driftMs * s + radiusM * Math.sin(angle), north: radiusM * Math.cos(angle) };
    });

    const courses: number[] = [];
    const instantaneous: number[] = [];
    // С двух окон от старта — установившийся режим: оба окна целиком в термике.
    for (let s = 2 * COURSE_WINDOW_S; s < 300; s++) {
      courses.push(travelCourse(thermal, at(s)));
      instantaneous.push(
        initialBearing(thermal.lat[s - 1] ?? 0, thermal.lon[s - 1] ?? 0, thermal.lat[s] ?? 0, thermal.lon[s] ?? 0),
      );
    }

    // Мгновенный курс обходит весь круг — за ним камера и крутилась.
    expect(Math.max(...instantaneous) - Math.min(...instantaneous)).toBeGreaterThan(300);
    // Курс для камеры не уходит от сноса дальше чем на 20°.
    const worst = Math.max(...courses.map((course) => Math.abs(shortestTurn(90, course))));
    expect(worst).toBeLessThan(20);
  });

  it('стоит на месте или крутит круги без сноса — курса нет (NaN), камера держит прежний', () => {
    const standing = trackOf(120, () => ({ east: 0, north: 0 }));
    expect(travelCourse(standing, at(60))).toBeNaN();

    const circling = trackOf(120, (s) => {
      const angle = (2 * Math.PI * s) / COURSE_WINDOW_S;
      return { east: 40 * Math.sin(angle), north: 40 * Math.cos(angle) };
    });
    expect(travelCourse(circling, at(90))).toBeNaN();
  });

  it('в начале трека окно обрезается по первой точке', () => {
    const east = trackOf(120, (s) => ({ east: 10 * s, north: 0 }));
    expect(shortestTurn(90, travelCourse(east, at(5)))).toBeCloseTo(0, 3);
  });

  it('между фиксами меняется плавно, без ступенек раз в секунду', () => {
    // Плавный разворот с севера на восток за 60 с.
    const turn = trackOf(200, (s) => {
      const angle = (Math.PI / 2) * Math.min(1, Math.max(0, (s - 60) / 60));
      return { east: 10 * s * Math.sin(angle), north: 10 * s * Math.cos(angle) };
    });
    const steps: number[] = [];
    for (let ms = at(80); ms < at(90); ms += 100) {
      steps.push(Math.abs(shortestTurn(travelCourse(turn, ms), travelCourse(turn, ms + 100))));
    }
    // За 0,1 с курс меняется на доли градуса, а не рывком на следующем фиксе.
    expect(Math.max(...steps)).toBeLessThan(1);
  });

  it('пустой трек и время вне трека — не падает', () => {
    expect(travelCourse({ t: new Float64Array(), lat: new Float64Array(), lon: new Float64Array() }, at(0))).toBeNaN();
    const east = trackOf(120, (s) => ({ east: 10 * s, north: 0 }));
    expect(shortestTurn(90, travelCourse(east, at(500)))).toBeCloseTo(0, 3);
  });
});
