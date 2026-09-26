#!/usr/bin/env node
/**
 * Skyline — генератор модели параплана (ТЗ §12, задача 2.9).
 *
 * Модель своя, из геометрии, а не скачанная: без лицензии и атрибуции,
 * размером в десятки КБ и в цветах дизайн-системы. Генератор детерминирован:
 * тот же код — те же байты, поэтому результат лежит в репозитории
 * (paraglider-model.test.ts сверяет файл с выводом генератора).
 *
 * Запуск:   node tools/make-paraglider.mjs [выходной_файл]
 * По умолчанию пишет apps/web/src/viewer/models/paraglider.glb (Vite — в /assets/ с хешем)
 *
 * Оси glTF: +Y вверх, +Z — нос (передняя кромка), +X — левое крыло.
 * Единицы — метры. Начало координат — точка подвеса пилота (карабины): модель
 * стоит ровно в точке трека, купол — над ней на стропах.
 *
 * Что делает модель похожей на настоящее крыло:
 *   - ячейки: верх надут между нервюрами, гладкие нормали дают полосы света;
 *   - входные отверстия — тёмная полоса по низу передней кромки;
 *   - рисунок верха: передняя часть — акцент, шеврон, белое поле сзади;
 *     шеврон смотрит в сторону полёта — курс читается и сверху;
 *   - стропы каскадом: верхние ветвятся к куполу, к свободным концам идут
 *     по одной на ряд; тёмные и полупрозрачные — не спорят с куполом;
 *   - пилот полулёжа в обтекаемом коконе, шлем — светлое пятно под куполом.
 * Каждая область раскраски купола — свой материал (canopy-*): выбор
 * расцветки крыла (задача 2.13) меняет только цвета этих материалов.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const OUT = process.argv[2] || 'apps/web/src/viewer/models/paraglider.glb';

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

/** Ячеек в размахе: у крыльев EN-B 40–55; меньше — крупнее и читаемее на экране. */
const CELLS = 36;
/** Точек поперёк ячейки на верхе: между нервюрами купол надут. */
const CELL_SAMPLES = 3;
/** Надув ячейки: подъём верха в середине ячейки, доля хорды. */
const INFLATION = 0.018;
/** Законцовок (стабилизаторов) с каждой стороны, ячеек — тёмные. */
const TIP_CELLS = 2;

/**
 * Шеврон: ось полосы на доле хорды в центре и у законцовок (стреловидная —
 * «галочка» носом вперёд), полуширина полосы. Точки хорды сгущаются к полосе,
 * её края лежат ровно по рёбрам сетки — края рисунка без лесенки.
 */
const CHEVRON_ROOT_U = 0.2;
const CHEVRON_TIP_U = 0.66;
const CHEVRON_HALF_WIDTH = 0.06;
/**
 * Задняя кромка — полоса акцента от этой доли хорды: сзади (камера Chase)
 * видна задняя часть верха, и без полосы крыло оттуда — белое пятно.
 */
const TRAILING_BAND_U = 0.86;
/** Точек по хорде: до полосы (гуще у кромки), в полосе, белое поле, задняя полоса. */
const FRONT_SAMPLES = 7;
const STRIPE_SAMPLES = 2;
const REAR_SAMPLES = 4;
const TRAILING_SAMPLES = 2;
/** Входные отверстия: низ передней кромки до этой доли хорды. */
const INTAKE_U = 0.04;

/* ── Цвета: sRGB дизайн-системы → линейные, как требует glTF ────────────── */

/** sRGB-компонента → линейная (baseColorFactor в glTF — линейный). */
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const rgb = (hex) => [16, 8, 0].map((shift) => +toLinear(((hex >> shift) & 0xff) / 255).toFixed(6));

/** Ткань — атласная, не пластмасса; подвеска — нейлон с блеском; визор — глянец. */
const FABRIC = { metallicFactor: 0, roughnessFactor: 0.6 };
const NYLON = { metallicFactor: 0, roughnessFactor: 0.45 };

const MATERIALS = {
  /** Акцент дизайн-системы (--color-accent, #4DA3FF). */
  'canopy-primary': { color: rgb(0x4da3ff), ...FABRIC },
  'canopy-secondary': { color: rgb(0xf4f6f8), ...FABRIC },
  /** Шеврон и законцовки — глубокий синий, контраст к обоим полям. */
  'canopy-trim': { color: rgb(0x1b2a41), ...FABRIC },
  /** Низ — светлее акцента: снизу и сзади крыло читается голубым, а не серым. */
  'canopy-underside': { color: rgb(0x8fbbea), ...FABRIC },
  'canopy-intake': { color: rgb(0x14171c), ...FABRIC },
  /**
   * Стропы: серые, полупрозрачные — пучок, а не сплошной веер. Линия всегда
   * в пиксель толщиной, и издалека тёмные стропы перебивали купол.
   */
  lines: { color: rgb(0x5d6470), alpha: 0.45, ...FABRIC },
  risers: { color: rgb(0x22252b), ...NYLON },
  harness: { color: rgb(0x2a2d33), ...NYLON },
  'harness-accent': { color: rgb(0x4da3ff), ...NYLON },
  /**
   * Куртка — светлая сине-серая: тёмная (#34506f) сливалась со штанами и
   * подвеской — силуэт не читался.
   */
  jacket: { color: rgb(0x5b7fa6), ...FABRIC },
  /** Манжеты и полосы на рукавах — акцент дизайн-системы. */
  'jacket-accent': { color: rgb(0x4da3ff), ...FABRIC },
  pants: { color: rgb(0x22252b), ...FABRIC },
  /** Горные ботинки — коричневая кожа. */
  boots: { color: rgb(0x5a3e2b), metallicFactor: 0, roughnessFactor: 0.7 },
  gloves: { color: rgb(0x1b1d21), ...FABRIC },
  helmet: { color: rgb(0xf2f4f7), metallicFactor: 0, roughnessFactor: 0.35 },
  visor: { color: rgb(0x0e1116), metallicFactor: 0.2, roughnessFactor: 0.15 },
};

