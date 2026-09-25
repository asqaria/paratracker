import { describe, expect, it } from 'vitest';

import {
  CAMERA_LIMITS,
  FREE_CAMERA,
  FREE_ORBIT_PITCH,
  hprFromOffset,
  initialAdjust,
  offsetFromHpr,
  orbitAroundPilot,
  ORBIT_DEG_PER_PX,
  orbitBy,
  poseFor,
  WHEEL_NOTCH,
  wheelZoomInPx,
  ZOOM_STEP_PER_NOTCH,
  zoomBy,
} from './camera-input';
import { CAMERA_POSES } from './camera-modes';

describe('пределы следящих режимов', () => {
  it('Chase — 5–200 м, как в ТЗ §7.4', () => {
    expect(CAMERA_LIMITS.chase).toMatchObject({ minRangeM: 5, maxRangeM: 200 });
  });

  it('стартовая поза каждого режима — внутри его пределов', () => {
    for (const mode of ['chase', 'cockpit', 'top'] as const) {
      const pose = CAMERA_POSES[mode];
      const limits = CAMERA_LIMITS[mode];
      expect(pose?.rangeM).toBeGreaterThanOrEqual(limits.minRangeM);
      expect(pose?.rangeM).toBeLessThanOrEqual(limits.maxRangeM);
      expect(pose?.pitchDeg).toBeGreaterThanOrEqual(limits.minPitchDeg);
      expect(pose?.pitchDeg).toBeLessThanOrEqual(limits.maxPitchDeg);
    }
  });
});

describe('initialAdjust', () => {
  it('без поправок: дистанция и наклон режима, курс без смещения', () => {
    expect(initialAdjust('chase')).toEqual({ rangeM: 90, pitchDeg: -14, headingOffsetDeg: 0 });
  });
});

describe('zoomBy — колесо меняет дистанцию до пилота плавно', () => {
  const start = initialAdjust('chase');

  it('один щелчок вверх — ближе на шаг, вниз — дальше на шаг', () => {
    expect(zoomBy(start, 'chase', WHEEL_NOTCH).rangeM).toBeCloseTo(90 / (1 + ZOOM_STEP_PER_NOTCH), 9);
    expect(zoomBy(start, 'chase', -WHEEL_NOTCH).rangeM).toBeCloseTo(90 * (1 + ZOOM_STEP_PER_NOTCH), 9);
  });

  it('шаг мягкий: щелчок меняет дистанцию не больше чем на 20 %', () => {
    expect(ZOOM_STEP_PER_NOTCH).toBeGreaterThan(0);
    expect(ZOOM_STEP_PER_NOTCH).toBeLessThanOrEqual(0.2);
  });

  it('тачпад: много мелких дельт = один щелчок, без рывков', () => {
    let adjust = start;
    for (let i = 0; i < 12; i++) adjust = zoomBy(adjust, 'chase', WHEEL_NOTCH / 12);
    expect(adjust.rangeM).toBeCloseTo(zoomBy(start, 'chase', WHEEL_NOTCH).rangeM, 9);
  });

  it('упирается в пределы режима', () => {
    expect(zoomBy(start, 'chase', 100 * WHEEL_NOTCH).rangeM).toBe(5);
    expect(zoomBy(start, 'chase', -100 * WHEEL_NOTCH).rangeM).toBe(200);
  });

  it('остальное не трогает', () => {
    const orbited = orbitBy(start, 'chase', 40, 10);
    expect(zoomBy(orbited, 'chase', WHEEL_NOTCH)).toMatchObject({
      headingOffsetDeg: orbited.headingOffsetDeg,
      pitchDeg: orbited.pitchDeg,
    });
  });
});

describe('orbitBy — перетаскивание поворачивает камеру вокруг пилота', () => {
  const start = initialAdjust('chase');

  it('по горизонтали — смещение курса, по вертикали — наклон', () => {
    const moved = orbitBy(start, 'chase', 100, -20);
    expect(moved.headingOffsetDeg).toBeCloseTo(100 * ORBIT_DEG_PER_PX, 9);
    expect(moved.pitchDeg).toBeCloseTo(-14 + 20 * ORBIT_DEG_PER_PX, 9);
  });

  it('чувствительность умеренная: полоборота — не меньше 500 px', () => {
    expect(180 / ORBIT_DEG_PER_PX).toBeGreaterThanOrEqual(500);
  });

  it('наклон ограничен: камера не уходит под пилота и не встаёт в зенит', () => {
    expect(orbitBy(start, 'chase', 0, 10_000).pitchDeg).toBe(CAMERA_LIMITS.chase.minPitchDeg);
    expect(orbitBy(start, 'chase', 0, -10_000).pitchDeg).toBe(CAMERA_LIMITS.chase.maxPitchDeg);
  });

  it('Top — «без вращения» (ТЗ §7.4): перетаскивание ничего не меняет', () => {
    const top = initialAdjust('top');
    expect(orbitBy(top, 'top', 300, 200)).toEqual(top);
  });
});

