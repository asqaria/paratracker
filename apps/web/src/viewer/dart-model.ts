/**
 * Модель наконечника для поля ветра (задача 3.14): шеврон длиной 1 м, нос по
 * +Z (как у модели пилота, tools/make-paraglider.mjs) — крестом, как оперение стрелы: горизонтальный и вертикальный. Плоский
 * сбоку превращался в линию; крестом силуэт наконечника виден сверху и сбоку,
 * спереди — аккуратный крестик. Y — вверх (glTF). Собирается в
 * коде как glTF с данными внутри: файл модели не нужен. Без освещения (unlit):
 * цвет одинаков с любой стороны и в любой час дня.
 */

/** Контур в долях длины: нос, крылья (правое, левое, верхнее, нижнее), вырез сзади. */
const TIP = [0, 0, 0.62] as const;
const RIGHT = [-0.42, 0, -0.38] as const;
const LEFT = [0.42, 0, -0.38] as const;
const TOP = [0, 0.42, -0.38] as const;
const BOTTOM = [0, -0.42, -0.38] as const;
const NOTCH = [0, 0, -0.12] as const;

const VERTEX_FLOATS = 3;
const GL_FLOAT = 5126;
const GL_UNSIGNED_SHORT = 5123;
const GL_ARRAY_BUFFER = 34962;
const GL_ELEMENT_ARRAY_BUFFER = 34963;

export function dartModelUri(): string {
  const positions = new Float32Array([...TIP, ...RIGHT, ...LEFT, ...TOP, ...BOTTOM, ...NOTCH]);
  // Четыре лопасти: нос — крыло — вырез.
  const indices = new Uint16Array([0, 1, 5, 0, 5, 2, 0, 3, 5, 0, 5, 4]);
  const positionBytes = positions.byteLength;
  const bytes = new Uint8Array(positionBytes + indices.byteLength);
  bytes.set(new Uint8Array(positions.buffer), 0);
  bytes.set(new Uint8Array(indices.buffer), positionBytes);
  let binary = '';
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  const gltf = {
    asset: { version: '2.0', generator: 'skyline dart-model' },
    extensionsUsed: ['KHR_materials_unlit'],
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
    materials: [
      {
        pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 },
        alphaMode: 'BLEND',
        doubleSided: true,
        extensions: { KHR_materials_unlit: {} },
      },
    ],
    buffers: [{ byteLength: bytes.byteLength, uri: `data:application/octet-stream;base64,${btoa(binary)}` }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positionBytes, target: GL_ARRAY_BUFFER },
      { buffer: 0, byteOffset: positionBytes, byteLength: indices.byteLength, target: GL_ELEMENT_ARRAY_BUFFER },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: GL_FLOAT,
        count: positions.length / VERTEX_FLOATS,
        type: 'VEC3',
        min: [RIGHT[0], BOTTOM[1], RIGHT[2]],
        max: [LEFT[0], TOP[1], TIP[2]],
      },
      { bufferView: 1, componentType: GL_UNSIGNED_SHORT, count: indices.length, type: 'SCALAR' },
    ],
  };
  return `data:model/gltf+json;base64,${btoa(JSON.stringify(gltf))}`;
}
