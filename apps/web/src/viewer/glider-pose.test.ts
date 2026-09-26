import { describe, expect, it } from 'vitest';

import { gliderPose, lyingAngleDeg, lyingRollDeg, nodeTransforms, POSE, type GliderPose } from './glider-pose';

/**
 * Позы пилота и крыла по времени (задача «анимация на земле»): до взлёта —
 * идёт с рюкзаком или стоит у разложенного крыла, разбег с подъёмом крыла,
 * полёт, посадка с опаданием купола, после — стоит или уходит с рюкзаком.
 */

const START_MS = Date.UTC(2026, 6, 15, 10);
/** Трек на 1 Гц: 100 с на земле, 600 с полёта, 100 с на земле. */
const T = 800;
const TAKEOFF = 100;
const LANDING = 700;
const range = { takeoff: TAKEOFF, landing: LANDING };
const t = Float64Array.from({ length: T }, (_, i) => START_MS + i * 1000);
const at = (index: number, extraMs = 0): number => START_MS + index * 1000 + extraMs;
const speeds = (ground: number): Float64Array =>
  Float64Array.from({ length: T }, (_, i) => (i >= TAKEOFF && i <= LANDING ? 10 : ground));

describe('gliderPose', () => {
  it('в воздухе — полёт: пилот в коконе, крыло над головой', () => {
    expect(gliderPose({ t, gSpeed: speeds(0) }, range, at(400))).toMatchObject({ pilot: 'flying', wing: 'flying' });
  });

  it('до разбега идёт — рюкзак; стоит — крыло разложено позади', () => {
    expect(gliderPose({ t, gSpeed: speeds(1.3) }, range, at(40))).toMatchObject({ pilot: 'walking', wing: 'packed' });
    expect(gliderPose({ t, gSpeed: speeds(0) }, range, at(40))).toMatchObject({ pilot: 'standing', wing: 'lying' });
  });

  it('последние секунды до взлёта — разбег, крыло поднимается с земли над головой', () => {
    const half = gliderPose({ t, gSpeed: speeds(0) }, range, at(TAKEOFF) - (POSE.inflationS * 1000) / 2);
    expect(half).toMatchObject({ pilot: 'running', wing: 'rising' });
    expect(half.wingProgress).toBeCloseTo(0.5, 9);
  });

  it('первые секунды после посадки — стоит, купол опадает; потом — уходит с рюкзаком или стоит у крыла', () => {
    const landed = gliderPose({ t, gSpeed: speeds(0) }, range, at(LANDING) + (POSE.collapseS * 1000) / 3);
    expect(landed).toMatchObject({ pilot: 'standing', wing: 'falling' });
    expect(landed.wingProgress).toBeCloseTo(2 / 3, 9);
    expect(gliderPose({ t, gSpeed: speeds(1.3) }, range, at(760))).toMatchObject({ pilot: 'walking', wing: 'packed' });
    expect(gliderPose({ t, gSpeed: speeds(0) }, range, at(760))).toMatchObject({ pilot: 'standing', wing: 'lying' });
  });

  it('скорость сглажена: одиночный скачок GPS у стоящего пилота — не шаг', () => {
    const jitter = speeds(0);
    jitter[40] = 2;
    expect(gliderPose({ t, gSpeed: jitter }, range, at(40)).pilot).toBe('standing');
  });
});

describe('nodeTransforms', () => {
  const pose = (overrides: Partial<GliderPose>): GliderPose => ({
    pilot: 'flying',
    wing: 'flying',
    wingProgress: 1,
    gaitPhase: 0,
    ...overrides,
  });
  const visible = (scale: readonly number[]): boolean => scale.every((k) => k > 0);

  it('в полёте — кокон; на земле — стоя с ногами; кокон и ноги не показаны вместе', () => {
    const flying = nodeTransforms(pose({}));
    expect(visible(flying['pilot-seated'].scale)).toBe(true);
    expect(visible(flying['pilot-standing'].scale)).toBe(false);
    expect(visible(flying['leg-left'].scale)).toBe(false);
    const ground = nodeTransforms(pose({ pilot: 'standing', wing: 'lying', wingProgress: 0 }));
    expect(visible(ground['pilot-seated'].scale)).toBe(false);
    expect(visible(ground['pilot-standing'].scale)).toBe(true);
    expect(visible(ground['leg-right'].scale)).toBe(true);
  });

  it('крыло: в рюкзаке — купола нет, рюкзак есть; лежит — сплющено позади; над головой — как в полёте', () => {
    const packed = nodeTransforms(pose({ pilot: 'walking', wing: 'packed', wingProgress: 0 }));
    expect(visible(packed.canopy.scale)).toBe(false);
    expect(visible(packed.backpack.scale)).toBe(true);
    const lying = nodeTransforms(pose({ pilot: 'standing', wing: 'lying', wingProgress: 0 }));
    // Маятник назад на угол раскладки: поворот вокруг X, сплющен по хорде (Z).
    expect(lying.canopy.scale[2]).toBeCloseTo(POSE.lyingFlatten, 9);
    expect(2 * Math.asin(lying.canopy.rotation[0]) * (180 / Math.PI)).toBeCloseTo(-POSE.lyingAngleDeg, 6);
    const up = nodeTransforms(pose({ pilot: 'running', wing: 'rising', wingProgress: 1 }));
    expect(up.canopy.scale).toEqual([1, 1, 1]);
    expect(up.canopy.rotation).toEqual([0, 0, 0, 1]);
  });

  it('шаг: ноги качаются в противофазе; стоя — неподвижны', () => {
    const walking = nodeTransforms(pose({ pilot: 'walking', wing: 'packed', gaitPhase: Math.PI / 2 }));
    expect(walking['leg-left'].rotation[0]).toBeCloseTo(-walking['leg-right'].rotation[0], 9);
    expect(Math.abs(walking['leg-left'].rotation[0])).toBeGreaterThan(0.1);
    const still = nodeTransforms(pose({ pilot: 'standing', wing: 'lying', gaitPhase: Math.PI / 2 }));
    expect(still['leg-left'].rotation).toEqual([0, 0, 0, 1]);
  });
});

