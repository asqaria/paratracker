#!/usr/bin/env node
/**
 * Skyline — генератор эталонных фикстур треков: IGC, GPX, KML, KMZ.
 *
 * Зачем: по CLAUDE.md алгоритмы пишутся от теста. Для граничных случаев
 * сгенерированный файл лучше скачанного — у него ИЗВЕСТЕН точный эталон,
 * и тест может сверять до знака, а не «примерно похоже».
 *
 * Реальные треки с приборов этот набор НЕ заменяет: они нужны, чтобы ловить
 * диалекты конкретных моделей. Здесь — только граничные случаи из ТЗ, задачи 0.8 и 1.2.
 *
 * Запуск:   node tools/make-fixtures.mjs [выходная_папка]
 * По умолчанию пишет в ./fixtures
 *
 * Пишет:    <case>.igc|gpx|kml|kmz — сам файл
 *           expected.json          — эталон для тестов парсеров
 *           README.md              — что каждый файл проверяет
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';

import { meanSeaLevel } from 'egm96-universal';

const OUT = process.argv[2] || 'fixtures';

/* ───────────────────────────────────────────────────────────────────────────
   Кодирование координат в формат IGC и обратно.

   ВАЖНО: эталон считается ОБРАТНЫМ декодированием того, что реально записано
   в файл. IGC хранит минуты с точностью 0.001 (≈1.85 м), поэтому исходное
   «красивое» число до файла не доживает. Тест должен сверяться с тем, что
   корректный парсер обязан получить, а не с тем, что мы задумывали.
   ─────────────────────────────────────────────────────────────────────────── */

/** Разложить градусы на (знак, целые градусы, тысячные доли минут). */
function split(deg, extraDigits = 0) {
  const sign = deg < 0 ? -1 : 1;
  const abs = Math.abs(deg);
  const d = Math.floor(abs);
  const scale = 1000 * Math.pow(10, extraDigits);
  let m = Math.round((abs - d) * 60 * scale);   // минуты × scale
  let dd = d;
  if (m >= 60 * scale) { m -= 60 * scale; dd += 1; }   // перенос на 60.000′
  return { sign, d: dd, m, scale };
}

/** Декодировать обратно — это и есть ожидаемое значение для теста. */
function decode({ sign, d, m, scale }) {
  return sign * (d + (m / scale) / 60);
}

function encodeLat(deg, extraDigits = 0) {
  const p = split(deg, extraDigits);
  const total = String(p.m).padStart(5 + extraDigits, '0');
  const base = total.slice(0, 5);
  const extra = total.slice(5);
  return {
    base: String(p.d).padStart(2, '0') + base + (p.sign < 0 ? 'S' : 'N'),
    extra,
    value: decode(p)
  };
}

function encodeLon(deg, extraDigits = 0) {
  const p = split(deg, extraDigits);
  const total = String(p.m).padStart(5 + extraDigits, '0');
  const base = total.slice(0, 5);
  const extra = total.slice(5);
  return {
    base: String(p.d).padStart(3, '0') + base + (p.sign < 0 ? 'W' : 'E'),
    extra,
    value: decode(p)
  };
}

/** Высота: 5 цифр, отрицательная пишется как -NNNN. */
function encodeAlt(m) {
  const v = Math.round(m);
  if (v < 0) return '-' + String(Math.min(9999, -v)).padStart(4, '0');
  return String(Math.min(99999, v)).padStart(5, '0');
}

const hhmmss = (s) => {
  const t = ((s % 86400) + 86400) % 86400;
  return String(Math.floor(t / 3600)).padStart(2, '0') +
         String(Math.floor(t / 60) % 60).padStart(2, '0') +
         String(t % 60).padStart(2, '0');
};

/* ───────────────────────────────────────────────────────────────────────────
   Детерминированная траектория. Без случайностей: один и тот же индекс
   всегда даёт одну и ту же точку, иначе эталон пришлось бы перегенерировать.
   ─────────────────────────────────────────────────────────────────────────── */
/**
 * Истинные параметры траектории trackPoint() на индекс (при шаге 1 с — на секунду).
 * Пишутся в expected.json как `trajectory` — эталон для тестов packages/analysis.
 * Метры здесь «генераторные»: градус широты = 111 320 м (сфера R ≈ 6 378 км).
 */
const TRAJECTORY = {
  cyclePoints: 480,          // 240 с набора по спирали, затем 240 с перехода
  climbPoints: 240,
  climbRateMs: 1.75,
  glideRateMs: -1.2,
  circlePeriodS: 20,
  circleRadiusM: 62,
  // x = R·sin(a), y = R·cos(a), a растёт: с севера на восток — по часовой.
  turnDirection: 'cw',
  turnRateDegS: 360 / 20,
  climbDriftEastMs: 1.4,
  climbDriftNorthMs: 0.5,
  glideEastMs: 10.6,
  glideNorthMs: 1.8,
  glideGroundSpeedMs: +Math.hypot(10.6, 1.8).toFixed(9),
  glideTrackDeg: +(Math.atan2(10.6, 1.8) * 180 / Math.PI).toFixed(9),
  metresPerDegreeLat: 111320
};

