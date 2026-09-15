#!/usr/bin/env node
/**
 * Skyline — генератор эталонных IGC-фикстур.
 *
 * Зачем: по CLAUDE.md алгоритмы пишутся от теста. Для граничных случаев
 * сгенерированный файл лучше скачанного — у него ИЗВЕСТЕН точный эталон,
 * и тест может сверять до знака, а не «примерно похоже».
 *
 * Реальные треки с приборов этот набор НЕ заменяет: они нужны, чтобы ловить
 * диалекты конкретных моделей. Здесь — только граничные случаи из ТЗ, задача 0.8.
 *
 * Запуск:   node tools/make-fixtures.mjs [выходная_папка]
 * По умолчанию пишет в ./fixtures
 *
 * Пишет:    <case>.igc       — сам файл
 *           expected.json    — эталон для тестов парсера
 *           README.md         — что каждый файл проверяет
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

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
function trackPoint(i, origin) {
  const M_LAT = 111320;
  const M_LON = 111320 * Math.cos(origin.lat * Math.PI / 180);
  // 240 с набора по спирали, затем 240 с перехода, и так по кругу
  const cycle = i % 480;
  const n = Math.floor(i / 480);
  let dx = n * 5400, dy = n * 900, alt = origin.alt + n * 420;

  if (cycle < 240) {
    const a = (cycle / 20) * Math.PI * 2;        // круг за 20 с
    dx += 62 * Math.sin(a) + cycle * 1.4;
    dy += 62 * Math.cos(a) - 62 + cycle * 0.5;
    alt += cycle * 1.75;
  } else {
    const g = cycle - 240;
    dx += 62 * Math.sin(0) + 240 * 1.4 + g * 10.6;
    dy += -62 + 240 * 0.5 + g * 1.8;
    alt += 240 * 1.75 - g * 1.2;
  }
  return {
    lat: origin.lat + dy / M_LAT,
    lon: origin.lon + dx / M_LON,
    alt
  };
}

/* ───────────────────────────────────────────────────────────────────────────
   Сборка файла
   ─────────────────────────────────────────────────────────────────────────── */
