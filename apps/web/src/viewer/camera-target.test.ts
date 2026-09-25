import { describe, expect, it } from 'vitest';

import {
  CAMERA_TARGET_MIN_HALF_WIDTH_S,
  CAMERA_TARGET_SCREEN_HALF_WIDTH_S,
  cameraTarget,
  easeHalfWidth,
  HALF_WIDTH_EASE_TAU_S,
  targetHalfWidthS,
  trackVelocity,
  type TargetTrack,
} from './camera-target';

/**
 * Точка, на которую смотрит следящая камера: сглаженная траектория пилота.
 * Камера жёстко привязана к точке — любой рывок точки (стык интерполяции на
 * фиксе, шум GPS) дёргает весь кадр. Треки синтетические, в метрах.
 */

const START_MS = Date.UTC(2026, 6, 15, 10);
const LAT0 = 43.2;
const LON0 = 76.9;
const M_PER_DEG_LAT = 111_320;
const mPerDegLon = M_PER_DEG_LAT * Math.cos((LAT0 * Math.PI) / 180);

function trackOf(
  seconds: number,
  offset: (s: number) => { east: number; north: number; up: number },
  stepS = 1,
): TargetTrack {
  const n = Math.floor(seconds / stepS) + 1;
  const track = { t: new Float64Array(n), lat: new Float64Array(n), lon: new Float64Array(n), alt: new Float64Array(n) };
  for (let i = 0; i < n; i++) {
    const { east, north, up } = offset(i * stepS);
    track.t[i] = START_MS + i * stepS * 1000;
    track.lat[i] = LAT0 + north / M_PER_DEG_LAT;
    track.lon[i] = LON0 + east / mPerDegLon;
    track.alt[i] = 1000 + up;
  }
  return track;
}

/** Точка камеры в метрах (восток, север, верх) от начала координат трека. */
function metres(track: TargetTrack, ms: number, halfWidthS: number): { east: number; north: number; up: number } {
  const p = cameraTarget(track, ms, halfWidthS);
  return { east: (p.lon - LON0) * mPerDegLon, north: (p.lat - LAT0) * M_PER_DEG_LAT, up: p.alt - 1000 };
}

const at = (s: number): number => START_MS + s * 1000;

describe('cameraTarget — сглаженная траектория для камеры', () => {
  it('прямой полёт с постоянной скоростью не искажается', () => {
    const glide = trackOf(120, (s) => ({ east: 10 * s, north: 3 * s, up: -1.2 * s }));
    for (const s of [30, 30.25, 30.5, 61.7]) {
      const p = metres(glide, at(s), 4);
      expect(p.east).toBeCloseTo(10 * s, 6);
      expect(p.north).toBeCloseTo(3 * s, 6);
      expect(p.up).toBeCloseTo(-1.2 * s, 6);
    }
  });

  it('шум GPS гасится: боковая пила ±3 м даёт меньше полуметра', () => {
    const noisy = trackOf(120, (s) => ({ east: 10 * s, north: s % 2 === 0 ? 3 : -3, up: s % 2 === 0 ? 2 : -2 }));
    for (let s = 20; s < 100; s += 0.1) {
      const p = metres(noisy, at(s), 4);
      expect(Math.abs(p.north)).toBeLessThan(0.5);
      expect(Math.abs(p.up)).toBeLessThan(0.5);
    }
  });

  it('без рывков на фиксах: ускорение точки камеры не скачет на стыках', () => {
    // Зигзаг: курс меняется на каждом фиксе — худший случай для стыков интерполяции.
    const zigzag = trackOf(120, (s) => ({ east: 10 * s, north: 4 * Math.sin(s * 1.3), up: 0 }));
    const stepMs = 1000 / 60;
    const acc: number[] = [];
    for (let ms = at(30); ms < at(40); ms += stepMs) {
      const [a, b, c] = [metres(zigzag, ms, 4), metres(zigzag, ms + stepMs, 4), metres(zigzag, ms + 2 * stepMs, 4)];
      acc.push(Math.abs(a.north - 2 * b.north + c.north) / (stepMs / 1000) ** 2);
    }
    // Соседние кадры: ускорение меняется плавно, а не прыжком на фиксе.
    const jumps = acc.slice(1).map((value, i) => Math.abs(value - (acc[i] ?? value)));
    expect(Math.max(...jumps)).toBeLessThan(0.05);
  });

  it('широкое окно (×60) усредняет круги термика — камера идёт за сносом', () => {
    const radiusM = 40;
    const thermal = trackOf(400, (s) => {
      const angle = (2 * Math.PI * s) / 22;
      return { east: 3 * s + radiusM * Math.sin(angle), north: radiusM * Math.cos(angle), up: 2 * s };
    });
    const halfWidth = targetHalfWidthS(60);
    for (let s = 100; s < 300; s += 3.7) {
      const p = metres(thermal, at(s), halfWidth);
      expect(Math.hypot(p.east - 3 * s, p.north)).toBeLessThan(0.25 * radiusM);
      expect(p.up).toBeCloseTo(2 * s, 0);
    }
  });

  it('края трека и разрывы — конечные координаты, без NaN', () => {
    const sparse = trackOf(600, (s) => ({ east: 10 * s, north: 0, up: 0 }), 60);
    for (const ms of [at(-100), at(0), at(30), at(590), at(900)]) {
      const p = cameraTarget(sparse, ms, 4);
      expect([p.lat, p.lon, p.alt].every(Number.isFinite)).toBe(true);
    }
    // Внутри разрыва больше окна — линейно между соседними фиксами.
    expect(metres(sparse, at(30), 4).east).toBeCloseTo(300, 6);
  });
});