/* ── Векторы ─────────────────────────────────────────────────────────────── */

const DEG = Math.PI / 180;
/** Удвоенная площадь, м², меньше которой треугольник считается вырожденным. */
const MIN_DOUBLE_AREA_M2 = 1e-9;

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const lerp = (a, b, t) => add(a, scale(sub(b, a), t));
const normalize = (v) => {
  const l = Math.hypot(...v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const centroid = (points) => scale(points.reduce(add, [0, 0, 0]), 1 / points.length);

/* ── Сетки и материалы ───────────────────────────────────────────────────── */

/** Индексированный набор треугольников одного материала. */
function part() {
  return { positions: [], normals: [], indices: [], vertexOf: new Map() };
}
const parts = Object.fromEntries(Object.keys(MATERIALS).filter((name) => name !== 'lines').map((name) => [name, part()]));

let surfaceCount = 0;

/**
 * Поверхность из сетки точек grid[i][j] с гладкими нормалями: нормаль вершины —
 * сумма нормалей соседних граней (взвешенных площадью). wrap — столбцы замкнуты
 * в кольцо. outward(i, j) — направление «наружу» у точки: по нему выбирается
 * обход, чтобы нормали смотрели из тела. pick(i, j) — материал грани (i, j)
 * или null — грань не рисуется. Вершины общие внутри материала: на границе
 * областей рисунка они дублируются с той же нормалью — стык не виден.
 */
function surface(grid, { wrap = false, outward, pick }) {
  const id = surfaceCount++;
  const rows = grid.length;
  const cols = grid[0].length;
  const quadCols = wrap ? cols : cols - 1;
  const corners = (i, j) => [grid[i][j], grid[i][(j + 1) % cols], grid[i + 1][(j + 1) % cols], grid[i + 1][j]];
  const faceNormal = ([a, b, c, d]) => add(cross(sub(b, a), sub(d, a)), cross(sub(d, c), sub(b, c)));

  // Обход: большинство граней должно смотреть наружу.
  let vote = 0;
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < quadCols; j++) vote += Math.sign(dot(faceNormal(corners(i, j)), outward(i, j)));
  }
  const flip = vote < 0;

  const normals = grid.map((row) => row.map(() => [0, 0, 0]));
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < quadCols; j++) {
      const n = scale(faceNormal(corners(i, j)), flip ? -1 : 1);
      for (const [di, dj] of [
        [0, 0],
        [0, 1],
        [1, 1],
        [1, 0],
      ]) {
        const target = normals[i + di][(j + dj) % cols];
        target[0] += n[0];
        target[1] += n[1];
        target[2] += n[2];
      }
    }
  }

  const vertex = (target, i, j) => {
    const key = `${id}:${i}:${j % cols}`;
    let index = target.vertexOf.get(key);
    if (index === undefined) {
      index = target.positions.length / 3;
      target.vertexOf.set(key, index);
      target.positions.push(...grid[i][j % cols]);
      target.normals.push(...normalize(normals[i][j % cols]));
    }
    return index;
  };
  const triangle = (target, [ia, ja], [ib, jb], [ic, jc]) => {
    const a = grid[ia][ja % cols];
    const b = grid[ib][jb % cols];
    const c = grid[ic][jc % cols];
    // У кромок и полюсов точки сходятся: вырожденный треугольник не рисуется.
    if (Math.hypot(...cross(sub(b, a), sub(c, a))) < MIN_DOUBLE_AREA_M2) return;
    target.indices.push(vertex(target, ia, ja), vertex(target, ib, jb), vertex(target, ic, jc));
  };

  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < quadCols; j++) {
      const target = pick(i, j);
      if (!target) continue;
      const q = [
        [i, j],
        [i, j + 1],
        [i + 1, j + 1],
        [i + 1, j],
      ];
      const [a, b, c, d] = flip ? [q[0], q[3], q[2], q[1]] : q;
      triangle(target, a, b, c);
      triangle(target, a, c, d);
    }
  }
}