function trackPoint(i, origin) {
  const T = TRAJECTORY;
  const M_LAT = T.metresPerDegreeLat;
  const M_LON = T.metresPerDegreeLat * Math.cos(origin.lat * Math.PI / 180);
  const cycle = i % T.cyclePoints;
  const n = Math.floor(i / T.cyclePoints);
  let dx = n * 5400, dy = n * 900, alt = origin.alt + n * 420;

  if (cycle < T.climbPoints) {
    const a = (cycle / T.circlePeriodS) * Math.PI * 2;
    dx += T.circleRadiusM * Math.sin(a) + cycle * T.climbDriftEastMs;
    dy += T.circleRadiusM * Math.cos(a) - T.circleRadiusM + cycle * T.climbDriftNorthMs;
    alt += cycle * T.climbRateMs;
  } else {
    const g = cycle - T.climbPoints;
    dx += T.circleRadiusM * Math.sin(0) + T.climbPoints * T.climbDriftEastMs + g * T.glideEastMs;
    dy += -T.circleRadiusM + T.climbPoints * T.climbDriftNorthMs + g * T.glideNorthMs;
    alt += T.climbPoints * T.climbRateMs + g * T.glideRateMs;
  }
  return {
    lat: origin.lat + dy / M_LAT,
    lon: origin.lon + dx / M_LON,
    alt
  };
}

/* ───────────────────────────────────────────────────────────────────────────
   IGC
   ─────────────────────────────────────────────────────────────────────────── */
function buildIgc(cfg) {
  const {
    origin, count, startSec, step = 1,
    dateHeader, noBaro = false, negativeAlt = false,
    extraDigits = 0, gnssOffset = 48,
    vFixEvery = 0, gaps = [], junkAt = [], extensions = [],
    algHeader = null
  } = cfg;

  const lines = [];
  lines.push('AXCT Skyline fixture generator');
  lines.push(...dateHeader);
  lines.push('HFPLTPILOTINCHARGE:Test Pilot');
  lines.push('HFGTYGLIDERTYPE:Ozone Zeno 2');
  lines.push('HFGIDGLIDERID:FIXTURE');
  lines.push('HFDTM100GPSDATUM:WGS-1984');
  lines.push('HFFTYFRTYPE:Skyline,Fixture');
  if (algHeader) lines.push(algHeader);

  // I-запись: расширения B-записи
  let iRecord = null;
  if (extensions.length) {
    let pos = 36;
    const parts = [];
    for (const ext of extensions) {
      const start = pos, end = pos + ext.len - 1;
      parts.push(String(start).padStart(2, '0') + String(end).padStart(2, '0') + ext.code);
      pos = end + 1;
    }
    iRecord = 'I' + String(extensions.length).padStart(2, '0') + parts.join('');
    lines.push(iRecord);
  }

  const points = [];
  // Без округления toFixed(9) — по ним считается эталон сводки (summaryOf).
  const exact = [];
  let t = startSec;

  for (let i = 0; i < count; i++) {
    // разрывы: пропуск времени без записи точек
    for (const g of gaps) {
      if (g.afterIndex === i) t += g.seconds;
    }

    const p = trackPoint(i, origin);
    const altBase = negativeAlt ? p.alt - 3000 : p.alt;

    const la = encodeLat(p.lat, extraDigits);
    const lo = encodeLon(p.lon, extraDigits);
    const valid = vFixEvery > 0 && i % vFixEvery === 0 ? 'V' : 'A';
    const baro = noBaro ? '00000' : encodeAlt(altBase);
    const gnss = encodeAlt(altBase + gnssOffset);

    let ext = '';
    for (const e of extensions) {
      if (e.code === 'LAD') ext += la.extra;
      else if (e.code === 'LOD') ext += lo.extra;
      else if (e.code === 'FXA') ext += '012';
      else if (e.code === 'SIU') ext += '09';
      else if (e.code === 'GSP') ext += '0385';
      else if (e.code === 'ENL') ext += '000';
      else ext += '0'.repeat(e.len);
    }

    lines.push('B' + hhmmss(t) + la.base + lo.base + valid + baro + gnss + ext);

    points.push({
      index: i,
      timeUtcSeconds: t,
      lat: +la.value.toFixed(9),
      lon: +lo.value.toFixed(9),
      altBaro: noBaro ? null : Math.round(altBase),
      altGnss: Math.round(altBase + gnssOffset),
      valid: valid === 'A'
    });
    exact.push({
      timeUtcSeconds: t,
      lat: la.value,
      lon: lo.value,
      alt: noBaro ? toEllipsoid(Math.round(altBase + gnssOffset), la.value, lo.value, gnssDatumOf('igc', algHeader))
                  : Math.round(altBase)
    });

    t += step;
  }

  // мусорные строки — парсер обязан их пропустить, а не упасть
  for (const j of junkAt) lines.splice(j.at, 0, j.text);

  lines.push('LSKY Generated fixture — do not edit by hand');
  lines.push('GDEADBEEF00000000000000000000000000000000');

  // HFDTE150726 / HFDTEDATE:150726,01 → 2026-07-15 (YY < 80 → 20YY)
  const [, dd, mm, yy] = /(\d{2})(\d{2})(\d{2})/.exec(dateHeader[0]);
  const year = Number(yy) < 80 ? 2000 + Number(yy) : 1900 + Number(yy);

  return {
    content: Buffer.from(lines.join('\r\n') + '\r\n', 'latin1'),
    points,
    exact,
    date: `${year}-${mm}-${dd}`,
    dateHeaderRaw: dateHeader[0],
    algHeader,
    altitudeSource: noBaro ? 'gnss' : 'baro',
    iRecord,
    // Пустая строка — не ошибка, предупреждения она не заслуживает.
    // Считаем только непустой мусор: обрезанные B-записи, неизвестные типы, текст.
    minWarnings: junkAt.filter(j => j.text.trim() !== '').length
  };
}