describe('targetHalfWidthS — окно сглаживания в секундах полёта', () => {
  it('пропорционально скорости: одна и та же доля секунды экрана', () => {
    expect(targetHalfWidthS(16)).toBeCloseTo(16 * CAMERA_TARGET_SCREEN_HALF_WIDTH_S, 9);
    expect(targetHalfWidthS(60)).toBeCloseTo(60 * CAMERA_TARGET_SCREEN_HALF_WIDTH_S, 9);
  });

  it('на малых скоростях — не уже минимума: иначе в окно не попадёт ни одного фикса', () => {
    expect(targetHalfWidthS(1)).toBe(CAMERA_TARGET_MIN_HALF_WIDTH_S);
  });
});

describe('easeHalfWidth — смена скорости не дёргает камеру', () => {
  it('окно подтягивается к новому за экранное время, а не прыжком', () => {
    const from = targetHalfWidthS(4);
    const to = targetHalfWidthS(60);
    const oneFrame = easeHalfWidth(from, to, 1 / 60);
    expect(oneFrame).toBeGreaterThan(from);
    expect(oneFrame - from).toBeLessThan((to - from) * 0.05);
    let width = from;
    for (let frame = 0; frame < 60 * 4 * HALF_WIDTH_EASE_TAU_S; frame++) width = easeHalfWidth(width, to, 1 / 60);
    expect(width).toBeCloseTo(to, 0);
  });

  it('первый кадр — сразу нужное окно', () => {
    expect(easeHalfWidth(null, 8, 0)).toBe(8);
  });
});

describe('trackVelocity — скорость по сглаженной траектории', () => {
  it('прямой полёт: скорость по осям точно', () => {
    const glide = trackOf(120, (s) => ({ east: 10 * s, north: 3 * s, up: -1.2 * s }));
    const v = trackVelocity(glide, at(40.3), 3);
    // Трек здесь переводится в градусы по 111 320 м/°, код — по сфере 6371 км:
    // разница моделей Земли ~0,1 %, поэтому допуск относительный.
    expect(Math.abs((v?.eastMs ?? 0) / 10 - 1)).toBeLessThan(0.002);
    expect(Math.abs((v?.northMs ?? 0) / 3 - 1)).toBeLessThan(0.002);
    expect(v?.upMs).toBeCloseTo(-1.2, 6);
  });

  it('шум GPS ±3 м почти не влияет на боковую скорость', () => {
    const noisy = trackOf(120, (s) => ({ east: 10 * s, north: s % 2 === 0 ? 3 : -3, up: 0 }));
    for (let s = 20; s < 100; s += 0.37) {
      expect(Math.abs(trackVelocity(noisy, at(s), 3)?.northMs ?? Number.NaN)).toBeLessThan(1.5);
    }
  });

  it('пустой трек — null', () => {
    const empty = { t: new Float64Array(), lat: new Float64Array(), lon: new Float64Array(), alt: new Float64Array() };
    expect(trackVelocity(empty, at(0), 3)).toBeNull();
  });
});
