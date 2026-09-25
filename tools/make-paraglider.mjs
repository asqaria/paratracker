#!/usr/bin/env node
/**
 * Skyline — генератор модели параплана (ТЗ §12, задача 2.9).
 *
 * Модель своя, из геометрии, а не скачанная: без лицензии и атрибуции,
 * размером в десятки КБ и в цветах дизайн-системы. Генератор детерминирован:
 * тот же код — те же байты, поэтому результат лежит в репозитории.
 *
 * Запуск:   node tools/make-paraglider.mjs [выходной_файл]
 * По умолчанию пишет apps/web/public/models/paraglider.glb
 *
 * Оси glTF: +Y вверх, +Z — нос (передняя кромка), +X — левое крыло.
 * Единицы — метры. Начало координат — точка подвеса пилота: модель стоит
 * ровно в точке трека, купол — над ней на стропах.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const OUT = process.argv[2] || 'apps/web/public/models/paraglider.glb';

/* ── Размеры (типичное крыло EN-B, ~23 м² плоской площади) ─────────────── */

/** Радиус дуги купола в размахе, м: даёт проектный размах ~10 м. */
const ARC_RADIUS_M = 6.2;
/** Верх купола над пилотом, м (длина строп ~7 м). */
const CANOPY_TOP_M = 7.2;
/** Полуугол дуги, градусы: концы купола опущены, как у настоящего крыла. */
const ARC_HALF_ANGLE_DEG = 58;
/** Хорда в центре, м; к концам — эллиптически, но не уже TIP_CHORD_FRACTION. */
const ROOT_CHORD_M = 2.7;
const TIP_CHORD_FRACTION = 0.38;
/** Доля хорды перед линией строп: передняя кромка выдвинута вперёд. */
const LEADING_EDGE_FRACTION = 0.35;
/** Стреловидность концов назад, м. */
const TIP_SWEEP_M = 0.35;
/** Относительная толщина профиля (NACA 00xx) и кривизна средней линии. */
const THICKNESS = 0.14;
const CAMBER = 0.03;
/** Секций в размахе (визуально — секции купола) и точек по хорде. */
const CELLS = 28;
const CHORD_SAMPLES = 8;
/** Доля хорды, окрашенная акцентом: полоса вдоль передней кромки. */
const LEADING_BAND = 0.28;

/* ── Цвета: светлый купол, акцент дизайн-системы (--color-accent) ────────── */

const COLORS = {
  canopy: [0.93, 0.95, 0.97],
  underside: [0.68, 0.73, 0.8],
  accent: [0.302, 0.639, 1.0],
  lines: [0.3, 0.33, 0.38],
  harness: [0.17, 0.18, 0.21],
  pilot: [0.23, 0.29, 0.37],
  helmet: [0.95, 0.95, 0.95],
};

/* ── Геометрия ───────────────────────────────────────────────────────────── */

const DEG = Math.PI / 180;
/** Удвоенная площадь, м², меньше которой треугольник считается вырожденным. */
const MIN_DOUBLE_AREA_M2 = 1e-9;

/** Профиль NACA 00xx: полутолщина на доле хорды u ∈ [0, 1] (замкнутая задняя кромка). */
function halfThickness(u) {
  return 5 * THICKNESS * (0.2969 * Math.sqrt(u) - 0.126 * u - 0.3516 * u ** 2 + 0.2843 * u ** 3 - 0.1036 * u ** 4);
}

/** Средняя линия: простая парабола с максимумом CAMBER в середине хорды. */
function camber(u) {
  return 4 * CAMBER * u * (1 - u);
}