/* ───────────────────────────────────────────────────────────────────────────
   GPX и KML: координаты — десятичные градусы текстом, эталон — то число,
   которое записано в файл (7 знаков, как у Garmin и телефонов). Высота —
   GNSS с одним знаком. Баро в этих форматах нет → altitudeSource 'gnss'
   и предупреждение no_baro_altitude у каждого файла.
   ─────────────────────────────────────────────────────────────────────────── */
const COORD_DECIMALS = 7;
const ELE_DECIMALS = 1;
const pad2 = (n) => String(n).padStart(2, '0');
const dayStartMs = (date) => Date.parse(`${date}T00:00:00Z`);

/** ISO 8601. offsetMin ≠ 0 — локальное время со смещением, как пишут телефоны. */
function isoTime(ms, offsetMin = 0, withMs = false) {
  const local = new Date(ms + offsetMin * 60000).toISOString().slice(0, withMs ? 23 : 19);
  if (offsetMin === 0) return `${local}Z`;
  const abs = Math.abs(offsetMin);
  return `${local}${offsetMin < 0 ? '-' : '+'}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
}

/** Точки с временем в секундах от полуночи даты; gaps — начало нового сегмента. */
function samplePoints({ origin, count, startSec, step = 1, gaps = [] }) {
  const points = [];
  let t = startSec;
  for (let i = 0; i < count; i++) {
    let segmentStart = i === 0;
    for (const g of gaps) {
      if (g.afterIndex === i) { t += g.seconds; segmentStart = true; }
    }
    const p = trackPoint(i, origin);
    points.push({
      i, t, segmentStart,
      latText: p.lat.toFixed(COORD_DECIMALS),
      lonText: p.lon.toFixed(COORD_DECIMALS),
      eleText: p.alt.toFixed(ELE_DECIMALS)
    });
    t += step;
  }
  return points;
}

const expectedPoint = (p, index, { timeUtcSeconds = p.t, valid = true, noEle = false } = {}) => ({
  index,
  timeUtcSeconds,
  lat: +(+p.latText).toFixed(9),
  lon: +(+p.lonText).toFixed(9),
  altBaro: null,
  altGnss: noEle ? null : +p.eleText,
  valid
});

function buildGpx(cfg) {
  const {
    date, noEle = false, tzOffsetMin = 0, fractionalMs = 0,
    fix2dEvery = 0, satellites = null, junkAfter = [], truncateLast = false
  } = cfg;
  const day = dayStartMs(date);
  const source = samplePoints(cfg);

  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="Skyline fixture generator" xmlns="http://www.topografix.com/GPX/1/1"' +
      ' xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">',
    `  <metadata><name>Тестовый полёт</name><author><name>Тест Пилот &amp; Ко</name></author><time>${isoTime(day)}</time></metadata>`,
    '  <trk><name>Skyline fixture</name>'
  ];

  const points = [];
  source.forEach((p, k) => {
    if (p.segmentStart) {
      if (k > 0) lines.push('    </trkseg>');
      lines.push('    <trkseg>');
    }
    const valid = !(fix2dEvery > 0 && p.i % fix2dEvery === 0);
    const open = `      <trkpt lat="${p.latText}" lon="${p.lonText}">`;
    const isLast = k === source.length - 1;

    if (truncateLast && isLast) {
      // Файл обрывается посреди точки — прибор выключился при записи.
      lines.push(`${open}<ele>${p.eleText.slice(0, 2)}`);
      return;
    }

    const children = [];
    if (!noEle) children.push(`<ele>${p.eleText}</ele>`);
    children.push(`<time>${isoTime(day + p.t * 1000 + fractionalMs, tzOffsetMin, fractionalMs !== 0)}</time>`);
    if (fix2dEvery > 0) children.push(`<fix>${valid ? '3d' : '2d'}</fix>`);
    if (satellites !== null) children.push(`<sat>${satellites}</sat>`);
    children.push('<extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>120</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions>');
    lines.push(`${open}${children.join('')}</trkpt>`);

    points.push(expectedPoint(p, points.length, { timeUtcSeconds: p.t + fractionalMs / 1000, valid, noEle }));
    for (const junk of junkAfter) {
      if (junk.afterIndex === p.i) lines.push(`      ${junk.text}`);
    }
  });

  let text = lines.join('\n');
  if (!truncateLast) text += '\n    </trkseg>\n  </trk>\n</gpx>\n';

  return {
    content: Buffer.from(text, 'utf8'),
    points,
    date,
    altitudeSource: 'gnss',
    // no_baro_altitude всегда; no_gnss_altitude без высот; по одному на битую точку; обрыв.
    minWarnings: 1 + (noEle ? 1 : 0) + junkAfter.filter(j => j.warns).length + (truncateLast ? 1 : 0)
  };
}

function kmlDocument(body) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2">',
    '<Document>',
    '  <name>Skyline fixture</name>',
    ...body,
    '</Document>',
    '</kml>'
  ].join('\n') + '\n';
}

function gxTrack(points, day, indent) {
  return [
    `${indent}<gx:Track>`,
    `${indent}  <altitudeMode>absolute</altitudeMode>`,
    ...points.map(p => `${indent}  <when>${isoTime(day + p.t * 1000)}</when>`),
    ...points.map(p => `${indent}  <gx:coord>${p.lonText} ${p.latText} ${p.eleText}</gx:coord>`),
    `${indent}</gx:Track>`
  ];
}

function buildGxTrackKml(cfg) {
  const day = dayStartMs(cfg.date);
  const source = samplePoints(cfg);
  const text = kmlDocument([
    '  <Placemark>',
    '    <name>Трек</name>',
    ...gxTrack(source, day, '    '),
    '  </Placemark>'
  ]);
  return {
    content: Buffer.from(text, 'utf8'),
    points: source.map((p, index) => expectedPoint(p, index)),
    date: cfg.date,
    altitudeSource: 'gnss',
    minWarnings: 1
  };
}

/**
 * gx:MultiTrack из сегментов, записанных в документ в ОБРАТНОМ порядке, плюс
 * отдельная метка с LineString того же пути — её парсер обязан проигнорировать,
 * раз в файле есть gx:Track со временем.
 */
function buildMultiTrackKml(cfg) {
  const day = dayStartMs(cfg.date);
  const source = samplePoints(cfg);
  const segments = [];
  for (const p of source) {
    if (p.segmentStart) segments.push([]);
    segments[segments.length - 1].push(p);
  }
  const text = kmlDocument([
    '  <Placemark>',
    '    <name>Сегменты</name>',
    '    <gx:MultiTrack>',
    ...segments.reverse().flatMap(seg => gxTrack(seg, day, '      ')),
    '    </gx:MultiTrack>',
    '  </Placemark>',
    '  <Placemark>',
    '    <name>Путь без времени</name>',
    '    <LineString><altitudeMode>absolute</altitudeMode><coordinates>',
    ...source.map(p => `      ${p.lonText},${p.latText},${p.eleText}`),
    '    </coordinates></LineString>',
    '  </Placemark>'
  ]);
  return {
    content: Buffer.from(text, 'utf8'),
    points: source.map((p, index) => expectedPoint(p, index)),
    date: cfg.date,
    altitudeSource: 'gnss',
    minWarnings: 1
  };
}

/** LineString без времени у точек; TimeSpan метки — после геометрии. Шаг ровно 1 с. */
function buildLineStringKml(cfg) {
  const day = dayStartMs(cfg.date);
  const source = samplePoints(cfg);
  const first = source[0], last = source[source.length - 1];
  const text = kmlDocument([
    '  <Placemark>',
    '    <name>Старый прибор</name>',
    '    <LineString>',
    '      <altitudeMode>absolute</altitudeMode>',
    '      <coordinates>',
    ...source.map(p => `        ${p.lonText},${p.latText},${p.eleText}`),
    '      </coordinates>',
    '    </LineString>',
    `    <TimeSpan><begin>${isoTime(day + first.t * 1000)}</begin><end>${isoTime(day + last.t * 1000)}</end></TimeSpan>`,
    '  </Placemark>'
  ]);
  return {
    content: Buffer.from(text, 'utf8'),
    points: source.map((p, index) => expectedPoint(p, index)),
    date: cfg.date,
    altitudeSource: 'gnss',
    // no_baro_altitude + timestamps_interpolated
    minWarnings: 2
  };
}

/* ── ZIP для KMZ: deflate + CRC-32, без внешних зависимостей ── */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zip(entries, date) {
  const [year, month, day] = date.split('-').map(Number);
  const dosDate = ((year - 1980) << 9) | (month << 5) | day;
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const compressed = deflateRawSync(entry.data);
    const crc = crc32(entry.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);            // версия для распаковки
    local.writeUInt16LE(8, 8);             // deflate
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + compressed.length;
  }

  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

/** KMZ = zip; doc.kml лежит НЕ первым — парсер обязан выбрать его, а не первый файл. */
function buildKmz(cfg) {
  const kml = buildGxTrackKml(cfg);
  return {
    ...kml,
    content: zip([
      { name: 'files/icon.png', data: Buffer.from('not really a png', 'latin1') },
      { name: 'doc.kml', data: kml.content }
    ], cfg.date)
  };
}

/* ───────────────────────────────────────────────────────────────────────────
   Набор случаев
   ─────────────────────────────────────────────────────────────────────────── */
const ALMATY = { lat: 43.128, lon: 76.955, alt: 2350 };
const ANDES  = { lat: -32.653, lon: -70.011, alt: 2800 };   // южное + западное полушарие
const DEAD   = { lat: 31.558, lon: 35.473, alt: 120 };      // ниже уровня моря
const FLIGHT_DATE = '2026-07-15';

const CASES = {
  'baseline.igc': {
    what: 'Эталонный нормальный трек. Всё как надо: 1 Гц, баро и GNSS, старый HFDTE, все фиксы A.',
    checks: 'Базовый разбор: количество точек, координаты, высоты, дата.',
    build: buildIgc,
    cfg: { origin: ALMATY, count: 960, startSec: 9 * 3600,
           dateHeader: ['HFDTE150726'] }
  },

  'no-baro.igc': {
    what: 'Прибор не пишет барометрическую высоту — все поля 00000.',
    checks: 'altitudeSource должен стать "gnss", в warnings — предупреждение. Вариометр считается по GNSS.',
    build: buildIgc,
    cfg: { origin: ALMATY, count: 480, startSec: 10 * 3600,
           dateHeader: ['HFDTE150726'], noBaro: true }
  },

  'alg-geo-phone.igc': {
    what: 'Телефон (XCTrack): HFALG:GEO, баро нет — высота над геоидом, как в реальных треках пилотов.',
    checks: 'GNSS-высота переводится в эллипсоид: h = H + N (EGM96). Трек не висит над рельефом на высоту геоида.',
    build: buildIgc,
    cfg: { origin: ALMATY, count: 120, startSec: 9 * 3600,
           dateHeader: ['HFDTE150726'], noBaro: true, algHeader: 'HFALG:GEO' }
  },

  'alg-ell.igc': {
    what: 'Логгер объявляет эллипсоид: HFALGALTGPS:ELL (как требует IGC FR Specification).',
    checks: 'Высота остаётся как есть — пересчёт только для геоида.',
    build: buildIgc,
    cfg: { origin: ALMATY, count: 120, startSec: 9 * 3600,
           dateHeader: ['HFDTE150726'], algHeader: 'HFALGALTGPS:ELL' }
  },

  'midnight.igc': {
    what: 'Полёт через полночь UTC: старт 23:50, финиш после 00:10 следующих суток.',
    checks: 'Время следующей B-записи МЕНЬШЕ предыдущей → +1 сутки. Без этого вся вторая половина трека уедет на день назад.',
    build: buildIgc,
    cfg: { origin: ALMATY, count: 1500, startSec: 23 * 3600 + 50 * 60,
           dateHeader: ['HFDTE150726'] }
  },

  'gaps.igc': {
    what: 'Два разрыва связи: 90 секунд и 12 минут.',
    checks: 'Разрыв 90 с НЕ влезает в Uint16 миллисекунд (потолок 65.5 с) — проверка таблицы разрывов из ТЗ §5.4. Оба помечаются флагом gap, интерполяция через них запрещена.',
    build: buildIgc,
    cfg: { origin: ALMATY, count: 720, startSec: 11 * 3600,
           dateHeader: ['HFDTE150726'],
           gaps: [{ afterIndex: 200, seconds: 90 }, { afterIndex: 500, seconds: 720 }] }
  },

  'south-west.igc': {
    what: 'Аргентинские Анды: отрицательная широта И отрицательная долгота.',
    checks: 'Знаки S и W. Классическая ошибка — потерять знак и отзеркалить трек в северное полушарие.',
    build: buildIgc,
    cfg: { origin: ANDES, count: 600, startSec: 14 * 3600,
           dateHeader: ['HFDTE221126'] }
  },

  'date-modern.igc': {
    what: 'Современный формат даты HFDTEDATE:DDMMYY,NN (с 2016 года).',
    checks: 'Парсер обязан понимать ОБА формата. На этом файле старая реализация не найдёт дату и уйдёт в fallback по имени файла.',
    build: buildIgc,
    cfg: { origin: ALMATY, count: 480, startSec: 8 * 3600 + 30 * 60,
           dateHeader: ['HFDTEDATE:150726,01'] }
  },

  'lad-lod.igc': {
    what: 'Расширения LAD и LOD — дополнительные знаки минут широты и долготы.',
    checks: 'Без их учёта точность координат ограничена 0.001′ ≈ 1.85 м, и радиус виража в детекции кругов заметно шумит. Координаты в эталоне посчитаны С учётом расширений.',
    build: buildIgc,
    cfg: { origin: ALMATY, count: 480, startSec: 12 * 3600,
           dateHeader: ['HFDTE150726'], extraDigits: 2,
           extensions: [{ code: 'LAD', len: 2 }, { code: 'LOD', len: 2 }] }
  },

  'sparse-10s.igc': {
    what: 'Шаг фиксов 10 секунд — типично для GPX с телефона и часов Garmin.',
    checks: 'Медианный шаг > 4 с → analysis_level = "basic". Детекцию термиков и ветра НЕ запускать: интерполяция срежет виражи хордами и накопление курса не наберёт 360°.',
    build: buildIgc,
    cfg: { origin: ALMATY, count: 200, startSec: 13 * 3600, step: 10,
           dateHeader: ['HFDTE150726'] }
  },

  'v-fixes.igc': {
    what: 'Каждый десятый фикс — 2D (флаг V вместо A).',
    checks: 'Точки с V помечаются и исключаются из расчёта вертикальной скорости, но остаются в треке.',
    build: buildIgc,
    cfg: { origin: ALMATY, count: 480, startSec: 15 * 3600,
           dateHeader: ['HFDTE150726'], vFixEvery: 10 }
  },

  'negative-alt.igc': {
    what: 'Высоты ниже уровня моря — формат -NNNN. Мёртвое море.',
    checks: 'Отрицательная высота не должна ломать парсер числа и не должна превращаться в 0.',
    build: buildIgc,
    cfg: { origin: DEAD, count: 360, startSec: 7 * 3600,
           dateHeader: ['HFDTE030426'], negativeAlt: true }
  },

  'extensions-full.igc': {
    what: 'Полный набор расширений B-записи: FXA, SIU, GSP, ENL.',
    checks: 'I-запись разбирается по позициям байтов, значения читаются по своим смещениям. FXA и SIU потом используются для фильтрации шума.',
    build: buildIgc,
    cfg: { origin: ALMATY, count: 480, startSec: 16 * 3600,
           dateHeader: ['HFDTE150726'],
           extensions: [{ code: 'FXA', len: 3 }, { code: 'SIU', len: 2 },
                        { code: 'GSP', len: 4 }, { code: 'ENL', len: 3 }] }
  },

  'broken-lines.igc': {
    what: 'Битые строки посреди валидного трека: обрезанная B-запись, мусор, неизвестный тип записи, пустая строка.',
    checks: 'ГЛАВНЫЙ тест устойчивости. Парсер обязан пропустить их, записать в warnings и продолжить — не бросить исключение. Количество валидных точек должно остаться прежним.',
    build: buildIgc,
    cfg: { origin: ALMATY, count: 480, startSec: 17 * 3600,
           dateHeader: ['HFDTE150726'],
           junkAt: [
             { at: 20,  text: 'B1701' },
             { at: 60,  text: 'Здесь был сбой прибора' },
             { at: 100, text: '' },
             { at: 140, text: 'Q99 unknown record type' },
             { at: 180, text: 'B170300431280N0769550EA0235002398EXTRA' }
           ] }
  },

  'baseline.gpx': {
    what: 'Нормальный GPX 1.1 как у Garmin: trkpt с ele и time, расширения TrackPointExtension, метаданные с автором по-русски.',
    checks: 'Базовый разбор GPX: точки, время ISO 8601, высота из ele. Баро нет → altitudeSource "gnss" и предупреждение. UTF-8 и сущности XML в метаданных.',
    build: buildGpx,
    cfg: { origin: ALMATY, count: 600, startSec: 9 * 3600, date: FLIGHT_DATE }
  },

  'no-ele.gpx': {
    what: 'Телефон не записал высоту: ни у одной точки нет <ele>.',
    checks: 'Парсер не падает: altGnss = null у всех точек и предупреждение no_gnss_altitude.',
    build: buildGpx,
    cfg: { origin: ALMATY, count: 300, startSec: 10 * 3600, date: FLIGHT_DATE, noEle: true }
  },

  'time-offset.gpx': {
    what: 'Время с часовым поясом (+05:00) и долями секунды (.500) — так пишут многие телефонные трекеры.',
    checks: 'Время приводится к UTC; доли секунды не теряются.',
    build: buildGpx,
    cfg: { origin: ALMATY, count: 300, startSec: 11 * 3600, date: FLIGHT_DATE,
           tzOffsetMin: 300, fractionalMs: 500 }
  },

  'segments.gpx': {
    what: 'Два <trkseg> с разрывом 90 секунд между ними.',
    checks: 'Сегменты склеиваются в один трек по времени; разрыв остаётся разрывом.',
    build: buildGpx,
    cfg: { origin: ALMATY, count: 480, startSec: 12 * 3600, date: FLIGHT_DATE,
           gaps: [{ afterIndex: 200, seconds: 90 }] }
  },

  'fix-2d.gpx': {
    what: 'Каждая десятая точка — <fix>2d</fix>; у всех точек <sat>7</sat>.',
    checks: '2D-фиксы помечаются valid = false, число спутников читается в siu.',
    build: buildGpx,
    cfg: { origin: ALMATY, count: 480, startSec: 13 * 3600, date: FLIGHT_DATE,
           fix2dEvery: 10, satellites: 7 }
  },

  'broken.gpx': {
    what: 'Битые точки посреди трека (широта 95°, нет времени, время не ISO), текстовый мусор между точками и файл, оборванный посреди последней точки.',
    checks: 'Парсер не бросает: битые точки пропущены с предупреждением, мусор проигнорирован, обрыв — предупреждение truncated_document, всё до обрыва сохранено.',
    build: buildGpx,
    cfg: { origin: ALMATY, count: 400, startSec: 14 * 3600, date: FLIGHT_DATE,
           truncateLast: true,
           junkAfter: [
             { afterIndex: 50, warns: true,
               text: '<trkpt lat="95.0000000" lon="76.9550000"><ele>2400.0</ele><time>2026-07-15T14:00:50Z</time></trkpt>' },
             { afterIndex: 100, warns: true,
               text: '<trkpt lat="43.1280000" lon="76.9550000"><ele>2400.0</ele></trkpt>' },
             { afterIndex: 150, warns: true,
               text: '<trkpt lat="43.1280000" lon="76.9550000"><time>15.07.2026 14:02</time></trkpt>' },
             { afterIndex: 200, warns: false, text: 'Здесь был сбой прибора < > &' }
           ] }
  },

  'gx-track.kml': {
    what: 'Google Earth KML с <gx:Track>: списки <when> и <gx:coord>, altitudeMode absolute.',
    checks: 'Время из <when> сопоставляется с <gx:coord> по порядку; координаты в порядке «долгота широта высота».',
    build: buildGxTrackKml,
    cfg: { origin: ALMATY, count: 600, startSec: 15 * 3600, date: FLIGHT_DATE }
  },

  'multitrack.kml': {
    what: '<gx:MultiTrack> из двух сегментов с разрывом 90 с, записанных в документ в обратном порядке, и рядом метка с LineString того же пути без времени.',
    checks: 'Сегменты склеиваются по времени, а не по порядку в документе. LineString игнорируется, раз есть gx:Track со временем.',
    build: buildMultiTrackKml,
    cfg: { origin: ALMATY, count: 480, startSec: 16 * 3600, date: FLIGHT_DATE,
           gaps: [{ afterIndex: 240, seconds: 90 }] }
  },

  'linestring-timespan.kml': {
    what: 'Старый прибор: только <LineString> без времени у точек, у метки <TimeSpan> (после геометрии).',
    checks: 'Время распределяется равномерно по TimeSpan, предупреждение timestamps_interpolated. Порядок элементов внутри метки не важен.',
    build: buildLineStringKml,
    cfg: { origin: ALMATY, count: 300, startSec: 17 * 3600, date: FLIGHT_DATE }
  },

  'gx-track.kmz': {
    what: 'KMZ — zip-архив (deflate) с doc.kml внутри; doc.kml лежит не первым файлом.',
    checks: 'Архив распаковывается, выбирается doc.kml, дальше — как gx-track.kml.',
    build: buildKmz,
    cfg: { origin: ALMATY, count: 480, startSec: 18 * 3600, date: FLIGHT_DATE }
  }
};

/* ───────────────────────────────────────────────────────────────────────────
   Генерация
   ─────────────────────────────────────────────────────────────────────────── */
mkdirSync(OUT, { recursive: true });

/* ───────────────────────────────────────────────────────────────────────────
   Эталон сводки полёта (задача 1.13) — по тем точкам, что реально записаны
   в файл, как их обязан получить парсер. Тест прогоняет summarizeFlight по
   разобранному треку и сверяет с этим до 1e-9.
   ─────────────────────────────────────────────────────────────────────────── */
/** = GEO.meanEarthRadiusM из packages/core: гаверсинус там и здесь один и тот же. */
const MEAN_EARTH_RADIUS_M = 6_371_008.8;
/** = CLEAN.maxInterpolationGapS: через разрыв дистанция не набегает. */
const MAX_INTERPOLATION_GAP_S = 30;

function haversine(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 +
            Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 2 * MEAN_EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

function summaryOf(points) {
  let distanceTrackM = 0;
  let maxAltM = -Infinity;
  let maxGainM = 0;
  let minAlt = Infinity;
  for (const [i, p] of points.entries()) {
    const prev = points[i - 1];
    if (prev && p.timeUtcSeconds - prev.timeUtcSeconds <= MAX_INTERPOLATION_GAP_S) {
      distanceTrackM += haversine(prev.lat, prev.lon, p.lat, p.lon);
    }
    maxAltM = Math.max(maxAltM, p.alt);
    minAlt = Math.min(minAlt, p.alt);
    maxGainM = Math.max(maxGainM, p.alt - minAlt);
  }
  return {
    durationS: points[points.length - 1].timeUtcSeconds - points[0].timeUtcSeconds,
    maxAltM,
    distanceTrackM,
    maxGainM
  };
}

/* ───────────────────────────────────────────────────────────────────────────
   Эталон суммарного набора (задача 2.12) — независимая реализация гистерезиса
   по записанным в файл точкам: подъём считается ступенями ≥ порога от
   последней опорной точки, спуск на порог переносит опору вниз.
   ─────────────────────────────────────────────────────────────────────────── */
/** = GAIN.hysteresisM из packages/core. */
const GAIN_HYSTERESIS_M = 5;

function totalGainOf(points) {
  let gain = 0;
  let ref = points[0].alt;
  for (const p of points) {
    if (p.alt - ref >= GAIN_HYSTERESIS_M) {
      gain += p.alt - ref;
      ref = p.alt;
    } else if (ref - p.alt >= GAIN_HYSTERESIS_M) {
      ref = p.alt;
    }
  }
  return gain;
}

/* ───────────────────────────────────────────────────────────────────────────
   Эталон упрощения трека для карты логбука (задача 2.11) — независимая
   реализация Дугласа–Пекера по записанным в файл точкам. Тест прогоняет
   simplifyTrack из packages/analysis и сверяет список оставленных точек.
   Проекция — равнопромежуточная у широты первой точки, расстояние — до
   отрезка (с зажимом), не до бесконечной прямой: у спирали термика отрезок
   и прямая дают разные ответы.
   ─────────────────────────────────────────────────────────────────────────── */
/** = SIMPLIFY из packages/core. */
const SIMPLIFY_TOLERANCE_M = 15;
const SIMPLIFY_MAX_POINTS = 1000;

function douglasPeucker(xs, ys, toleranceM) {
  const n = xs.length;
  const keep = new Array(n).fill(false);
  if (n === 0) return [];
  keep[0] = true;
  keep[n - 1] = true;
  const stack = [[0, n - 1]];
  while (stack.length > 0) {
    const [a, b] = stack.pop();
    let worst = -1;
    let worstDistance = 0;
    const dx = xs[b] - xs[a];
    const dy = ys[b] - ys[a];
    const lengthSq = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      let px = xs[i] - xs[a];
      let py = ys[i] - ys[a];
      if (lengthSq > 0) {
        const u = Math.max(0, Math.min(1, (px * dx + py * dy) / lengthSq));
        px -= u * dx;
        py -= u * dy;
      }
      const distance = Math.hypot(px, py);
      if (distance > worstDistance) {
        worstDistance = distance;
        worst = i;
      }
    }
    if (worst >= 0 && worstDistance > toleranceM) {
      keep[worst] = true;
      stack.push([a, worst], [worst, b]);
    }
  }
  return keep.flatMap((k, i) => (k ? [i] : []));
}

function simplifiedOf(points) {
  const k = (MEAN_EARTH_RADIUS_M * Math.PI) / 180;
  const cosLat0 = Math.cos((points[0].lat * Math.PI) / 180);
  const xs = points.map((p) => p.lon * cosLat0 * k);
  const ys = points.map((p) => p.lat * k);
  let toleranceM = SIMPLIFY_TOLERANCE_M;
  let indices = douglasPeucker(xs, ys, toleranceM);
  while (indices.length > SIMPLIFY_MAX_POINTS) {
    toleranceM *= 2;
    indices = douglasPeucker(xs, ys, toleranceM);
  }
  return { toleranceM, indices };
}

/* ───────────────────────────────────────────────────────────────────────────
   Датум GNSS-высоты — как в парсере (packages/parsing/src/altitude-datum.ts):
   IGC без HFALG, GEO, MSL, NKN — геоид (CIVL 7H §3.2.1); ELL — эллипсоид;
   NIL — высоты нет. Эталон altGnss — над эллипсоидом WGS84: h = H + N(lat, lon)
   по EGM96, по неокруглённым координатам фикса. Независимая проверка самой
   модели — packages/parsing/src/geoid.test.ts (узлы NGA).
   ─────────────────────────────────────────────────────────────────────────── */
function gnssDatumOf(format, algHeader) {
  if (format !== 'igc') return 'geoid'; // GPX <ele>, KML absolute — над уровнем моря
  const code = (algHeader?.split(':')[1] ?? '').trim().toUpperCase();
  if (code === 'ELL') return 'ellipsoid';
  if (code === 'NIL') return 'none';
  if (code === 'GEO' || code === 'MSL') return 'geoid';
  return 'assumed-geoid';
}

function toEllipsoid(altGnss, lat, lon, datum) {
  if (altGnss === null || datum === 'none') return null;
  return datum === 'ellipsoid' ? altGnss : altGnss + meanSeaLevel(lat, lon);
}

const expected = {};
const readme = [
  '# Эталонные фикстуры треков: IGC, GPX, KML, KMZ',
  '',
  'Сгенерированы `tools/make-fixtures.mjs`. **Руками не править** — перегенерируй скриптом.',
  '',
  'Каждый файл покрывает один граничный случай из ТЗ, задачи 0.8 и 1.2.',
  'Точные ожидаемые значения — в `expected.json`: координаты посчитаны обратным',
  'декодированием того, что реально записано в файл, поэтому тест может сверять до знака.',
  '',
  '> Этот набор НЕ заменяет реальные треки с приборов. Те нужны, чтобы ловить',
  '> диалекты конкретных моделей — их собирай отдельно и клади рядом.',
  '',
  '| Файл | Что внутри | Что проверяет |',
  '|---|---|---|'
];

for (const [name, spec] of Object.entries(CASES)) {
  const r = spec.build(spec.cfg);
  writeFileSync(join(OUT, name), r.content);

  const points = r.points;
  const format = name.split('.').pop();
  const declared = gnssDatumOf(format, r.algHeader);
  // Координаты для N — неокруглённые: у IGC из r.exact, у GPX/KML текст в файле и есть значение.
  const coordsAt = (i) => (r.exact ? r.exact[i] : points[i]);
  const ellipsoidal = points.map((p, i) => toEllipsoid(p.altGnss, coordsAt(i).lat, coordsAt(i).lon, declared));
  const datum = ellipsoidal.some((a) => a !== null) ? declared : 'none';
  const sample = (p) => ({ ...p, altGnss: ellipsoidal[p.index] });
  const last = points[points.length - 1];
  const mid = points[Math.floor(points.length / 2)];
  const steps = points.slice(1).map((p, i) => p.timeUtcSeconds - points[i].timeUtcSeconds)
                      .sort((a, b) => a - b);
  const altitudes = ellipsoidal;
  const hasAltitude = altitudes.every(a => a !== null);

  expected[name] = {
    description: spec.what,
    verifies: spec.checks,
    format: name.split('.').pop(),
    pointCount: points.length,
    date: r.date,
    dateHeaderRaw: r.dateHeaderRaw ?? null,
    altitudeSource: r.altitudeSource,
    gnssAltitudeDatum: datum,
    iRecord: r.iRecord ?? null,
    medianFixIntervalSeconds: steps[Math.floor(steps.length / 2)],
    maxFixIntervalSeconds: steps[steps.length - 1],
    invalidFixCount: points.filter(p => !p.valid).length,
    minWarnings: r.minWarnings,
    samples: { first: sample(points[0]), middle: sample(mid), last: sample(last) },
    bounds: {
      minLat: +Math.min(...points.map(p => p.lat)).toFixed(9),
      maxLat: +Math.max(...points.map(p => p.lat)).toFixed(9),
      minLon: +Math.min(...points.map(p => p.lon)).toFixed(9),
      maxLon: +Math.max(...points.map(p => p.lon)).toFixed(9),
      minAlt: hasAltitude ? Math.min(...altitudes) : null,
      maxAlt: hasAltitude ? Math.max(...altitudes) : null
    },
    trajectory: TRAJECTORY,
    summary: r.exact ? summaryOf(r.exact) : null,
    simplified: r.exact ? simplifiedOf(r.exact) : null,
    totalGainM: r.exact ? totalGainOf(r.exact) : null
  };

  readme.push(`| \`${name}\` | ${spec.what} | ${spec.checks} |`);
  console.log(`${name.padEnd(26)} ${String(points.length).padStart(5)} точек`);
}

