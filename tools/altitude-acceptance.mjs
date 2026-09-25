#!/usr/bin/env node
/**
 * Приёмка пересчёта высот (спек docs/superpowers/specs/2026-09-25-altitude-datum-design.md):
 * медиана «GNSS − рельеф» по фиксам на земле — на старте и на посадке — должна быть в пределах ±10 м.
 * «На земле» — первые/последние 60 с записи и не дальше 30 м от первого/последнего фикса:
 * пилоты взлетают через 20–30 с после начала записи, и окно по времени захватывало полёт.
 * Запуск: pnpm --filter @skyline/parsing build && node tools/altitude-acceptance.mjs [папка]
 * Сеть: тайлы Re:Earth. Реальные треки в репозиторий не попадают (tracks/ в .gitignore).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseIgc } from '../packages/parsing/dist/index.js';

const DIR = process.argv[2] ?? 'tracks';
const TOLERANCE_M = 10;
const WINDOW_MS = 60_000;
/** Дальше этого от точки старта/посадки пилот уже бежит или летит — это не рельеф под ногами. */
const GROUND_RADIUS_M = 30;
const METRES_PER_DEGREE_LAT = 111_320;
const TERRAIN = 'https://terrain.reearth.land/cesium-mesh/ellipsoid';
const ZOOM = 14;
const QUANTIZED_MAX = 32767;
const HEADER_BYTES = 88;

const zigzag = (n) => (n >> 1) ^ -(n & 1);

/** Тайлы кешируются: соседние фиксы лежат в одном тайле, Re:Earth — бесплатный сервис без SLA. */
const tiles = new Map();
function tile(x, y) {
  const key = `${x}/${y}`;
  if (!tiles.has(key)) {
    tiles.set(key, fetch(`${TERRAIN}/${ZOOM}/${key}.terrain?v=1.0.0`, {
      headers: { Accept: 'application/vnd.quantized-mesh,application/octet-stream;q=0.9' },
    }).then((response) => response.arrayBuffer()));
  }
  return tiles.get(key);
}

async function terrainHeight(lat, lon) {
  const cols = 2 ** (ZOOM + 1), rows = 2 ** ZOOM;
  const x = Math.floor(((lon + 180) / 360) * cols), y = Math.floor(((lat + 90) / 180) * rows);
  const west = -180 + (x * 360) / cols, south = -90 + (y * 180) / rows;
  const view = new DataView(await tile(x, y));
  const minH = view.getFloat32(24, true), maxH = view.getFloat32(28, true);
  let offset = HEADER_BYTES;
  const n = view.getUint32(offset, true); offset += 4;
  const column = () => {
    const out = new Array(n); let v = 0;
    for (let i = 0; i < n; i++) { v += zigzag(view.getUint16(offset + i * 2, true)); out[i] = v; }
    offset += n * 2; return out;
  };
  const u = column(), v = column(), h = column();
  const wide = n > 65536;
  if (wide && offset % 4) offset += 4 - (offset % 4); else if (!wide && offset % 2) offset += 1;
  const triangles = view.getUint32(offset, true); offset += 4;
  const idx = new Array(triangles * 3); let highest = 0;
  for (let i = 0; i < triangles * 3; i++) {
    const code = wide ? view.getUint32(offset + i * 4, true) : view.getUint16(offset + i * 2, true);
    idx[i] = highest - code; if (code === 0) highest++;
  }
  const pu = ((lon - west) / (360 / cols)) * QUANTIZED_MAX, pv = ((lat - south) / (180 / rows)) * QUANTIZED_MAX;
  const H = (i) => minH + (h[i] / QUANTIZED_MAX) * (maxH - minH);
  for (let t = 0; t < triangles; t++) {
    const [a, b, c] = [idx[3 * t], idx[3 * t + 1], idx[3 * t + 2]];
    const d = (v[b] - v[c]) * (u[a] - u[c]) + (u[c] - u[b]) * (v[a] - v[c]);
    const l1 = ((v[b] - v[c]) * (pu - u[c]) + (u[c] - u[b]) * (pv - v[c])) / d;
    const l2 = ((v[c] - v[a]) * (pu - u[c]) + (u[a] - u[c]) * (pv - v[c])) / d;
    const l3 = 1 - l1 - l2;
    if (l1 >= -1e-9 && l2 >= -1e-9 && l3 >= -1e-9) return l1 * H(a) + l2 * H(b) + l3 * H(c);
  }
  return Number.NaN;
}

const median = (values) => {
  const s = values.filter(Number.isFinite).sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

async function offsetOver(points, indices) {
  const diffs = [];
  for (const i of indices) {
    const alt = points.altGnss[i];
    if (!Number.isFinite(alt)) continue;
    diffs.push(alt - (await terrainHeight(points.lat[i], points.lon[i])));
  }
  return median(diffs);
}

let allOk = true;
for (const file of readdirSync(DIR).filter((f) => f.toLowerCase().endsWith('.igc'))) {
  const result = parseIgc(readFileSync(join(DIR, file)), { now: Date.now() });
  if (!result.ok) { console.log(`${file}: не разобран (${result.code})`); allOk = false; continue; }
  const { points, meta } = result.track;
  const t0 = points.t[0], t1 = points.t[points.t.length - 1];
  const n = points.t.length;
  const distanceM = (i, j) => Math.hypot(
    (points.lat[i] - points.lat[j]) * METRES_PER_DEGREE_LAT,
    (points.lon[i] - points.lon[j]) * METRES_PER_DEGREE_LAT * Math.cos((points.lat[j] * Math.PI) / 180),
  );
  const first = [], last = [];
  for (let i = 0; i < n; i++) {
    if (points.t[i] - t0 <= WINDOW_MS && distanceM(i, 0) <= GROUND_RADIUS_M) first.push(i);
    if (t1 - points.t[i] <= WINDOW_MS && distanceM(i, n - 1) <= GROUND_RADIUS_M) last.push(i);
  }
  const start = await offsetOver(points, first), end = await offsetOver(points, last);
  const ok = Math.abs(start) <= TOLERANCE_M && Math.abs(end) <= TOLERANCE_M;
  allOk &&= ok;
  console.log(`${file.replace(/^[^_]*_/, '<pilot>_')}  датум ${meta.gnssAltitudeDatum}  старт ${start.toFixed(1)} м (${first.length} фикс.)  посадка ${end.toFixed(1)} м (${last.length} фикс.)  ${ok ? 'OK' : 'ВНЕ ±10 м'}`);
}
console.log(allOk ? `\nВсе треки в пределах ±${TOLERANCE_M} м.` : `\nЕсть треки вне ±${TOLERANCE_M} м.`);
process.exitCode = allOk ? 0 : 1;