/** Плоский многоугольник-веер (торец купола): своя нормаль, свои вершины. */
function flatPolygon(target, points, outward) {
  let n = [0, 0, 0];
  for (let k = 1; k + 1 < points.length; k++) n = add(n, cross(sub(points[k], points[0]), sub(points[k + 1], points[0])));
  const ordered = dot(n, outward) < 0 ? [...points].reverse() : points;
  const normal = normalize(dot(n, outward) < 0 ? scale(n, -1) : n);
  const base = target.positions.length / 3;
  for (const p of ordered) {
    target.positions.push(...p);
    target.normals.push(...normal);
  }
  for (let k = 1; k + 1 < ordered.length; k++) {
    const [a, b, c] = [ordered[0], ordered[k], ordered[k + 1]];
    if (Math.hypot(...cross(sub(b, a), sub(c, a))) < MIN_DOUBLE_AREA_M2) continue;
    target.indices.push(base, base + k, base + k + 1);
  }
}

/* ── Купол ───────────────────────────────────────────────────────────────── */

/** Профиль NACA 00xx: полутолщина на доле хорды u ∈ [0, 1] (замкнутая задняя кромка). */
function halfThickness(u) {
  return 5 * THICKNESS * (0.2969 * Math.sqrt(u) - 0.126 * u - 0.3516 * u ** 2 + 0.2843 * u ** 3 - 0.1036 * u ** 4);
}

/** Средняя линия: простая парабола с максимумом CAMBER в середине хорды. */
function camber(u) {
  return 4 * CAMBER * u * (1 - u);
}

/** Надув по хорде: у кромок ноль, пузырь — ближе к носу, как у настоящих ячеек. */
function inflationAlongChord(u) {
  return Math.sin(Math.PI * u) ** 0.6;
}

/** Точки хорды для доли размаха t ∈ [0, 1]: края шеврона — ровно на рёбрах сетки. */
function chordSamples(t) {
  const axis = CHEVRON_ROOT_U + (CHEVRON_TIP_U - CHEVRON_ROOT_U) * t;
  const [front, back] = [axis - CHEVRON_HALF_WIDTH, axis + CHEVRON_HALF_WIDTH];
  const u = [];
  // До полосы — гуще у передней кромки: там профиль гнётся сильнее.
  for (let k = 0; k <= FRONT_SAMPLES; k++) u.push(front * (1 - Math.cos(((k / FRONT_SAMPLES) * Math.PI) / 2)));
  for (let k = 1; k <= STRIPE_SAMPLES; k++) u.push(front + ((back - front) * k) / STRIPE_SAMPLES);
  for (let k = 1; k <= REAR_SAMPLES; k++) u.push(back + ((TRAILING_BAND_U - back) * k) / REAR_SAMPLES);
  for (let k = 1; k <= TRAILING_SAMPLES; k++) u.push(TRAILING_BAND_U + ((1 - TRAILING_BAND_U) * k) / TRAILING_SAMPLES);
  return u;
}

/** Номера граней по хорде, с которых начинаются полоса шеврона, белое поле и задняя полоса. */
const STRIPE_QUADS = [FRONT_SAMPLES, FRONT_SAMPLES + STRIPE_SAMPLES, FRONT_SAMPLES + STRIPE_SAMPLES + REAR_SAMPLES];

/**
 * Сечение купола на угле дуги theta: точки верха и низа по хорде. inflate —
 * доля надува верха (0 на нервюре, 1 в середине ячейки).
 */
function section(theta, inflate) {
  const t = Math.abs(theta) / (ARC_HALF_ANGLE_DEG * DEG);
  const chord = ROOT_CHORD_M * Math.max(TIP_CHORD_FRACTION, Math.sqrt(1 - t * t));
  const normal = [Math.sin(theta), Math.cos(theta), 0];
  const centre = [ARC_RADIUS_M * Math.sin(theta), CANOPY_TOP_M - ARC_RADIUS_M * (1 - Math.cos(theta)), 0];
  const leadingZ = LEADING_EDGE_FRACTION * chord - TIP_SWEEP_M * t * t;
  const at = (u, offset) => [centre[0] + normal[0] * offset, centre[1] + normal[1] * offset, leadingZ - u * chord];
  const u = chordSamples(t);
  return {
    u,
    upper: u.map((x) => at(x, (camber(x) + halfThickness(x) + INFLATION * inflate * inflationAlongChord(x)) * chord)),
    lower: u.map((x) => at(x, (camber(x) - halfThickness(x)) * chord)),
  };
}

/** Центр дуги купола: «наружу» для верха — от него. */
const ARC_CENTRE = [0, CANOPY_TOP_M - ARC_RADIUS_M, 0];
const thetaOf = (index, count) => (-1 + (2 * index) / count) * ARC_HALF_ANGLE_DEG * DEG;
const isTipCell = (cell) => cell < TIP_CELLS || cell >= CELLS - TIP_CELLS;

