import { describe, expect, it } from 'vitest';

import {
  calibrateAltitudes,
  flightRange,
  GROUND_CALIBRATION,
  settleOnGround,
  groundAnchor,
  groundIndices,
  groundOffset,
  offsetAt,
  type GroundAnchor,
} from './ground-calibration';

/**
 * Синтетический трек: stillStart с стоит на старте, потом летит на восток
 * 12 м/с (точки разбега не попадают ровно на границу радиуса 30 м), в конце stillEnd с стоит на посадке. Шаг 1 с. Широта 43° — метры
 * в градусы по сфере, как в самой функции.
 */
const LAT = 43;
const METRES_PER_DEG_LAT = 111_320;
const METRES_PER_DEG_LON = METRES_PER_DEG_LAT * Math.cos((LAT * Math.PI) / 180);

function track(stillStart: number, flying: number, stillEnd: number) {
  const n = stillStart + flying + stillEnd;
  const t = new Float64Array(n);
  const lat = new Float64Array(n).fill(LAT);
  const lon = new Float64Array(n);
  let x = 0;
  for (let i = 0; i < n; i++) {
    t[i] = i * 1000;
    if (i >= stillStart && i < stillStart + flying) x += 12;
    lon[i] = 77 + x / METRES_PER_DEG_LON;
  }
  return { t, lat, lon, n };
}

/** Путевая скорость по синтетическому треку: на земле 0, в полёте 12 м/с. */
const speeds = (stillStart: number, flying: number, stillEnd: number): Float64Array =>
  Float64Array.from({ length: stillStart + flying + stillEnd }, (_, i) =>
    i >= stillStart && i < stillStart + flying ? 12 : 0,
  );

describe('groundIndices — точки на земле у старта и посадки', () => {
  it('стоянка на старте: точки до взлёта, в радиусе от первой точки', () => {
    const { t, lat, lon } = track(20, 100, 15);
    const start = groundIndices(t, lat, lon, 'start');
    // 20 с стоянки + первые 2 с разбега (12 и 24 м) в радиусе 30 м; 36 м — уже нет.
    expect(start).toEqual(Array.from({ length: 22 }, (_, i) => i));
  });

  it('посадка: точки после приземления, в радиусе от последней точки', () => {
    const { t, lat, lon, n } = track(20, 100, 15);
    const end = groundIndices(t, lat, lon, 'end');
    expect(end.every((i) => i >= n - 18)).toBe(true);
    expect(end).toContain(n - 1);
  });

  it('только внутри окна по времени, даже если пилот долго стоит', () => {
    const { t, lat, lon } = track(300, 50, 10);
    expect(groundIndices(t, lat, lon, 'start').length).toBe(GROUND_CALIBRATION.windowS + 1);
  });
});

describe('groundOffset — поправка «рельеф − трек» по точкам на земле', () => {
  it('опора — верхние 10 %: подлёт над землёй не тянет поправку вниз', () => {
    // Реальная посадка: в радиус попали секунды подлёта на 10–15 м над землёй.
    // Медиана дала бы ~0 и половина точек на земле ушла бы под рельеф.
    const ground = Array.from({ length: 20 }, () => 1000);
    const onGround = Array.from({ length: 10 }, () => 995); // пилот стоит, трек на 5 м ниже рельефа
    const approach = Array.from({ length: 10 }, (_, i) => 1010 + i); // ещё летит
    const offset = groundOffset([...onGround, ...approach], ground);
    expect(offset).toBe(5 + GROUND_CALIBRATION.harnessHeightM);
  });

  it('одиночный выброс GPS вниз не задирает весь трек', () => {
    const ground = Array.from({ length: 20 }, () => 1000);
    const alt = [...Array.from({ length: 19 }, () => 995), 950]; // один фикс на 50 м ниже
    expect(groundOffset(alt, ground)).toBe(5 + GROUND_CALIBRATION.harnessHeightM);
  });

  it('мало точек на земле — поправки нет (запись началась в воздухе)', () => {
    const few = GROUND_CALIBRATION.minGroundFixes - 1;
    expect(groundOffset(new Array(few).fill(1000), new Array(few).fill(1010))).toBeNull();
  });

  it('поправка больше разумной — не доверяем, трек как есть', () => {
    const n = GROUND_CALIBRATION.minGroundFixes;
    const huge = GROUND_CALIBRATION.maxOffsetM + 1;
    expect(groundOffset(new Array(n).fill(1000), new Array(n).fill(1000 + huge))).toBeNull();
  });

  it('рельеф не пришёл (NaN) — такие точки не считаются', () => {
    const n = GROUND_CALIBRATION.minGroundFixes;
    const alt = new Array(n + 2).fill(1000);
    const ground = [...Array.from({ length: n }, () => 1005), Number.NaN, Number.NaN];
    expect(groundOffset(alt, ground)).toBe(5 + GROUND_CALIBRATION.harnessHeightM);
  });
});

