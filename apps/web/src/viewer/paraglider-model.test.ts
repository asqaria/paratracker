import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { PARAGLIDER_MODEL_PATH } from './glider-attitude';

/**
 * Модель параплана — сгенерированный файл в public/ (tools/make-paraglider.mjs).
 * Проверяется то, на что опирается сцена: формат GLB, реальные размеры в
 * метрах, нос по +Z и пилот под куполом в начале координат.
 */

interface Gltf {
  asset: { version: string };
  materials: Array<{ name: string }>;
  meshes: Array<{ primitives: Array<{ attributes: { POSITION: number }; material: number }> }>;
  accessors: Array<{ min?: number[]; max?: number[] }>;
}

const glb = readFileSync(new URL(`../../public/${PARAGLIDER_MODEL_PATH}`, import.meta.url));

function parse(): Gltf {
  const jsonLength = glb.readUInt32LE(12);
  return JSON.parse(glb.subarray(20, 20 + jsonLength).toString('utf8')) as Gltf;
}

/** Границы всех вершин примитивов с данным материалом. */
function bounds(gltf: Gltf, material?: string): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const primitive of gltf.meshes.flatMap((mesh) => mesh.primitives)) {
    if (material !== undefined && gltf.materials[primitive.material]?.name !== material) continue;
    const accessor = gltf.accessors[primitive.attributes.POSITION];
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis] ?? Infinity, accessor?.min?.[axis] ?? Infinity);
      max[axis] = Math.max(max[axis] ?? -Infinity, accessor?.max?.[axis] ?? -Infinity);
    }
  }
  return { min, max };
}

describe('модель параплана', () => {
  it('GLB 2.0, длина в заголовке — длина файла, лёгкая', () => {
    expect(glb.readUInt32LE(0)).toBe(0x46546c67);
    expect(glb.readUInt32LE(4)).toBe(2);
    expect(glb.readUInt32LE(8)).toBe(glb.length);
    expect(parse().asset.version).toBe('2.0');
    expect(glb.length).toBeLessThan(150_000);
  });

  it('размеры настоящего крыла: размах 9–12 м, купол в 6–8 м над пилотом', () => {
    const all = bounds(parse());
    expect((all.max[0] ?? 0) - (all.min[0] ?? 0)).toBeGreaterThan(9);
    expect((all.max[0] ?? 0) - (all.min[0] ?? 0)).toBeLessThan(12);
    expect(all.max[1]).toBeGreaterThan(6);
    expect(all.max[1]).toBeLessThan(8);
  });

  it('пилот — в начале координат (точка трека), купол симметричен', () => {
    const pilot = bounds(parse(), 'pilot');
    expect(pilot.min[1]).toBeLessThan(0.5);
    expect(pilot.max[1]).toBeGreaterThan(0);
    const canopy = bounds(parse(), 'canopy');
    expect((canopy.max[0] ?? 0) + (canopy.min[0] ?? 0)).toBeCloseTo(0, 6);
  });

  it('нос по +Z: акцентная передняя кромка впереди основной части купола', () => {
    const accent = bounds(parse(), 'accent');
    const canopy = bounds(parse(), 'canopy');
    expect(accent.max[2]).toBeGreaterThan(canopy.max[2] ?? Infinity);
  });
});