// Верх: CELL_SAMPLES точек на ячейку, между нервюрами — надув.
const upperRows = [];
for (let i = 0; i <= CELLS * CELL_SAMPLES; i++) {
  const s = (i % CELL_SAMPLES) / CELL_SAMPLES;
  upperRows.push(section(thetaOf(i, CELLS * CELL_SAMPLES), Math.sin(Math.PI * s)).upper);
}
surface(upperRows, {
  outward: (i, j) => sub(upperRows[i][j], ARC_CENTRE),
  pick: (i, j) => {
    if (isTipCell(Math.floor(i / CELL_SAMPLES))) return parts['canopy-trim'];
    if (j < STRIPE_QUADS[0]) return parts['canopy-primary'];
    if (j < STRIPE_QUADS[1]) return parts['canopy-trim'];
    if (j < STRIPE_QUADS[2]) return parts['canopy-secondary'];
    return parts['canopy-primary'];
  },
});

// Низ: по нервюрам, без надува; передняя полоса — входные отверстия.
const ribs = [];
for (let i = 0; i <= CELLS; i++) ribs.push(section(thetaOf(i, CELLS), 0));
const lowerRows = ribs.map((rib) => rib.lower);
surface(lowerRows, {
  outward: (i, j) => sub(ARC_CENTRE, lowerRows[i][j]),
  pick: (i, j) => ((ribs[i].u[j] + ribs[i].u[j + 1]) / 2 < INTAKE_U ? parts['canopy-intake'] : parts['canopy-underside']),
});

// Торцы купола — замкнуть профиль у законцовок.
for (const [rib, side] of [
  [ribs[0], -1],
  [ribs[CELLS], 1],
]) {
  const outline = [...rib.upper, ...[...rib.lower].reverse().slice(1, -1)];
  flatPolygon(parts['canopy-trim'], outline, [side * Math.cos(ARC_HALF_ANGLE_DEG * DEG), -Math.sin(ARC_HALF_ANGLE_DEG * DEG), 0]);
}

/* ── Пилот ───────────────────────────────────────────────────────────────── */

const X_AXIS = [1, 0, 0];

/**
 * Лофт вдоль пути в плоскости YZ: в каждой точке — эллипс с полуосями rx (по X)
 * и ry (поперёк пути). Концы с нулевым радиусом закрывают лофт в точку.
 */
function loft(path, segments, pick) {
  const rings = path.map((p, k) => {
    const tangent = normalize(sub(path[Math.min(k + 1, path.length - 1)].at, path[Math.max(k - 1, 0)].at));
    const across = normalize(cross(tangent, X_AXIS));
    return Array.from({ length: segments }, (_, j) => {
      const phi = (2 * Math.PI * j) / segments;
      return add(p.at, add(scale(X_AXIS, p.rx * Math.cos(phi)), scale(across, p.ry * Math.sin(phi))));
    });
  });
  const centres = path.map((p) => p.at);
  surface(rings, {
    wrap: true,
    outward: (i, j) => sub(rings[i][j], lerp(centres[i], centres[i + 1] ?? centres[i], 0.5)),
    pick: (i, j) => pick(i, j),
  });
}

/** Эллипсоид: кольца по широте от южного полюса к северному. */
function ellipsoid(centre, radii, target, { rings = 10, segments = 16, latRange = [-90, 90], lonRange = null } = {}) {
  const grid = [];
  for (let i = 0; i <= rings; i++) {
    const lat = (latRange[0] + ((latRange[1] - latRange[0]) * i) / rings) * DEG;
    const row = [];
    const count = lonRange ? segments + 1 : segments;
    for (let j = 0; j < count; j++) {
      const lon = lonRange ? (lonRange[0] + ((lonRange[1] - lonRange[0]) * j) / segments) * DEG : (2 * Math.PI * j) / segments;
      // Долгота 0 — вперёд (+Z), растёт к +X.
      row.push(add(centre, [radii[0] * Math.cos(lat) * Math.sin(lon), radii[1] * Math.sin(lat), radii[2] * Math.cos(lat) * Math.cos(lon)]));
    }
    grid.push(row);
  }
  surface(grid, { wrap: !lonRange, outward: (i, j) => sub(grid[i][j], centre), pick: () => target });
}

const HARNESS_SEGMENTS = 20;
/** Сечений у торса и конечностей: мельче — видны грани, как у прежней модели. */
const BODY_SEGMENTS = 16;
const LIMB_SEGMENTS = 12;

/**
 * Трубка по точкам limb с радиусами radii: руки, ноги, лямки. Сечение — круг
 * в плоскости, перпендикулярной оси; опорный вектор — не параллельный оси.
 * pick(i) — материал отрезка i (между точками i и i + 1).
 */
function tube(limb, radii, pick, segments = LIMB_SEGMENTS) {
  const rings = limb.map((at, k) => {
    const tangent = normalize(sub(limb[Math.min(k + 1, limb.length - 1)], limb[Math.max(k - 1, 0)]));
    const reference = Math.abs(tangent[1]) > 0.9 ? [0, 0, 1] : [0, 1, 0];
    const u = normalize(cross(tangent, reference));
    const v = normalize(cross(u, tangent));
    const r = radii[k];
    return Array.from({ length: segments }, (_, j) => {
      const phi = (2 * Math.PI * j) / segments;
      return add(at, add(scale(u, r * Math.cos(phi)), scale(v, r * Math.sin(phi))));
    });
  });
  const target = typeof pick === 'function' ? pick : () => pick;
  surface(rings, { wrap: true, outward: (i, j) => sub(rings[i][j], limb[i]), pick: (i) => target(i) });
}