writeFileSync(join(OUT, 'expected.json'), JSON.stringify(expected, null, 2) + '\n', 'utf8');
// Реальные треки не генерируются: их кладут руками, обезличенными
// (tools/anonymize-igc.mjs), с согласия владельца и с разметкой рядом.
readme.push(
  '',
  '## Реальные треки',
  '',
  'Не генерируются — лежат рядом с генерированными и при перегенерации не трогаются.',
  'Кладутся только с согласия владельца и обезличенными: `tools/anonymize-igc.mjs`',
  '(без пилота, крыла, серийного номера, места, комментариев и подписи).',
  'Разметка — в `<файл>.labels.json` рядом.',
  '',
  '| Файл | Что внутри | Что проверяет |',
  '|---|---|---|',
  '| `real-wind-thermals.igc` | 4 ч 54 мин, XCTrack, 1 Гц; термик в ветре ~35 км/ч; разметка владельца в `real-wind-thermals.labels.json` | Детекция термиков против ручной разметки (ТЗ §6.3, DoD фазы 2): подтверждённые находятся, пропущенный в ветре — одним термиком, пара кругов в слабом пузыре — не термик |'
);

writeFileSync(join(OUT, 'README.md'), readme.join('\n') + '\n', 'utf8');

console.log(`\nГотово: ${Object.keys(CASES).length} файлов + expected.json + README.md → ${OUT}/`);
