/**
 * Модель указателя ветра (задача 3.14): 3D-стрелка длиной 1 м — конический
 * наконечник на тонком древке (выбор владельца 27.09.2026 из конуса, стрелки,
 * капли и самолётика). Нос по +Z glTF, как у модели пилота
 * (tools/make-paraglider.mjs), Y — вверх. Тело вращения — читается с любой
 * стороны; освещение обычное — объём виден светотенью. Собирается в коде как
 * glTF с данными внутри: файл модели не нужен.
 */

/** Профиль стрелки [(z, r)] от носа к хвосту: наконечник, уступ, древко. */
export const ARROW_PROFILE: readonly (readonly [number, number])[] = [
  [0.62, 0],
  [0.18, 0.15],
  [0.18, 0.045],
  [-0.5, 0.045],
  [-0.5, 0],
];

/** Сегментов по кругу: меньше — видны грани на крупном плане. */
const SEGMENTS = 20;

interface Mesh {
  positions: number[];
  normals: number[];
  indices: number[];
}

/**
 * Тело вращения вокруг оси Z по профилю. Плоские полосы: у каждой своя
 * нормаль — грани чистые, без артефактов на острие и уступе.
 */
export function revolve(profile: readonly (readonly [number, number])[]): Mesh {
  const mesh: Mesh = { positions: [], normals: [], indices: [] };
  for (let k = 0; k + 1 < profile.length; k++) {
    const [z0, r0] = profile[k] ?? [0, 0];
    const [z1, r1] = profile[k + 1] ?? [0, 0];
    // Нормаль образующей в плоскости (r, z): перпендикуляр к отрезку, наружу от оси.
    const dz = z1 - z0;
    const dr = r1 - r0;
    const len = Math.hypot(dz, dr) || 1;
    let nr = -dz / len;
    let nz = dr / len;
    if (nr < 0) {
      nr = -nr;
      nz = -nz;
    }
    const base = mesh.positions.length / 3;
    for (let s = 0; s <= SEGMENTS; s++) {
      const a = (s / SEGMENTS) * 2 * Math.PI;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      mesh.positions.push(r0 * c, r0 * sn, z0, r1 * c, r1 * sn, z1);
      mesh.normals.push(nr * c, nr * sn, nz, nr * c, nr * sn, nz);
    }
    for (let s = 0; s < SEGMENTS; s++) {
      const i = base + s * 2;
      mesh.indices.push(i, i + 2, i + 1, i + 1, i + 2, i + 3);
    }
  }
  return mesh;
}

const GL_FLOAT = 5126;
const GL_UNSIGNED_SHORT = 5123;
const GL_ARRAY_BUFFER = 34962;
const GL_ELEMENT_ARRAY_BUFFER = 34963;

function bounds(values: readonly number[]): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < values.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = values[i + a] ?? 0;
      min[a] = Math.min(min[a] ?? v, v);
      max[a] = Math.max(max[a] ?? v, v);
    }
  }
  return { min, max };
}

export function dartModelUri(): string {
  const mesh = revolve(ARROW_PROFILE);
  const positions = new Float32Array(mesh.positions);
  const normals = new Float32Array(mesh.normals);
  const indices = new Uint16Array(mesh.indices);
  const bytes = new Uint8Array(positions.byteLength + normals.byteLength + indices.byteLength);
  bytes.set(new Uint8Array(positions.buffer), 0);
  bytes.set(new Uint8Array(normals.buffer), positions.byteLength);
  bytes.set(new Uint8Array(indices.buffer), positions.byteLength + normals.byteLength);
  let binary = '';
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  const vertexCount = positions.length / 3;
  const box = bounds(mesh.positions);
  const gltf = {
    asset: { version: '2.0', generator: 'skyline dart-model' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }] }],
    materials: [
      {
        pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.6 },
        alphaMode: 'BLEND',
        doubleSided: true,
      },
    ],
    buffers: [{ byteLength: bytes.byteLength, uri: `data:application/octet-stream;base64,${btoa(binary)}` }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positions.byteLength, target: GL_ARRAY_BUFFER },
      { buffer: 0, byteOffset: positions.byteLength, byteLength: normals.byteLength, target: GL_ARRAY_BUFFER },
      {
        buffer: 0,
        byteOffset: positions.byteLength + normals.byteLength,
        byteLength: indices.byteLength,
        target: GL_ELEMENT_ARRAY_BUFFER,
      },
    ],
    accessors: [
      { bufferView: 0, componentType: GL_FLOAT, count: vertexCount, type: 'VEC3', min: box.min, max: box.max },
      { bufferView: 1, componentType: GL_FLOAT, count: vertexCount, type: 'VEC3' },
      { bufferView: 2, componentType: GL_UNSIGNED_SHORT, count: indices.length, type: 'SCALAR' },
    ],
  };
  return `data:model/gltf+json;base64,${btoa(JSON.stringify(gltf))}`;
}