/** Сустав — шарик на стыке трубок: без него на изгибе локтя и колена щель. */
const joint = (at, r, target) => ellipsoid(at, [r, r, r], target, { rings: 6, segments: LIMB_SEGMENTS });

/**
 * Рука: плечо → локоть → запястье, перчатка, манжета-акцент у запястья.
 * Радиусы — взрослый в куртке: плечо 5 см, локоть 4.4, запястье 3.4.
 */
function arm(target, shoulder, elbow, wrist, hand) {
  const cuff = lerp(elbow, wrist, 0.82);
  tube([shoulder, lerp(shoulder, elbow, 0.5), elbow], [0.052, 0.048, 0.044], target.jacket);
  joint(elbow, 0.044, target.jacket);
  tube([elbow, cuff, wrist], [0.044, 0.037, 0.034], (i) => (i === 1 ? target['jacket-accent'] : target.jacket));
  ellipsoid(hand, [0.042, 0.05, 0.036], target.gloves, { rings: 6, segments: 10 });
}

/** Шлем: вытянутый вперёд, полоса-акцент по верху от лба к затылку, визор. */
function helmet(target, centre) {
  ellipsoid(centre, [0.128, 0.14, 0.155], target.helmet, { rings: 12, segments: 18 });
  const shell = [0.131, 0.143, 0.158];
  for (const lon of [[-9, 9], [171, 189]]) {
    ellipsoid(centre, shell, target['jacket-accent'], { rings: 6, segments: 2, latRange: [5, 88], lonRange: lon });
  }
  ellipsoid(centre, [0.132, 0.144, 0.16], target.visor, { rings: 4, segments: 12, latRange: [-32, 14], lonRange: [-68, 68] });
}

/**
 * Торс по сечениям снизу вверх: таз (штаны), куртка, плечи, шея в воротнике.
 * at — середины сечений; наклон задаёт сама линия точек.
 */
function torso(target, rings) {
  loft(rings, BODY_SEGMENTS, (i) => (i < 2 ? target.pants : target.jacket));
}

/**
 * Кокон: от верха спинки (протектор) вниз к сиденью и вперёд к ногам —
 * пилот полулёжа, ноги по курсу. Полуоси — по габаритам подвесок-коконов.
 */
const pod = [
  { at: [0, 0.3, -0.5], rx: 0, ry: 0 },
  { at: [0, 0.29, -0.515], rx: 0.15, ry: 0.07 },
  { at: [0, 0.2, -0.52], rx: 0.21, ry: 0.12 },
  { at: [0, 0.02, -0.47], rx: 0.25, ry: 0.16 },
  { at: [0, -0.2, -0.32], rx: 0.27, ry: 0.19 },
  { at: [0, -0.3, -0.05], rx: 0.26, ry: 0.18 },
  { at: [0, -0.32, 0.25], rx: 0.23, ry: 0.155 },
  { at: [0, -0.3, 0.6], rx: 0.19, ry: 0.13 },
  { at: [0, -0.26, 0.9], rx: 0.14, ry: 0.1 },
  { at: [0, -0.22, 1.04], rx: 0.08, ry: 0.06 },
  { at: [0, -0.2, 1.09], rx: 0.03, ry: 0.025 },
  { at: [0, -0.195, 1.1], rx: 0, ry: 0 },
];
/** Полоса-акцент по бокам кокона: от сиденья до ног (грани кольца у ±X). */
const SIDE_STRIPE = new Set([0, 1, HARNESS_SEGMENTS / 2 - 1, HARNESS_SEGMENTS / 2, HARNESS_SEGMENTS / 2 + 1, HARNESS_SEGMENTS - 1]);
loft(pod, HARNESS_SEGMENTS, (i, j) => (i >= 4 && i <= 7 && SIDE_STRIPE.has(j) ? parts['harness-accent'] : parts.harness));

// Торс полулёжа — из кокона, спиной к протектору; шея в воротнике куртки.
torso(parts, [
  { at: [0, -0.2, -0.3], rx: 0, ry: 0 },
  { at: [0, -0.16, -0.3], rx: 0.16, ry: 0.11 },
  { at: [0, 0.05, -0.33], rx: 0.155, ry: 0.105 },
  { at: [0, 0.22, -0.36], rx: 0.19, ry: 0.125 },
  { at: [0, 0.34, -0.385], rx: 0.2, ry: 0.11 },
  { at: [0, 0.41, -0.4], rx: 0.15, ry: 0.08 },
  { at: [0, 0.45, -0.405], rx: 0.07, ry: 0.065 },
  { at: [0, 0.5, -0.41], rx: 0.058, ry: 0.058 },
  { at: [0, 0.52, -0.41], rx: 0, ry: 0 },
]);