describe('offsetAt — поправка вдоль полёта', () => {
  const start: GroundAnchor = { tMs: 0, offsetM: 8 };
  const end: GroundAnchor = { tMs: 10_000, offsetM: 4 };

  it('между стартом и посадкой — линейно по времени', () => {
    expect(offsetAt(0, start, end)).toBe(8);
    expect(offsetAt(5_000, start, end)).toBe(6);
    expect(offsetAt(10_000, start, end)).toBe(4);
  });

  it('до старта и после посадки — поправка ближайшего конца', () => {
    expect(offsetAt(-1_000, start, end)).toBe(8);
    expect(offsetAt(20_000, start, end)).toBe(4);
  });

  it('нет посадки — весь трек на стартовую поправку', () => {
    expect(offsetAt(7_000, start, null)).toBe(8);
  });

  it('нет старта — весь трек на посадочную', () => {
    expect(offsetAt(7_000, null, end)).toBe(4);
  });

  it('нет ни того, ни другого — ноль', () => {
    expect(offsetAt(7_000, null, null)).toBe(0);
  });
});

describe('calibrateAltitudes — трек для сцены', () => {
  it('сдвигает высоты по поправке, исходный массив не трогает', () => {
    const t = Float64Array.from([0, 5_000, 10_000]);
    const alt = Float64Array.from([1892, 2500, 1032]);
    const shown = calibrateAltitudes(t, alt, { tMs: 0, offsetM: 8 }, { tMs: 10_000, offsetM: 4 });
    expect(Array.from(shown)).toEqual([1900, 2506, 1036]);
    expect(Array.from(alt)).toEqual([1892, 2500, 1032]);
  });

  it('NaN остаётся NaN', () => {
    const shown = calibrateAltitudes(Float64Array.from([0]), Float64Array.from([Number.NaN]), { tMs: 0, offsetM: 8 }, null);
    expect(shown[0]).toBeNaN();
  });
});

describe('groundAnchor — момент, к которому привязана поправка', () => {
  const t = Float64Array.from([0, 1_000, 2_000, 3_000, 4_000, 5_000]);

  it('старт — последняя точка на земле (взлёт), посадка — первая (приземление)', () => {
    expect(groundAnchor(t, [0, 1, 2], 8, 'start')).toEqual({ tMs: 2_000, offsetM: 8 });
    expect(groundAnchor(t, [3, 4, 5], 4, 'end')).toEqual({ tMs: 3_000, offsetM: 4 });
  });

  it('поправки нет — привязки нет', () => {
    expect(groundAnchor(t, [0, 1, 2], null, 'start')).toBeNull();
  });
});