describe('lyingAngleDeg — крыло ложится на рельеф позади пилота', () => {
  const angleOf = (transform: { rotation: readonly number[] }): number => 2 * Math.asin(transform.rotation[0] ?? 0) * (180 / Math.PI);
  const heightOfTop = (deg: number): number => POSE.canopyTopM * Math.cos((deg * Math.PI) / 180);

  it('ровная площадка (земля на подвеску ниже) — угол раскладки по умолчанию', () => {
    expect(lyingAngleDeg(-1)).toBeCloseTo(POSE.lyingAngleDeg, 0);
  });

  it('склон за спиной выше подвески — угол меньше: верх купола ровно на земле', () => {
    const angle = lyingAngleDeg(3);
    expect(angle).toBeLessThan(POSE.lyingAngleDeg);
    expect(heightOfTop(angle)).toBeCloseTo(3, 6);
  });

  it('обрыв за спиной — не круче, чем вниз на подвеску с запасом; крутой склон — не выше полусклона', () => {
    expect(lyingAngleDeg(-50)).toBe(POSE.lyingLimitsDeg.max);
    expect(lyingAngleDeg(50)).toBe(POSE.lyingLimitsDeg.min);
  });

  it('рельеф не известен — угол по умолчанию', () => {
    expect(lyingAngleDeg(Number.NaN)).toBe(POSE.lyingAngleDeg);
  });

  it('nodeTransforms берёт угол раскладки снаружи', () => {
    const lying = nodeTransforms({ pilot: 'standing', wing: 'lying', wingProgress: 0, gaitPhase: 0 }, { angleDeg: 70, rollDeg: 0 });
    expect(angleOf(lying.canopy)).toBeCloseTo(-70, 6);
  });
});

describe('lyingRollDeg — крыло на косогоре', () => {
  it('ровно поперёк — наклона нет; левая законцовка выше — плюс, на размах законцовок', () => {
    expect(lyingRollDeg(1200, 1200)).toBe(0);
    const roll = lyingRollDeg(1203, 1197);
    expect(Math.tan((roll * Math.PI) / 180) * 2 * POSE.lyingHalfSpanM).toBeCloseTo(6, 6);
  });

  it('обрыв поперёк — не круче предела; рельеф неизвестен — ноль', () => {
    expect(lyingRollDeg(1300, 1200)).toBe(POSE.lyingMaxRollDeg);
    expect(lyingRollDeg(Number.NaN, 1200)).toBe(0);
  });

  it('наклон по размаху поднимает левую законцовку лежащего крыла', () => {
    const { rotation } = nodeTransforms({ pilot: 'standing', wing: 'lying', wingProgress: 0, gaitPhase: 0 }, { angleDeg: 90, rollDeg: 30 })
      .canopy;
    // Левая законцовка купола (+X) — точка (5.3, 4.3, 0) модели; после поворота её высота (Y) выше правой.
    const rotate = ([x, y, z]: [number, number, number]): number[] => {
      const [qx, qy, qz, qw] = rotation;
      const ix = qw * x + qy * z - qz * y;
      const iy = qw * y + qz * x - qx * z;
      const iz = qw * z + qx * y - qy * x;
      const iw = -qx * x - qy * y - qz * z;
      return [ix * qw + iw * -qx + iy * -qz - iz * -qy, iy * qw + iw * -qy + iz * -qx - ix * -qz, iz * qw + iw * -qz + ix * -qy - iy * -qx];
    };
    const left = rotate([5.3, 4.3, 0]);
    const right = rotate([-5.3, 4.3, 0]);
    expect((left[1] ?? 0) - (right[1] ?? 0)).toBeCloseTo(2 * 5.3 * Math.sin(Math.PI / 6), 6);
  });
});