// Руки — от плеч к тормозным клевантам у свободных концов.
for (const side of [1, -1]) {
  arm(parts, [side * 0.19, 0.37, -0.39], [side * 0.32, 0.24, -0.23], [side * 0.3, 0.41, -0.12], [side * 0.3, 0.45, -0.1]);
  joint([side * 0.19, 0.37, -0.39], 0.055, parts.jacket);
}

// Шлем — над воротником.
const HEAD = [0, 0.61, -0.41];
helmet(parts, HEAD);

/* ── Свободные концы и стропы ────────────────────────────────────────────── */

/** Карабины — начало координат по бокам; верх свободных концов — над плечами. */
const CARABINER = (side) => [side * 0.2, 0, -0.22];
const RISER_TOP = (side) => [side * 0.22, 0.55, -0.2];
for (const side of [1, -1]) {
  const [from, to] = [CARABINER(side), RISER_TOP(side)];
  const u = normalize(cross(sub(to, from), [0, 0, 1]));
  const v = [0, 0, 1];
  const rings = [from, to].map((at) =>
    Array.from({ length: 6 }, (_, j) => add(at, add(scale(u, 0.025 * Math.cos((2 * Math.PI * j) / 6)), scale(v, 0.012 * Math.sin((2 * Math.PI * j) / 6))))),
  );
  surface(rings, { wrap: true, outward: (i, j) => sub(rings[i][j], i === 0 ? from : to), pick: () => parts.risers });
}

/**
 * Ряды строп: доля хорды точки крепления и смещение верха свободного конца
 * по Z (ряд A — впереди). Тормозные — к задней кромке и в руку пилота.
 */
const ROWS = [
  { u: 0.12, riserZ: 0.05 },
  { u: 0.4, riserZ: 0 },
  { u: 0.68, riserZ: -0.05 },
  { u: 1, brake: true },
];
/** Несущие нервюры — через одну, без законцовочных. */
const LOAD_RIBS = Array.from({ length: CELLS - 1 }, (_, k) => k + 1).filter((k) => k % 2 === 1);
/** Каскад: верхние стропы по 3 сходятся в одну, средние по 3 — в нижнюю. */
const CASCADE = 3;
/** Доли пути к свободному концу, где сходятся верхние и средние стропы. */
const UPPER_JOIN = 0.25;
const MIDDLE_JOIN = 0.5;

/** Точка на низе купола у нервюры rib на доле хорды u. */
function lowerPoint(rib, u) {
  const theta = thetaOf(rib, CELLS);
  const t = Math.abs(theta) / (ARC_HALF_ANGLE_DEG * DEG);
  const chord = ROOT_CHORD_M * Math.max(TIP_CHORD_FRACTION, Math.sqrt(1 - t * t));
  const offset = (camber(u) - halfThickness(u)) * chord;
  const leadingZ = LEADING_EDGE_FRACTION * chord - TIP_SWEEP_M * t * t;
  return [
    ARC_RADIUS_M * Math.sin(theta) + Math.sin(theta) * offset,
    CANOPY_TOP_M - ARC_RADIUS_M * (1 - Math.cos(theta)) + Math.cos(theta) * offset,
    leadingZ - u * chord,
  ];
}

const chunks = (items, size) => Array.from({ length: Math.ceil(items.length / size) }, (_, k) => items.slice(k * size, k * size + size));

const linePositions = [];
const line = (a, b) => linePositions.push(...a, ...b);
for (const side of [1, -1]) {
  // От центра к законцовке: рядом стоящие нервюры сходятся в одну стропу.
  const sideRibs = LOAD_RIBS.filter((rib) => Math.sign(thetaOf(rib, CELLS)) === side).sort(
    (a, b) => Math.abs(thetaOf(a, CELLS)) - Math.abs(thetaOf(b, CELLS)),
  );
  for (const row of ROWS) {
    const bottom = row.brake ? [side * 0.3, 0.44, -0.1] : add(RISER_TOP(side), [0, 0, row.riserZ]);
    const upperGroups = chunks(
      sideRibs.map((rib) => lowerPoint(rib, row.u)),
      CASCADE,
    );
    const middles = upperGroups.map((group) => {
      const join = lerp(centroid(group), bottom, UPPER_JOIN);
      for (const attach of group) line(attach, join);
      return join;
    });
    for (const group of chunks(middles, CASCADE)) {
      const join = lerp(centroid(group), bottom, MIDDLE_JOIN);
      for (const middle of group) line(middle, join);
      line(join, bottom);
    }
  }
}

/* ── Пилот на земле: стоя, ноги, рюкзак ──────────────────────────────────── */

/**
 * На земле пилот стоит: точка трека — подвеска, на GROUND_BELOW_M выше земли
 * (калибровка трека по земле кладёт её на высоту подвесной системы). Сцена
 * переключает узлы по состоянию: в полёте — кокон, на земле — стоя, с ногами
 * и, когда крыло сложено, с рюкзаком.
 */
