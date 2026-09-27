import { describe, expect, it } from 'vitest';

import { ARROW_PROFILE, dartModelUri, revolve } from './dart-model';

interface Gltf {
  accessors: { count: number; min?: number[]; max?: number[] }[];
  buffers: { byteLength: number; uri: string }[];
}

const decode = (uri: string): Gltf => JSON.parse(atob(uri.slice(uri.indexOf(',') + 1))) as Gltf;

describe('модель 3D-стрелки ветра', () => {
  it('нос — по +Z (как у модели пилота), длина 1.12 в долях, ось — по центру', () => {
    const gltf = decode(dartModelUri());
    const box = gltf.accessors[0];
    expect(box?.max?.[2]).toBeCloseTo(0.62, 6);
    expect(box?.min?.[2]).toBeCloseTo(-0.5, 6);
    expect(box?.max?.[0]).toBeCloseTo(0.15, 6);
    expect(box?.min?.[0]).toBeCloseTo(-0.15, 6);
  });

  it('данные внутри: позиции, нормали и индексы — по числу вершин', () => {
    const gltf = decode(dartModelUri());
    const mesh = revolve(ARROW_PROFILE);
    const vertices = mesh.positions.length / 3;
    expect(gltf.accessors[0]?.count).toBe(vertices);
    expect(gltf.accessors[1]?.count).toBe(vertices);
    expect(gltf.accessors[2]?.count).toBe(mesh.indices.length);
    expect(gltf.buffers[0]?.byteLength).toBe(vertices * 3 * 4 * 2 + mesh.indices.length * 2);
  });

  it('нормали единичные и смотрят от оси наружу', () => {
    const { positions, normals } = revolve(ARROW_PROFILE);
    for (let i = 0; i < normals.length; i += 3) {
      const [nx = 0, ny = 0, nz = 0] = normals.slice(i, i + 3);
      expect(Math.hypot(nx, ny, nz)).toBeCloseTo(1, 6);
      const [x = 0, y = 0] = positions.slice(i, i + 2);
      if (Math.hypot(x, y) > 1e-6) expect(nx * x + ny * y).toBeGreaterThanOrEqual(-1e-9);
    }
  });
});
