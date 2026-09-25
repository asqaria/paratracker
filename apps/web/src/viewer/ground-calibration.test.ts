import { describe, expect, it } from 'vitest';

import {
  calibrateAltitudes,
  fillTerrain,
  flightRange,
  GROUND_CALIBRATION,
  groundAnchor,
  groundOffset,
  groundWindow,
  offsetAt,
  settleOnGround,
  terrainSampleIndices,
  type GroundAnchor,
} from './ground-calibration';

/** Шаг 1 с: t в мс по номеру точки. */
const times = (n: number): Float64Array => Float64Array.from({ length: n }, (_, i) => i * 1000);

/**
 * Путевая скорость синтетического трека по участкам: [секунд, м/с]. Ходьба в гору
 * — 1.3 м/с (замер на реальном подъёме пешком), полёт — 10 м/с, разбег — 4.5 м/с.
 */
function speeds(...parts: Array<[seconds: number, speedMs: number]>): Float64Array {
  return Float64Array.from(parts.flatMap(([seconds, speed]) => Array.from({ length: seconds }, () => speed)));
}

describe('flightRange — взлёт и посадка по скорости', () => {
  it('подъём пешком полтора часа — не полёт: взлёт после него', () => {
    const speed = speeds([5400, 1.3], [3, 4.5], [600, 10], [120, 0]);
    const range = flightRange(times(speed.length), speed);
    expect(range.takeoff).toBeGreaterThanOrEqual(5400);
    expect(range.takeoff).toBeLessThanOrEqual(5403);
  });

  it('короткий разбег не взлёт — взлёт, когда скорость держится', () => {
    // Два разбега по 5 с с остановкой, потом настоящий взлёт.
    const speed = speeds([60, 0], [5, 5], [20, 0], [5, 5], [20, 0], [600, 10]);
    expect(flightRange(times(speed.length), speed).takeoff).toBeGreaterThanOrEqual(110);
  });

  it('запись началась в воздухе — взлёт на первой точке', () => {
    const speed = speeds([600, 10], [60, 0]);
    expect(flightRange(times(speed.length), speed).takeoff).toBe(0);
  });

  it('после посадки пилот 30 минут идёт к дороге — это не полёт', () => {
    const speed = speeds([60, 0], [600, 10], [1800, 1.3]);
    const range = flightRange(times(speed.length), speed);
    expect(range.landing).toBeGreaterThanOrEqual(659);
    expect(range.landing).toBeLessThanOrEqual(661);
  });

  it('запись оборвалась в воздухе — посадка на последней точке', () => {
    const speed = speeds([60, 0], [600, 10]);
    expect(flightRange(times(speed.length), speed).landing).toBe(speed.length - 1);
  });

  it('полёта нет вовсе (запись на земле) — весь трек земля', () => {
    const speed = speeds([200, 1]);
    const range = flightRange(times(speed.length), speed);
    expect(range.takeoff).toBeGreaterThanOrEqual(range.landing);
  });
});

describe('groundWindow — где пилот стоит на старте и на посадке', () => {
  it('минута перед взлётом и минута после посадки, по времени', () => {
    const t = times(1000);
    const range = { takeoff: 300, landing: 800 };
    const start = groundWindow(t, range, 'start');
    const end = groundWindow(t, range, 'end');
    expect(start[0]).toBe(300 - GROUND_CALIBRATION.groundWindowS);
    expect(start.at(-1)).toBe(300);
    expect(end[0]).toBe(800);
    expect(end.at(-1)).toBe(800 + GROUND_CALIBRATION.groundWindowS);
  });

  it('у края записи — сколько есть', () => {
    const t = times(100);
    expect(groundWindow(t, { takeoff: 10, landing: 95 }, 'start')).toEqual(Array.from({ length: 11 }, (_, i) => i));
    expect(groundWindow(t, { takeoff: 10, landing: 95 }, 'end')).toEqual([95, 96, 97, 98, 99]);
  });

  it('взлёт на первой точке — у старта земли нет', () => {
    expect(groundWindow(times(100), { takeoff: 0, landing: 99 }, 'start')).toEqual([0]);
  });
});

describe('terrainSampleIndices — где спрашивать рельеф', () => {
  const t = times(4000);
  const range = { takeoff: 3000, landing: 3500 };
  const { exact, sparse } = terrainSampleIndices(t, range);

  it('у стыков — каждая точка: окна поправок и плавного перехода', () => {
    for (const i of [3000 - GROUND_CALIBRATION.groundWindowS, 2999, 3000, 3001, 3000 + GROUND_CALIBRATION.transitionS, 3500, 3520]) {
      expect(exact).toContain(i);
    }
  });

  it('длинная ходьба — не чаще раза в terrainSampleStepS, но с первой точкой', () => {
    expect(sparse[0]).toBe(0);
    const steps = sparse.slice(1).map((i, k) => i - (sparse[k] ?? 0));
    expect(Math.min(...steps)).toBeGreaterThanOrEqual(GROUND_CALIBRATION.terrainSampleStepS);
    // 3000 с ходьбы до взлёта — около трёхсот точек, а не три тысячи.
    expect(sparse.filter((i) => i < 3000).length).toBeLessThan(3000 / GROUND_CALIBRATION.terrainSampleStepS + 2);
  });

  it('внутри полёта рельеф не нужен', () => {
    const middle = (3000 + 3500) / 2;
    expect([...exact, ...sparse].some((i) => i === middle)).toBe(false);
  });
});

describe('fillTerrain — рельеф между редкими точками ходьбы', () => {
  it('линейно по времени между соседними известными', () => {
    const t = times(21);
    const terrain = new Float64Array(21).fill(Number.NaN);
    terrain[0] = 1000;
    terrain[10] = 1100;
    terrain[20] = 1300;
    const filled = fillTerrain(t, terrain, { takeoff: 20, landing: 20 });
    expect(filled[5]).toBeCloseTo(1050, 9);
    expect(filled[15]).toBeCloseTo(1200, 9);
  });

  it('через полёт не тянет: внутри полёта остаётся NaN', () => {
    const t = times(100);
    const terrain = new Float64Array(100).fill(Number.NaN);
    terrain[0] = 1000;
    terrain[99] = 500;
    const filled = fillTerrain(t, terrain, { takeoff: 10, landing: 90 });
    expect(filled[50]).toBeNaN();
    expect(filled[5]).toBe(1000); // до взлёта — ближайшая известная
    expect(filled[95]).toBe(500);
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