const GROUND_BELOW_M = 1;
const MATERIALS_OF_PILOT = ['harness', 'harness-accent', 'jacket', 'jacket-accent', 'pants', 'boots', 'gloves', 'helmet', 'visor'];
const partsOf = (names) => Object.fromEntries(names.map((name) => [name, part()]));
const standing = partsOf(MATERIALS_OF_PILOT);
const legs = { left: partsOf(['pants', 'boots']), right: partsOf(['pants', 'boots']) };
const backpack = partsOf(['harness', 'harness-accent']);

/**
 * Стоя — человек ростом ~1.78 м: земля на GROUND_BELOW_M ниже подвески.
 * Высоты над землёй: тазобедренный сустав 0.92 м, талия 1.07, грудь 1.3,
 * плечи 1.45, основание шеи 1.5, центр головы 1.66.
 */
const standingY = (aboveGroundM) => aboveGroundM - GROUND_BELOW_M;
torso(standing, [
  { at: [0, standingY(0.86), -0.05], rx: 0, ry: 0 },
  { at: [0, standingY(0.88), -0.05], rx: 0.15, ry: 0.1 },
  { at: [0, standingY(0.96), -0.05], rx: 0.175, ry: 0.115 },
  { at: [0, standingY(1.07), -0.05], rx: 0.155, ry: 0.105 },
  { at: [0, standingY(1.28), -0.04], rx: 0.19, ry: 0.125 },
  { at: [0, standingY(1.4), -0.05], rx: 0.205, ry: 0.115 },
  { at: [0, standingY(1.47), -0.06], rx: 0.165, ry: 0.085 },
  { at: [0, standingY(1.51), -0.06], rx: 0.07, ry: 0.065 },
  { at: [0, standingY(1.56), -0.06], rx: 0.058, ry: 0.058 },
  { at: [0, standingY(1.58), -0.06], rx: 0, ry: 0 },
]);
// Подвеска стоя: протектор на спине, лямки через плечи, грудная перемычка.
loft(
  [
    { at: [0, standingY(1.36), -0.2], rx: 0, ry: 0 },
    { at: [0, standingY(1.33), -0.2], rx: 0.15, ry: 0.05 },
    { at: [0, standingY(1.05), -0.21], rx: 0.19, ry: 0.07 },
    { at: [0, standingY(0.84), -0.19], rx: 0.17, ry: 0.07 },
    { at: [0, standingY(0.8), -0.18], rx: 0, ry: 0 },
  ],
  HARNESS_SEGMENTS,
  (i, j) => (i === 2 && SIDE_STRIPE.has(j) ? standing['harness-accent'] : standing.harness),
);
for (const side of [1, -1]) {
  const x = side * 0.11;
  tube(
    [
      [x, standingY(1.3), -0.19],
      [x, standingY(1.46), -0.12],
      [x, standingY(1.44), 0.03],
      [x, standingY(1.25), 0.085],
      [x, standingY(0.98), 0.07],
    ],
    [0.018, 0.02, 0.02, 0.02, 0.018],
    standing.harness,
    8,
  );
}
tube([[-0.13, standingY(1.24), 0.09], [0.13, standingY(1.24), 0.09]], [0.016, 0.016], standing['harness-accent'], 8);

// Руки вдоль тела, кисти перед бёдрами — держит свободные концы. Руки к голове
// (как в полёте на тормозах) стоя читались позой «сдаюсь».
for (const side of [1, -1]) {
  const shoulder = [side * 0.2, standingY(1.44), -0.06];
  arm(standing, shoulder, [side * 0.25, standingY(1.17), -0.02], [side * 0.22, standingY(0.98), 0.1], [side * 0.21, standingY(0.94), 0.12]);
  joint(shoulder, 0.055, standing.jacket);
}
helmet(standing, [0, standingY(1.66), -0.07]);

/**
 * Ноги — отдельные узлы с началом в бедре: сцена качает их вокруг оси X
 * (шаг). Бедро → колено → лодыжка, ботинок; подошва — на земле.
 */
const HIP_ABOVE_GROUND_M = 0.92;
const HIP = (side) => [side * 0.095, standingY(HIP_ABOVE_GROUND_M), -0.05];
for (const target of [legs.left, legs.right]) {
  const knee = [0, -0.42, 0.03];
  const ankle = [0, -(HIP_ABOVE_GROUND_M - 0.08), 0];
  tube([[0, 0, 0], lerp([0, 0, 0], knee, 0.5), knee], [0.08, 0.07, 0.056], target.pants);
  joint(knee, 0.056, target.pants);
  tube([knee, lerp(knee, ankle, 0.5), ankle], [0.056, 0.05, 0.043], target.pants);
  // Ботинок: голенище и носок; низ подошвы — ровно на земле.
  tube([[0, ankle[1] + 0.06, -0.005], [0, ankle[1] - 0.02, 0.0]], [0.05, 0.052], target.boots);
  ellipsoid([0, -HIP_ABOVE_GROUND_M + 0.045, 0.05], [0.055, 0.045, 0.125], target.boots, { rings: 6, segments: 12 });
}

