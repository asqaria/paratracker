import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { PARAGLIDER_MODEL_PATH } from './glider-attitude';

/**
 * Модель параплана — сгенерированный файл в public/ (tools/make-paraglider.mjs).
 * Проверяется то, на что опирается сцена: формат GLB, реальные размеры в
 * метрах, нос по +Z, пилот под куполом в начале координат, области раскраски
 * купола — отдельные материалы (под выбор расцветки, задача 2.13).
 */

interface Gltf {
  asset: { version: string };
  nodes: Array<{ name: string; mesh?: number; translation?: number[]; children?: number[] }>;
  materials: Array<{
    name: string;
    alphaMode?: string;
    pbrMetallicRoughness: { baseColorFactor: number[] };
  }>;
  meshes: Array<{
    primitives: Array<{ attributes: { POSITION: number; NORMAL?: number }; indices?: number; material: number; mode?: number }>;
  }>;
  accessors: Array<{ count: number; min?: number[]; max?: number[] }>;
}

const MODEL_URL = new URL(`../../public/${PARAGLIDER_MODEL_PATH}`, import.meta.url);
const GENERATOR = new URL('../../../../tools/make-paraglider.mjs', import.meta.url);
const glb = readFileSync(MODEL_URL);
const TRIANGLES = 4;

function parse(): Gltf {
  const jsonLength = glb.readUInt32LE(12);
  return JSON.parse(glb.subarray(20, 20 + jsonLength).toString('utf8')) as Gltf;
}

const primitives = (gltf: Gltf) => gltf.meshes.flatMap((mesh) => mesh.primitives);

/** Границы всех вершин примитивов, чей материал подходит под фильтр. */
function bounds(gltf: Gltf, material?: (name: string) => boolean): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const primitive of primitives(gltf)) {
    if (material && !material(gltf.materials[primitive.material]?.name ?? '')) continue;
    const accessor = gltf.accessors[primitive.attributes.POSITION];
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis] ?? Infinity, accessor?.min?.[axis] ?? Infinity);
      max[axis] = Math.max(max[axis] ?? -Infinity, accessor?.max?.[axis] ?? -Infinity);
    }
  }
  return { min, max };
}

const named = (name: string) => (material: string) => material === name;
const canopy = (material: string) => material.startsWith('canopy-');

/** sRGB → линейный, как требует glTF для baseColorFactor. */
const linear = (srgb: number): number => (srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4);

describe('модель параплана', () => {
  it('GLB 2.0, длина в заголовке — длина файла, лёгкая', () => {
    expect(glb.readUInt32LE(0)).toBe(0x46546c67);
    expect(glb.readUInt32LE(4)).toBe(2);
    expect(glb.readUInt32LE(8)).toBe(glb.length);
    expect(parse().asset.version).toBe('2.0');
    // Две позы пилота (кокон и стоя), ноги и рюкзак — больше одной позы, но десятки КБ.
    expect(glb.length).toBeLessThan(170_000);
  });

  it('файл в репозитории — ровно то, что выдаёт генератор (детерминирован)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'paraglider-'));
    try {
      const out = join(dir, 'paraglider.glb');
      execFileSync(process.execPath, [fileURLToPath(GENERATOR), out]);
      expect(readFileSync(out).equals(glb)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('треугольники — индексированные, с нормалями; не больше 7000 на всю модель', () => {
    const gltf = parse();
    let triangles = 0;
    for (const primitive of primitives(gltf)) {
      if ((primitive.mode ?? TRIANGLES) !== TRIANGLES) continue;
      expect(primitive.indices).toBeDefined();
      expect(primitive.attributes.NORMAL).toBeDefined();
      triangles += (gltf.accessors[primitive.indices ?? -1]?.count ?? 0) / 3;
    }
    expect(triangles).toBeGreaterThan(2000);
    expect(triangles).toBeLessThanOrEqual(7000);
  });

  it('размеры настоящего крыла: размах 9–12 м, купол в 6–8 м над пилотом', () => {
    const all = bounds(parse());
    expect((all.max[0] ?? 0) - (all.min[0] ?? 0)).toBeGreaterThan(9);
    expect((all.max[0] ?? 0) - (all.min[0] ?? 0)).toBeLessThan(12);
    expect(all.max[1]).toBeGreaterThan(6);
    expect(all.max[1]).toBeLessThan(8);
  });

  it('пилот — в начале координат (точка трека), купол симметричен', () => {
    const pilot = bounds(parse(), (name) => name === 'pilot' || name.startsWith('harness'));
    expect(pilot.min[1]).toBeLessThan(0.5);
    expect(pilot.max[1]).toBeGreaterThan(0);
    const wing = bounds(parse(), canopy);
    expect((wing.max[0] ?? 0) + (wing.min[0] ?? 0)).toBeCloseTo(0, 6);
  });

  it('нос по +Z: входные отверстия — на передней кромке, белое поле — сзади', () => {
    const intake = bounds(parse(), named('canopy-intake'));
    const rear = bounds(parse(), named('canopy-secondary'));
    expect(intake.max[2]).toBeGreaterThan(rear.max[2] ?? Infinity);
  });

  it('области раскраски купола — отдельные материалы; цвета — в линейном пространстве', () => {
    const materials = parse().materials;
    const names = materials.map((m) => m.name);
    for (const region of ['canopy-primary', 'canopy-secondary', 'canopy-trim', 'canopy-underside', 'canopy-intake']) {
      expect(names).toContain(region);
    }
    // Основной цвет — акцент дизайн-системы #4DA3FF, переведённый из sRGB.
    const primary = materials.find((m) => m.name === 'canopy-primary')?.pbrMetallicRoughness.baseColorFactor ?? [];
    [0x4d, 0xa3, 0xff].forEach((byte, k) => expect(primary[k]).toBeCloseTo(linear(byte / 255), 4));
  });

  it('узлы поз — по именам, на которые опирается сцена (glider-pose.ts)', () => {
    const names = parse().nodes.map((node) => node.name);
    for (const name of ['canopy', 'pilot-seated', 'pilot-standing', 'leg-left', 'leg-right', 'backpack']) {
      expect(names).toContain(name);
    }
  });

  it('стоя: ноги от бедра до земли — на метр ниже точки подвеса (калибровка трека)', () => {
    const gltf = parse();
    for (const name of ['leg-left', 'leg-right']) {
      const node = gltf.nodes.find((n) => n.name === name);
      const mesh = gltf.meshes[node?.mesh ?? -1];
      const minY = Math.min(...(mesh?.primitives ?? []).map((p) => gltf.accessors[p.attributes.POSITION]?.min?.[1] ?? Infinity));
      const hipY = node?.translation?.[1] ?? Number.NaN;
      expect(Math.abs(hipY + minY + 1)).toBeLessThan(0.03);
    }
  });

  it('стропы полупрозрачные: видны вблизи, не перебивают купол', () => {
    const lines = parse().materials.find((m) => m.name === 'lines');
    expect(lines?.alphaMode).toBe('BLEND');
    expect(lines?.pbrMetallicRoughness.baseColorFactor[3]).toBeLessThan(1);
  });
});
