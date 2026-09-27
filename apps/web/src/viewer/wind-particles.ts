import { downwindDeg, type WindHere } from './wind-arrows';

/**
 * Поле ветра у пилота (задача 3.14): плоские наконечники в объёме вокруг
 * пилота лежат горизонтально носом по ветру, плывут, появляются и гаснут. Каждый берёт ветер своей
 * высоты — сдвиг ветра выше и ниже пилота виден глазом. Координаты —
 * локальные ENU от пилота, м: поле едет с пилотом и показывает ветер
 * относительно земли под ним, не мешая следить за самим пилотом.
 */

export const WIND_PARTICLES = {
  /**
   * Наконечников в поле: около десятка рядом с пилотом, как в повторах
   * пилотских приложений; десятки значков по всей долине рябили.
   */
  count: 14,
  /** Радиус поля по горизонтали, м: рядом с пилотом, в кадре Chase. */
  radiusM: 150,
  /** Половина высоты поля, м: выше и ниже пилота — сдвиг ветра виден. */
  halfHeightM: 60,
  /**
   * Во сколько раз наконечники быстрее настоящего ветра: 4 м/с за 150 м шли
   * бы почти сорок секунд — движения не видно. От скорости проигрывания не зависит.
   */
  speedScale: 6,
  /** Жизнь наконечника, с (±30 %): появляется, плывёт, гаснет. */
  lifeS: 6,
  lifeSpread: 0.3,
  /** Доли жизни на появление и угасание. */
  fadeInShare: 0.2,
  fadeOutShare: 0.3,
  /** Полупрозрачный: рельеф и трек видны сквозь него. */
  maxAlpha: 0.55,
  /**
   * Длина наконечника, м (около половины размаха крыла — не спорит с пилотом),
   * и её рост со скоростью ветра: масштаб = base + perMs × скорость.
   */
  lengthM: 6,
  baseScale: 0.7,
  scalePerMs: 0.08,
  maxScale: 1.6,
  /** Издалека не меньше стольких пикселей: иначе дальние пропадали бы точками. */
  minPixels: 10,
  /**
   * Между камерой и пилотом наконечники гаснут: ближе к камере, чем эта доля
   * расстояния до пилота, — не видны, ещё через fadeShare — в полную силу.
   * Иначе в Chase у объектива висели огромные обрезанные фигуры.
   */
  cameraClearShare: 0.5,
  cameraFadeShare: 0.25,
} as const;

export interface Particle {
  east: number;
  north: number;
  up: number;
  ageS: number;
  lifeS: number;
}

/** Ветер как вектор ENU, м/с: куда сносит. */
export function windVector(wind: WindHere): { east: number; north: number } {
  const rad = (downwindDeg(wind.dirDeg) * Math.PI) / 180;
  return { east: Math.sin(rad) * wind.speedMs, north: Math.cos(rad) * wind.speedMs };
}

/** Новый наконечник в случайной точке поля; равномерно по площади круга. */
export function spawnParticle(rand: () => number, randomAge: boolean): Particle {
  const r = WIND_PARTICLES.radiusM * Math.sqrt(rand());
  const angle = rand() * 2 * Math.PI;
  const lifeS = WIND_PARTICLES.lifeS * (1 - WIND_PARTICLES.lifeSpread + 2 * WIND_PARTICLES.lifeSpread * rand());
  return {
    east: r * Math.cos(angle),
    north: r * Math.sin(angle),
    up: (2 * rand() - 1) * WIND_PARTICLES.halfHeightM,
    ageS: randomAge ? rand() * lifeS : 0,
    lifeS,
  };
}

/** Прозрачность по возрасту: проявляется, держится, гаснет. */
export function particleAlpha(ageS: number, lifeS: number): number {
  const share = ageS / lifeS;
  if (share <= 0 || share >= 1) return 0;
  const fadeIn = Math.min(1, share / WIND_PARTICLES.fadeInShare);
  const fadeOut = Math.min(1, (1 - share) / WIND_PARTICLES.fadeOutShare);
  return WIND_PARTICLES.maxAlpha * Math.min(fadeIn, fadeOut);
}

const outside = (p: Particle): boolean =>
  Math.hypot(p.east, p.north) > WIND_PARTICLES.radiusM || Math.abs(p.up) > WIND_PARTICLES.halfHeightM;

/**
 * Шаг поля на dtS секунд: штрих плывёт по ветру своей высоты (windAt — по
 * смещению вверх от пилота); состарился или ушёл за край — рождается заново.
 * Ветра на высоте нет — штрих стоит и гаснет.
 */
export function stepParticles(
  particles: Particle[],
  dtS: number,
  windAt: (upM: number) => WindHere | null,
  rand: () => number,
): void {
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    if (!p) continue;
    const wind = windAt(p.up);
    if (wind) {
      const v = windVector(wind);
      p.east += v.east * WIND_PARTICLES.speedScale * dtS;
      p.north += v.north * WIND_PARTICLES.speedScale * dtS;
    }
    p.ageS += dtS;
    if (p.ageS >= p.lifeS || outside(p)) particles[i] = spawnParticle(rand, false);
  }
}

/** Масштаб наконечника: растёт со скоростью ветра, в пределах. */
export const dartScale = (speedMs: number): number =>
  Math.min(WIND_PARTICLES.maxScale, WIND_PARTICLES.baseScale + Math.max(0, speedMs) * WIND_PARTICLES.scalePerMs);

/** Множитель прозрачности у камеры: 0 — слишком близко к объективу, 1 — дальше полосы угасания. */
export function cameraFade(toCameraM: number, pilotToCameraM: number): number {
  const clear = WIND_PARTICLES.cameraClearShare * pilotToCameraM;
  const band = WIND_PARTICLES.cameraFadeShare * pilotToCameraM;
  if (band <= 0) return 1;
  return Math.min(1, Math.max(0, (toCameraM - clear) / band));
}