// Рюкзак со сложенным крылом — за спиной, с полосой-акцентом.
ellipsoid([0, standingY(1.1), -0.38], [0.19, 0.28, 0.13], backpack.harness, { rings: 8, segments: 14 });
ellipsoid([0, standingY(1.1), -0.38], [0.195, 0.05, 0.135], backpack['harness-accent'], { rings: 2, segments: 14, latRange: [-40, 40] });

/* ── Сборка GLB ──────────────────────────────────────────────────────────── */

const FLOAT = 5126;
const UNSIGNED_SHORT = 5123;
const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;
const TRIANGLES = 4;
const LINES = 1;

const binary = [];
let byteLength = 0;
const gltf = {
  asset: { version: '2.0', generator: 'Skyline tools/make-paraglider.mjs' },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ name: 'paraglider', children: [] }],
  meshes: [],
  materials: [],
  accessors: [],
  bufferViews: [],
  buffers: [],
};

/** Буфер-вид, выровненный на 4 байта (требование glTF к смещениям). */
function addView(data, target) {
  const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const view = gltf.bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.length, target }) - 1;
  const padding = Buffer.alloc((4 - (bytes.length % 4)) % 4);
  binary.push(bytes, padding);
  byteLength += bytes.length + padding.length;
  return view;
}

function addVec3(values, withBounds) {
  const data = Float32Array.from(values);
  const accessor = { bufferView: addView(data, ARRAY_BUFFER), componentType: FLOAT, count: values.length / 3, type: 'VEC3' };
  if (withBounds) {
    accessor.min = [0, 1, 2].map((axis) => Math.min(...data.filter((_, i) => i % 3 === axis)));
    accessor.max = [0, 1, 2].map((axis) => Math.max(...data.filter((_, i) => i % 3 === axis)));
  }
  return gltf.accessors.push(accessor) - 1;
}

function addIndices(values) {
  const data = Uint16Array.from(values);
  return gltf.accessors.push({ bufferView: addView(data, ELEMENT_ARRAY_BUFFER), componentType: UNSIGNED_SHORT, count: values.length, type: 'SCALAR' }) - 1;
}

/** Материал по имени — один на модель, узлы делят его. */
const materialIndex = new Map();
function addMaterial(name) {
  if (materialIndex.has(name)) return materialIndex.get(name);
  const { color, alpha = 1, metallicFactor, roughnessFactor } = MATERIALS[name];
  const material = { name, pbrMetallicRoughness: { baseColorFactor: [...color, alpha], metallicFactor, roughnessFactor } };
  if (alpha < 1) material.alphaMode = 'BLEND';
  const index = gltf.materials.push(material) - 1;
  materialIndex.set(name, index);
  return index;
}

const pickParts = (source, names) => Object.fromEntries(names.map((name) => [name, source[name]]));
const CANOPY_MATERIALS = Object.keys(parts).filter((name) => name.startsWith('canopy-') || name === 'risers');

/**
 * Узлы модели — их имена сцена использует в nodeTransformations (glider-pose.ts):
 * купол со стропами и свободными концами (поднимается, опадает, прячется
 * в рюкзак), пилот в коконе (полёт), пилот стоя с ногами и рюкзак (земля).
 */
const NODES = [
  { name: 'canopy', parts: pickParts(parts, CANOPY_MATERIALS), lines: true },
  { name: 'pilot-seated', parts: pickParts(parts, MATERIALS_OF_PILOT) },
  { name: 'pilot-standing', parts: standing },
  { name: 'leg-left', parts: legs.left, translation: HIP(1) },
  { name: 'leg-right', parts: legs.right, translation: HIP(-1) },
  { name: 'backpack', parts: backpack },
];

for (const node of NODES) {
  const primitives = [];
  for (const [name, p] of Object.entries(node.parts)) {
    if (p.indices.length === 0) continue;
    if (p.positions.length / 3 > 0xffff) throw new Error(`${node.name}/${name}: больше 65 535 вершин — не влезает в UNSIGNED_SHORT`);
    primitives.push({
      attributes: { POSITION: addVec3(p.positions, true), NORMAL: addVec3(p.normals, false) },
      indices: addIndices(p.indices),
      material: addMaterial(name),
      mode: TRIANGLES,
    });
  }
  if (node.lines) primitives.push({ attributes: { POSITION: addVec3(linePositions, true) }, material: addMaterial('lines'), mode: LINES });
  const mesh = gltf.meshes.push({ name: node.name, primitives }) - 1;
  const index = gltf.nodes.push({ name: node.name, mesh, ...(node.translation ? { translation: node.translation } : {}) }) - 1;
  gltf.nodes[0].children.push(index);
}
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
const triangles = NODES.flatMap((node) => Object.values(node.parts)).reduce((n, p) => n + p.indices.length / 3, 0);
console.log(`${OUT}: ${glb.length} байт, ${triangles} треугольников, ${linePositions.length / 6} строп`);