/** Сечение купола на угле дуги theta: точки верха и низа по хорде. */
function section(theta) {
  const t = theta / (ARC_HALF_ANGLE_DEG * DEG);
  const chord = ROOT_CHORD_M * Math.max(TIP_CHORD_FRACTION, Math.sqrt(1 - t * t));
  const normal = [Math.sin(theta), Math.cos(theta), 0];
  const centre = [ARC_RADIUS_M * Math.sin(theta), CANOPY_TOP_M - ARC_RADIUS_M * (1 - Math.cos(theta)), 0];
  const leadingZ = LEADING_EDGE_FRACTION * chord - TIP_SWEEP_M * t * t;
  const upper = [];
  const lower = [];
  for (let k = 0; k <= CHORD_SAMPLES; k++) {
    // Точки гуще у передней кромки: там профиль гнётся сильнее.
    const u = (1 - Math.cos((k / CHORD_SAMPLES) * Math.PI)) / 2;
    const z = leadingZ - u * chord;
    const up = (camber(u) + halfThickness(u)) * chord;
    const down = (camber(u) - halfThickness(u)) * chord;
    upper.push([centre[0] + normal[0] * up, centre[1] + normal[1] * up, z]);
    lower.push([centre[0] + normal[0] * down, centre[1] + normal[1] * down, z]);
  }
  return { upper, lower, chord, u: upper.map((_, k) => (1 - Math.cos((k / CHORD_SAMPLES) * Math.PI)) / 2) };
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalize = (v) => {
  const l = Math.hypot(...v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

/** Набор треугольников одного материала: плоские нормали на грань. */
function mesh() {
  const positions = [];
  const normals = [];
  return {
    positions,
    normals,
    triangle(a, b, c) {
      const normal = cross(sub(b, a), sub(c, a));
      // У кромок профиль сходится в точку: вырожденный треугольник нормали не имеет.
      if (Math.hypot(...normal) < MIN_DOUBLE_AREA_M2) return;
      const n = normalize(normal);
      positions.push(...a, ...b, ...c);
      normals.push(...n, ...n, ...n);
    },
    quad(a, b, c, d) {
      this.triangle(a, b, c);
      this.triangle(a, c, d);
    },
  };
}

const parts = {
  canopy: mesh(),
  accent: mesh(),
  underside: mesh(),
  harness: mesh(),
  pilot: mesh(),
  helmet: mesh(),
};

// Купол: верх (светлый, передняя полоса — акцент) и низ.
const sections = [];
for (let i = 0; i <= CELLS; i++) {
  sections.push(section((-1 + (2 * i) / CELLS) * ARC_HALF_ANGLE_DEG * DEG));
}
for (let i = 0; i < CELLS; i++) {
  const a = sections[i];
  const b = sections[i + 1];
  for (let k = 0; k < CHORD_SAMPLES; k++) {
    const top = a.u[k + 1] <= LEADING_BAND ? parts.accent : parts.canopy;
    // Обход против часовой, если смотреть снаружи: нормаль верха — вверх.
    top.quad(a.upper[k], a.upper[k + 1], b.upper[k + 1], b.upper[k]);
    parts.underside.quad(a.lower[k], b.lower[k], b.lower[k + 1], a.lower[k + 1]);
  }
}
// Торцы купола — замкнуть профиль.
for (const [s, flip] of [
  [sections[0], false],
  [sections[CELLS], true],
]) {
  for (let k = 0; k < CHORD_SAMPLES; k++) {
    const quad = [s.upper[k], s.lower[k], s.lower[k + 1], s.upper[k + 1]];
    if (flip) quad.reverse();
    parts.accent.quad(...quad);
  }
}

/** Прямоугольный блок [min, max] по осям. */
function box(target, [x0, y0, z0], [x1, y1, z1]) {
  const p = (x, y, z) => [x, y, z];
  const c = [p(x0, y0, z0), p(x1, y0, z0), p(x1, y1, z0), p(x0, y1, z0), p(x0, y0, z1), p(x1, y0, z1), p(x1, y1, z1), p(x0, y1, z1)];
  target.quad(c[0], c[3], c[2], c[1]); // зад (−Z)
  target.quad(c[4], c[5], c[6], c[7]); // перед (+Z)
  target.quad(c[0], c[1], c[5], c[4]); // низ
  target.quad(c[3], c[7], c[6], c[2]); // верх
  target.quad(c[0], c[4], c[7], c[3]); // сторона x0
  target.quad(c[1], c[2], c[6], c[5]); // сторона x1
}

// Пилот полулёжа в коконе: подвеска на уровне груди, ноги вперёд.
box(parts.harness, [-0.26, -0.45, -0.35], [0.26, -0.05, 0.95]); // кокон с ногами
box(parts.harness, [-0.28, -0.5, -0.55], [0.28, 0.25, -0.3]); // спинка с запаской
box(parts.pilot, [-0.22, -0.1, -0.45], [0.22, 0.45, -0.15]); // корпус
box(parts.pilot, [-0.3, 0.15, -0.35], [-0.2, 0.55, -0.25]); // левая рука к клевантам
box(parts.pilot, [0.2, 0.15, -0.35], [0.3, 0.55, -0.25]);
box(parts.helmet, [-0.13, 0.45, -0.42], [0.13, 0.72, -0.14]); // шлем

// Стропы: от свободных концов к низу купола — ряды A (у кромки), C и тормозные.
const risers = { left: [0.22, 0.45, -0.2], right: [-0.22, 0.45, -0.2] };
const linePositions = [];
for (let i = 0; i <= CELLS; i += 2) {
  const s = sections[i];
  const riser = s.lower[0][0] >= 0 ? risers.left : risers.right;
  for (const fraction of [0.15, 0.55]) {
    const k = s.u.findIndex((u) => u >= fraction);
    linePositions.push(...riser, ...s.lower[k]);
  }
  linePositions.push(...riser, ...s.lower[CHORD_SAMPLES]); // тормозные — к задней кромке
}

/* ── Сборка GLB ──────────────────────────────────────────────────────────── */

const FLOAT = 5126;
const ARRAY_BUFFER = 34962;
const TRIANGLES = 4;
const LINES = 1;

const binary = [];
let byteLength = 0;
const gltf = {
  asset: { version: '2.0', generator: 'Skyline tools/make-paraglider.mjs' },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ mesh: 0, name: 'paraglider' }],
  meshes: [{ name: 'paraglider', primitives: [] }],
  materials: [],
  accessors: [],
  bufferViews: [],
  buffers: [],
};

function addAccessor(values, withBounds) {
  const data = Float32Array.from(values);
  const view = gltf.bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: data.byteLength, target: ARRAY_BUFFER }) - 1;
  binary.push(Buffer.from(data.buffer));
  byteLength += data.byteLength;
  const accessor = { bufferView: view, componentType: FLOAT, count: values.length / 3, type: 'VEC3' };
  if (withBounds) {
    accessor.min = [0, 1, 2].map((axis) => Math.min(...data.filter((_, i) => i % 3 === axis)));
    accessor.max = [0, 1, 2].map((axis) => Math.max(...data.filter((_, i) => i % 3 === axis)));
  }
  return gltf.accessors.push(accessor) - 1;
}

