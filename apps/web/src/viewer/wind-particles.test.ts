import { describe, expect, it } from 'vitest';

import { cameraFade, dartScale, particleAlpha, spawnParticle, stepParticles, WIND_PARTICLES, windVector, type Particle } from './wind-particles';

/** Детерминированный генератор для тестов. */
function lcg(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const WEST = { dirDeg: 270, speedMs: 5, band: null };

describe('поле ветра', () => {
  it('ветер с запада — вектор на восток', () => {
    const v = windVector(WEST);
    expect(v.east).toBeCloseTo(5, 9);
    expect(v.north).toBeCloseTo(0, 9);
  });

  it('новые штрихи — внутри поля', () => {
    const rand = lcg(1);
    for (let i = 0; i < 500; i++) {
      const p = spawnParticle(rand, true);
      expect(Math.hypot(p.east, p.north)).toBeLessThanOrEqual(WIND_PARTICLES.radiusM);
      expect(Math.abs(p.up)).toBeLessThanOrEqual(WIND_PARTICLES.halfHeightM);
      expect(p.ageS).toBeLessThanOrEqual(p.lifeS);
    }
  });

  it('штрих плывёт по ветру своей высоты, ускоренно в speedScale раз', () => {
    const p: Particle = { east: 0, north: 0, up: 50, ageS: 0, lifeS: 10 };
    const heights: number[] = [];
    stepParticles([p], 0.1, (up) => (heights.push(up), WEST), lcg(2));
    expect(heights).toEqual([50]);
    expect(p.east).toBeCloseTo(5 * WIND_PARTICLES.speedScale * 0.1, 9);
    expect(p.north).toBeCloseTo(0, 9);
  });

  it('состарился или ушёл за край — рождается заново с нуля', () => {
    const old: Particle = { east: 0, north: 0, up: 0, ageS: 3.99, lifeS: 4 };
    const edge: Particle = { east: WIND_PARTICLES.radiusM - 1, north: 0, up: 0, ageS: 0, lifeS: 4 };
    const list = [old, edge];
    stepParticles(list, 0.1, () => WEST, lcg(3));
    expect(list[0]).not.toBe(old);
    expect(list[1]).not.toBe(edge);
    expect(list.every((p) => p.ageS === 0)).toBe(true);
  });

  it('прозрачность: проявляется, держится, гаснет', () => {
    expect(particleAlpha(0, 4)).toBe(0);
    expect(particleAlpha(2, 4)).toBe(WIND_PARTICLES.maxAlpha);
    expect(particleAlpha(4, 4)).toBe(0);
    expect(particleAlpha(0.4, 4)).toBeLessThan(WIND_PARTICLES.maxAlpha);
  });

  it('наконечник крупнее при сильном ветре, в пределах', () => {
    expect(dartScale(0)).toBe(WIND_PARTICLES.baseScale);
    expect(dartScale(5)).toBeCloseTo(WIND_PARTICLES.baseScale + 5 * WIND_PARTICLES.scalePerMs, 9);
    expect(dartScale(100)).toBe(WIND_PARTICLES.maxScale);
  });

  it('между камерой и пилотом — гаснут, у пилота и дальше — видны', () => {
    expect(cameraFade(20, 100)).toBe(0);
    expect(cameraFade(50, 100)).toBe(0);
    expect(cameraFade(62.5, 100)).toBeCloseTo(0.5, 9);
    expect(cameraFade(100, 100)).toBe(1);
  });
});