describe('poseFor — поза кадра с поправками пилота', () => {
  it('курс полёта + смещение, наклон и дистанция из поправок', () => {
    const adjust = { rangeM: 40, pitchDeg: -30, headingOffsetDeg: 25 };
    expect(poseFor('chase', adjust, 100)).toEqual({ headingDeg: 125, pitchDeg: -30, rangeM: 40 });
  });

  it('Top — курс режима (север), а не полёта', () => {
    expect(poseFor('top', initialAdjust('top'), 100).headingDeg).toBe(0);
  });
});

describe('FREE_CAMERA — штатное управление Cesium, но мягче', () => {
  it('шаг колеса и инерция ниже умолчаний Cesium', () => {
    // Умолчания Cesium: zoomFactor 5, inertiaZoom 0.8, inertiaSpin 0.9, inertiaTranslate 0.9.
    expect(FREE_CAMERA.zoomFactor).toBeLessThan(5);
    expect(FREE_CAMERA.inertiaZoom).toBeLessThan(0.8);
    expect(FREE_CAMERA.inertiaSpin).toBeLessThan(0.9);
    expect(FREE_CAMERA.inertiaTranslate).toBeLessThan(0.9);
  });

  it('камера не проваливается под рельеф', () => {
    expect(FREE_CAMERA.minimumZoomDistanceM).toBeGreaterThanOrEqual(5);
  });
});

describe('wheelZoomInPx — WheelEvent в пиксели «к себе / от себя»', () => {
  it('пиксели: колесо от себя (deltaY < 0) — приближение', () => {
    expect(wheelZoomInPx({ deltaY: -100, deltaMode: 0 })).toBe(100);
    expect(wheelZoomInPx({ deltaY: 100, deltaMode: 0 })).toBe(-100);
  });

  it('строки (Firefox, 3 строки на щелчок) — тот же щелчок', () => {
    expect(wheelZoomInPx({ deltaY: -3, deltaMode: 1 })).toBeCloseTo(WHEEL_NOTCH, 9);
  });

  it('страницы — щелчок на страницу', () => {
    expect(wheelZoomInPx({ deltaY: 1, deltaMode: 2 })).toBe(-WHEEL_NOTCH);
  });
});

describe('hprFromOffset — где камера относительно пилота (локальные ENU-метры)', () => {
  it('камера в 100 м южнее на той же высоте — смотрит на север, горизонтально', () => {
    const hpr = hprFromOffset({ east: 0, north: -100, up: 0 });
    expect(hpr.headingDeg).toBeCloseTo(0, 9);
    expect(hpr.pitchDeg).toBeCloseTo(0, 9);
    expect(hpr.rangeM).toBeCloseTo(100, 9);
  });

  it('камера западнее и выше — смотрит на восток и вниз', () => {
    const hpr = hprFromOffset({ east: -100, north: 0, up: 100 });
    expect(hpr.headingDeg).toBeCloseTo(90, 9);
    expect(hpr.pitchDeg).toBeCloseTo(-45, 9);
    expect(hpr.rangeM).toBeCloseTo(Math.SQRT2 * 100, 9);
  });

  it('прямо над пилотом — вниз, −90°', () => {
    expect(hprFromOffset({ east: 0, north: 0, up: 250 }).pitchDeg).toBeCloseTo(-90, 9);
  });

  it('обратно к смещению — то же, что HeadingPitchRange в Cesium', () => {
    const offset = { east: 37, north: -120, up: 64 };
    const back = offsetFromHpr(hprFromOffset(offset));
    expect(back.east).toBeCloseTo(offset.east, 9);
    expect(back.north).toBeCloseTo(offset.north, 9);
    expect(back.up).toBeCloseTo(offset.up, 9);
  });
});

describe('orbitAroundPilot — Ctrl + перетаскивание в Free', () => {
  const hpr = { headingDeg: 30, pitchDeg: -20, rangeM: 800 };

  it('курс и наклон — с той же чувствительностью, что в Chase; дистанция не меняется', () => {
    const moved = orbitAroundPilot(hpr, 40, -8);
    expect(moved.headingDeg).toBeCloseTo(30 + 40 * ORBIT_DEG_PER_PX, 9);
    expect(moved.pitchDeg).toBeCloseTo(-20 + 8 * ORBIT_DEG_PER_PX, 9);
    expect(moved.rangeM).toBe(800);
  });

  it('наклон ограничен: не под пилота и не строго в надир (там курс вырождается)', () => {
    expect(orbitAroundPilot(hpr, 0, -10_000).pitchDeg).toBe(FREE_ORBIT_PITCH.maxDeg);
    expect(orbitAroundPilot(hpr, 0, 10_000).pitchDeg).toBe(FREE_ORBIT_PITCH.minDeg);
    expect(FREE_ORBIT_PITCH.minDeg).toBeGreaterThan(-90);
  });
});