function addMaterial(name, rgb, extra = {}) {
  return (
    gltf.materials.push({
      name,
      pbrMetallicRoughness: { baseColorFactor: [...rgb, 1], metallicFactor: 0, roughnessFactor: 0.85 },
      ...extra,
    }) - 1
  );
}

for (const [name, part] of Object.entries(parts)) {
  const colour = name === 'accent' ? COLORS.accent : COLORS[name];
  // Купол тонкий: изнутри его видно снизу, поэтому без отсечения задних граней.
  const material = addMaterial(name, colour, { doubleSided: name === 'canopy' || name === 'accent' || name === 'underside' });
  gltf.meshes[0].primitives.push({
    attributes: { POSITION: addAccessor(part.positions, true), NORMAL: addAccessor(part.normals, false) },
    material,
    mode: TRIANGLES,
  });
}
gltf.meshes[0].primitives.push({
  attributes: { POSITION: addAccessor(linePositions, true) },
  material: addMaterial('lines', COLORS.lines),
  mode: LINES,
});
gltf.buffers.push({ byteLength });

const pad = (buffer, fill) => Buffer.concat([buffer, Buffer.alloc((4 - (buffer.length % 4)) % 4, fill)]);
const json = pad(Buffer.from(JSON.stringify(gltf)), 0x20);
const bin = pad(Buffer.concat(binary), 0);
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0); // 'glTF'
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + json.length + 8 + bin.length, 8);
const chunk = (type, data) => {
  const head = Buffer.alloc(8);
  head.writeUInt32LE(data.length, 0);
  head.writeUInt32LE(type, 4);
  return Buffer.concat([head, data]);
};
const glb = Buffer.concat([header, chunk(0x4e4f534a, json), chunk(0x004e4942, bin)]);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, glb);
console.log(`${OUT}: ${glb.length} байт, ${Object.values(parts).reduce((n, p) => n + p.positions.length / 9, 0)} треугольников`);