function build(cfg) {
  const {
    origin, count, startSec, step = 1,
    dateHeader, noBaro = false, negativeAlt = false,
    extraDigits = 0, gnssOffset = 48,
    vFixEvery = 0, gaps = [], junkAt = [], extensions = []
  } = cfg;

  const lines = [];
  lines.push('AXCT Skyline fixture generator');
  lines.push(...dateHeader);
  lines.push('HFPLTPILOTINCHARGE:Test Pilot');
  lines.push('HFGTYGLIDERTYPE:Ozone Zeno 2');
  lines.push('HFGIDGLIDERID:FIXTURE');
  lines.push('HFDTM100GPSDATUM:WGS-1984');
  lines.push('HFFTYFRTYPE:Skyline,Fixture');

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
  let t = startSec;
  let skipped = 0;

  for (let i = 0; i < count; i++) {
    // разрывы: пропуск времени без записи точек
    for (const g of gaps) {
      if (g.afterIndex === i) { t += g.seconds; skipped++; }
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

    t += step;
  }

  // мусорные строки — парсер обязан их пропустить, а не упасть
  for (const j of junkAt) lines.splice(j.at, 0, j.text);

  lines.push('LSKY Generated fixture — do not edit by hand');
  lines.push('GDEADBEEF00000000000000000000000000000000');

  return { text: lines.join('\r\n') + '\r\n', points, iRecord, gapCount: skipped };
}

/* ───────────────────────────────────────────────────────────────────────────
   Набор случаев
   ─────────────────────────────────────────────────────────────────────────── */
const ALMATY = { lat: 43.128, lon: 76.955, alt: 2350 };
const ANDES  = { lat: -32.653, lon: -70.011, alt: 2800 };   // южное + западное полушарие
const DEAD   = { lat: 31.558, lon: 35.473, alt: 120 };      // ниже уровня моря

const CASES = {
  'baseline.igc': {
    what: 'Эталонный нормальный трек. Всё как надо: 1 Гц, баро и GNSS, старый HFDTE, все фиксы A.',
    checks: 'Базовый разбор: количество точек, координаты, высоты, дата.',
    cfg: { origin: ALMATY, count: 960, startSec: 9 * 3600,
           dateHeader: ['HFDTE150726'] }
  },

  'no-baro.igc': {
    what: 'Прибор не пишет барометрическую высоту — все поля 00000.',
    checks: 'altitudeSource должен стать "gnss", в warnings — предупреждение. Вариометр считается по GNSS.',
    cfg: { origin: ALMATY, count: 480, startSec: 10 * 3600,
           dateHeader: ['HFDTE150726'], noBaro: true }
  },

  'midnight.igc': {
    what: 'Полёт через полночь UTC: старт 23:50, финиш после 00:10 следующих суток.',
    checks: 'Время следующей B-записи МЕНЬШЕ предыдущей → +1 сутки. Без этого вся вторая половина трека уедет на день назад.',
    cfg: { origin: ALMATY, count: 1500, startSec: 23 * 3600 + 50 * 60,
           dateHeader: ['HFDTE150726'] }
  },

  'gaps.igc': {
    what: 'Два разрыва связи: 90 секунд и 12 минут.',
    checks: 'Разрыв 90 с НЕ влезает в Uint16 миллисекунд (потолок 65.5 с) — проверка таблицы разрывов из ТЗ §5.4. Оба помечаются флагом gap, интерполяция через них запрещена.',
    cfg: { origin: ALMATY, count: 720, startSec: 11 * 3600,
           dateHeader: ['HFDTE150726'],
           gaps: [{ afterIndex: 200, seconds: 90 }, { afterIndex: 500, seconds: 720 }] }
  },

  'south-west.igc': {
    what: 'Аргентинские Анды: отрицательная широта И отрицательная долгота.',
    checks: 'Знаки S и W. Классическая ошибка — потерять знак и отзеркалить трек в северное полушарие.',
    cfg: { origin: ANDES, count: 600, startSec: 14 * 3600,
           dateHeader: ['HFDTE221126'] }
  },

  'date-modern.igc': {
    what: 'Современный формат даты HFDTEDATE:DDMMYY,NN (с 2016 года).',
    checks: 'Парсер обязан понимать ОБА формата. На этом файле старая реализация не найдёт дату и уйдёт в fallback по имени файла.',
    cfg: { origin: ALMATY, count: 480, startSec: 8 * 3600 + 30 * 60,
           dateHeader: ['HFDTEDATE:150726,01'] }
  },

  'lad-lod.igc': {
    what: 'Расширения LAD и LOD — дополнительные знаки минут широты и долготы.',
    checks: 'Без их учёта точность координат ограничена 0.001′ ≈ 1.85 м, и радиус виража в детекции кругов заметно шумит. Координаты в эталоне посчитаны С учётом расширений.',
    cfg: { origin: ALMATY, count: 480, startSec: 12 * 3600,
           dateHeader: ['HFDTE150726'], extraDigits: 2,
           extensions: [{ code: 'LAD', len: 2 }, { code: 'LOD', len: 2 }] }
  },

  'sparse-10s.igc': {
    what: 'Шаг фиксов 10 секунд — типично для GPX с телефона и часов Garmin.',
    checks: 'Медианный шаг > 4 с → analysis_level = "basic". Детекцию термиков и ветра НЕ запускать: интерполяция срежет виражи хордами и накопление курса не наберёт 360°.',
    cfg: { origin: ALMATY, count: 200, startSec: 13 * 3600, step: 10,
           dateHeader: ['HFDTE150726'] }
  },

  'v-fixes.igc': {
    what: 'Каждый десятый фикс — 2D (флаг V вместо A).',
    checks: 'Точки с V помечаются и исключаются из расчёта вертикальной скорости, но остаются в треке.',
    cfg: { origin: ALMATY, count: 480, startSec: 15 * 3600,
           dateHeader: ['HFDTE150726'], vFixEvery: 10 }
  },

  'negative-alt.igc': {
    what: 'Высоты ниже уровня моря — формат -NNNN. Мёртвое море.',
    checks: 'Отрицательная высота не должна ломать парсер числа и не должна превращаться в 0.',
    cfg: { origin: DEAD, count: 360, startSec: 7 * 3600,
           dateHeader: ['HFDTE030426'], negativeAlt: true }
  },

  'extensions-full.igc': {
    what: 'Полный набор расширений B-записи: FXA, SIU, GSP, ENL.',
    checks: 'I-запись разбирается по позициям байтов, значения читаются по своим смещениям. FXA и SIU потом используются для фильтрации шума.',
    cfg: { origin: ALMATY, count: 480, startSec: 16 * 3600,
           dateHeader: ['HFDTE150726'],
           extensions: [{ code: 'FXA', len: 3 }, { code: 'SIU', len: 2 },
                        { code: 'GSP', len: 4 }, { code: 'ENL', len: 3 }] }
  },

  'broken-lines.igc': {
    what: 'Битые строки посреди валидного трека: обрезанная B-запись, мусор, неизвестный тип записи, пустая строка.',
    checks: 'ГЛАВНЫЙ тест устойчивости. Парсер обязан пропустить их, записать в warnings и продолжить — не бросить исключение. Количество валидных точек должно остаться прежним.',
    cfg: { origin: ALMATY, count: 480, startSec: 17 * 3600,
           dateHeader: ['HFDTE150726'],
           junkAt: [
             { at: 20,  text: 'B1701' },
             { at: 60,  text: 'Здесь был сбой прибора' },
             { at: 100, text: '' },
             { at: 140, text: 'Q99 unknown record type' },
             { at: 180, text: 'B170300431280N0769550EA0235002398EXTRA' }
           ] }
  }
};

/* ───────────────────────────────────────────────────────────────────────────
   Генерация
   ─────────────────────────────────────────────────────────────────────────── */
mkdirSync(OUT, { recursive: true });

const expected = {};
const readme = [
  '# Эталонные IGC-фикстуры',
  '',
  'Сгенерированы `tools/make-fixtures.mjs`. **Руками не править** — перегенерируй скриптом.',
  '',
  'Каждый файл покрывает один граничный случай из ТЗ, задача 0.8.',
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
  const r = build(spec.cfg);
  writeFileSync(join(OUT, name), r.text, 'latin1');

  const last = r.points[r.points.length - 1];
  const mid = r.points[Math.floor(r.points.length / 2)];
  const steps = r.points.slice(1).map((p, i) => p.timeUtcSeconds - r.points[i].timeUtcSeconds)
                        .sort((a, b) => a - b);

  expected[name] = {
    description: spec.what,
    verifies: spec.checks,
    pointCount: r.points.length,
    dateHeaderRaw: spec.cfg.dateHeader[0],
    altitudeSource: spec.cfg.noBaro ? 'gnss' : 'baro',
    iRecord: r.iRecord,
    medianFixIntervalSeconds: steps[Math.floor(steps.length / 2)],
    maxFixIntervalSeconds: steps[steps.length - 1],
    invalidFixCount: r.points.filter(p => !p.valid).length,
    // Пустая строка — не ошибка, предупреждения она не заслуживает.
    // Считаем только непустой мусор: обрезанные B-записи, неизвестные типы, текст.
    minWarnings: (spec.cfg.junkAt || []).filter(j => j.text.trim() !== '').length,
    samples: { first: r.points[0], middle: mid, last },
    bounds: {
      minLat: +Math.min(...r.points.map(p => p.lat)).toFixed(9),
      maxLat: +Math.max(...r.points.map(p => p.lat)).toFixed(9),
      minLon: +Math.min(...r.points.map(p => p.lon)).toFixed(9),
      maxLon: +Math.max(...r.points.map(p => p.lon)).toFixed(9),
      minAlt: Math.min(...r.points.map(p => p.altGnss)),
      maxAlt: Math.max(...r.points.map(p => p.altGnss))
    }
  };

  readme.push(`| \`${name}\` | ${spec.what} | ${spec.checks} |`);
  console.log(`${name.padEnd(22)} ${String(r.points.length).padStart(5)} точек`);
}

writeFileSync(join(OUT, 'expected.json'), JSON.stringify(expected, null, 2) + '\n', 'utf8');
writeFileSync(join(OUT, 'README.md'), readme.join('\n') + '\n', 'utf8');

console.log(`\nГотово: ${Object.keys(CASES).length} файлов + expected.json + README.md → ${OUT}/`);