describe('flightRange — где полёт, а где ходьба по земле', () => {
  it('от взлёта (последняя точка на земле у старта) до посадки (первая у финиша)', () => {
    const { t, lat, lon, n } = track(20, 100, 15);
    const range = flightRange(t, lat, lon, speeds(20, 100, 15));
    expect(range.takeoff).toBe(21); // 20 с стоянки + 12 и 24 м разбега
    expect(range.landing).toBeGreaterThanOrEqual(n - 18);
    expect(range.landing).toBeLessThan(n);
  });

  it('запись началась в воздухе — полёт с первой точки', () => {
    const { t, lat, lon, n } = track(0, 100, 15);
    expect(flightRange(t, lat, lon, speeds(0, 100, 15)).takeoff).toBe(0);
    expect(n).toBeGreaterThan(0);
  });

  it('кружит в термике у первой точки — это не земля: слишком быстро', () => {
    // 60 с по кругу радиусом 20 м со скоростью 8 м/с — все точки в радиусе 30 м.
    const n = 120;
    const t = Float64Array.from({ length: n }, (_, i) => i * 1000);
    const lat = Float64Array.from({ length: n }, (_, i) => LAT + (20 * Math.sin((i * 8) / 20)) / METRES_PER_DEG_LAT);
    const lon = Float64Array.from({ length: n }, (_, i) => 77 + (20 * (1 - Math.cos((i * 8) / 20))) / METRES_PER_DEG_LON);
    const gSpeed = new Float64Array(n).fill(8);
    expect(flightRange(t, lat, lon, gSpeed)).toEqual({ takeoff: 0, landing: n - 1 });
  });

  it('запись оборвалась в воздухе — полёт до последней точки', () => {
    const { t, lat, lon, n } = track(20, 100, 0);
    expect(flightRange(t, lat, lon, speeds(20, 100, 0)).landing).toBe(n - 1);
  });
});

describe('settleOnGround — ходьба на рельефе, переход к полёту без ступеньки', () => {
  const H = GROUND_CALIBRATION.harnessHeightM;
  const T = GROUND_CALIBRATION.transitionS;
  const n = 2 * T + 21;
  // Шаг 1 с. Взлёт на точке 5, посадка на n − 6. Рельеф ровный 1000 м,
  // полёт по данным — 1020 м: на стыке была бы ступенька 19 м.
  const t = Float64Array.from({ length: n }, (_, i) => i * 1000);
  const range = { takeoff: 5, landing: n - 6 };
  const terrain = new Float64Array(n).fill(1000);
  const flight = new Float64Array(n).fill(1020);
  const shown = settleOnGround(t, flight, terrain, range);

  it('ходьба до взлёта и после посадки — рельеф + подвеска', () => {
    expect(shown[0]).toBe(1000 + H);
    expect(shown[range.takeoff]).toBe(1000 + H);
    expect(shown[range.landing]).toBe(1000 + H);
    expect(shown[n - 1]).toBe(1000 + H);
  });

  it('первые секунды после взлёта — плавный уход от земли, без ступеньки', () => {
    const steps = Array.from({ length: T }, (_, k) => (shown[range.takeoff + k + 1] ?? 0) - (shown[range.takeoff + k] ?? 0));
    const maxStep = Math.max(...steps.map(Math.abs));
    expect(maxStep).toBeLessThan(19 / 2); // ступенька размазана, а не за одну секунду
  });

  it('через transitionS после взлёта и до посадки — высота полёта как есть', () => {
    expect(shown[range.takeoff + T]).toBe(1020);
    expect(shown[range.landing - T]).toBe(1020);
  });

  it('рельеф для точки не пришёл — высота полёта', () => {
    const noTerrain = new Float64Array(n).fill(Number.NaN);
    expect(settleOnGround(t, flight, noTerrain, range)[0]).toBe(1020);
    expect(settleOnGround(t, flight, noTerrain, range)[range.takeoff + 2]).toBe(1020);
  });

  it('исходный массив не меняется', () => {
    expect(Array.from(flight).every((v) => v === 1020)).toBe(true);
  });
});
