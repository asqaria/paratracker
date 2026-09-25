# Высоты GNSS: геоид → эллипсоид — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** После парсеров `altGnss` всегда над эллипсоидом WGS84: высоты над геоидом из IGC (`HFALG:GEO` и без заголовка), GPX и KML пересчитываются `h = H + N(lat, lon)` по EGM96.

**Architecture:** Модуль `geoid.ts` оборачивает пакет `egm96-universal`. Модуль `altitude-datum.ts` переводит заголовок IGC в датум и пересчитывает колонку `altGnss` на месте. Парсеры вызывают его в одном месте каждый: IGC — после `builder.finish()`, GPX и KML — в общем `finishTimedTrack`. Генератор фикстур считает ожидаемые эллипсоидальные высоты той же моделью по неокруглённым координатам.

**Tech Stack:** TypeScript strict, Vitest, pnpm workspaces + Turborepo, `egm96-universal@1.1.1` (MIT).

**Spec:** `docs/superpowers/specs/2026-09-25-altitude-datum-design.md`

## Global Constraints

- Все команды — с портативным Node 22 в начале PATH: `export PATH="/c/Users/Turar/AppData/Local/Temp/claude/C--Users-Turar-Desktop-paratracker/e5886c4f-0f01-4269-a6fa-dc597e0bc132/scratchpad/node-v22.23.2-win-x64:$PATH"`. Системный node v20 ломает тесты воркера.
- `egm96-universal` — точная версия `1.1.1` (`pnpm add -E`), только в `packages/parsing` и корневых devDependencies (для `tools/`).
- `packages/parsing` остаётся чистым: без сети, ФС, `process`. Новая зависимость добавляется в белый список eslint с комментарием.
- Сравнение высот на фикстурах — допуск 1e-9 (CLAUDE.md), не «примерно».
- Никаких магических чисел: коды датумов и константы — именованные, с комментарием-источником.
- Порог приёмки на реальных треках — ±10 м (спек, «Цель и критерий приёмки»).
- Перед каждым коммитом: `pnpm turbo test lint typecheck` — зелёное. Коммиты по-русски, с `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

1. **Заголовок `HFALG` после первой B-записи** — датум применяется ко всему треку, а не только к фиксам после заголовка (тест в задаче 3).
2. **Регистр и пробелы в значении** — `HFALG: geo ` понимается как `GEO` (тест в задаче 2).
3. **Долгота ±180 и представление 0…360** — `N(lat, 180)` равно `N(lat, −180)`, `N(43, 283.5)` равно `N(43, −76.5)` (тест в задаче 1).
4. **Прибор не пишет GNSS-высоту (все `00000`)** — колонка остаётся `NaN`, а не превращается в `N` ≈ −42 м: проверка «все нули» идёт до пересчёта (тест в задаче 3).
5. **Два заголовка `HFALG` с разными значениями** — действует первый, как у `HFDTE` (тест в задаче 3).

---

### Задача 1: модуль геоида

**Files:**
- Create: `packages/parsing/src/geoid.ts`
- Create: `packages/parsing/src/geoid.test.ts`
- Modify: `packages/parsing/package.json` (зависимость)
- Modify: `eslint.config.js:133-140` (белый список `packages/parsing/**`)

**Interfaces:**
- Produces: `geoidHeightM(latDeg: number, lonDeg: number): number` — высота геоида EGM96 над эллипсоидом WGS84, м.

- [ ] **Step 1: Установить зависимость**

Run: `pnpm --filter @skyline/parsing add -E egm96-universal@1.1.1`
Expected: в `packages/parsing/package.json` появилось `"egm96-universal": "1.1.1"`.

- [ ] **Step 2: Написать падающий тест**

`packages/parsing/src/geoid.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { geoidHeightM } from './geoid.js';

/**
 * Опорные значения — узлы сетки из исходного файла NGA WW15MGH.DAC
 * (EGM96 15′, INTEGER*2 big-endian, сантиметры; 721 строка с 90° N на юг,
 * 1440 столбцов с 0° E на восток — описание формата в readme.txt NGA).
 * Файл декодирован независимо от egm96-universal. В узле билинейная
 * интерполяция обязана вернуть значение узла ровно.
 */
const NGA_NODES: ReadonlyArray<[lat: number, lon: number, heightM: number]> = [
  [43, 76.5, -41.35], // Заилийский Алатау, ячейка реальных треков
  [43.25, 76.5, -44.1],
  [43, 76.75, -41.31],
  [43.25, 76.75, -44.1],
  [0, 0, 17.16],
  [90, 0, 13.61],
  [-90, 0, -29.53],
  [50.75, 5.75, 46.42],
  [-45, -70, 16.93],
];

const CENTIMETRE = 0.005;

describe('geoidHeightM — EGM96', () => {
  it.each(NGA_NODES)('узел сетки NGA %f, %f → %f м', (lat, lon, heightM) => {
    expect(Math.abs(geoidHeightM(lat, lon) - heightM)).toBeLessThan(CENTIMETRE);
  });

  it('внутри ячейки — билинейная интерполяция четырёх узлов', () => {
    // Старт реального трека: 43.1274, 76.4648 → ячейка [43, 43.25] × [76.25, 76.5].
    // Значение посчитано вручную из узлов WW15MGH.DAC: −42.7383 м.
    expect(Math.abs(geoidHeightM(43.1274, 76.4648) - -42.7383)).toBeLessThan(CENTIMETRE);
  });

  it('долгота 0…360 и −180…180 — одна и та же точка', () => {
    expect(geoidHeightM(43, 283.5)).toBeCloseTo(geoidHeightM(43, -76.5), 9);
    expect(geoidHeightM(43, -76.5)).toBeCloseTo(-34.58, 2); // узел NGA (43, 283.5)
    expect(geoidHeightM(10, 180)).toBeCloseTo(geoidHeightM(10, -180), 9);
  });

  it('детерминирован: одна точка — одно значение', () => {
    expect(geoidHeightM(43.1274, 76.4648)).toBe(geoidHeightM(43.1274, 76.4648));
  });
});
```

- [ ] **Step 3: Запустить — тест падает**

Run: `pnpm --filter @skyline/parsing test -- geoid`
Expected: FAIL — `Cannot find module './geoid.js'`.

- [ ] **Step 4: Реализация**

`packages/parsing/src/geoid.ts`:

```ts
import { meanSeaLevel } from 'egm96-universal';

/**
 * Высота геоида EGM96 над эллипсоидом WGS84, м — N в h = H + N.
 *
 * EGM96, а не более точная EGM2008: GNSS-приёмник переводит высоту в «уровень
 * моря» по встроенной EGM96, и отменить нужно ровно её (спек высот, «Модель
 * геоида»). Сетка NGA 15′, билинейная интерполяция. Пакет спрятан за этой
 * функцией: замена источника данных — правка одного файла.
 */
export function geoidHeightM(latDeg: number, lonDeg: number): number {
  return meanSeaLevel(latDeg, lonDeg);
}
```

- [ ] **Step 5: Белый список eslint**

В `eslint.config.js` блок `files: ['packages/parsing/**']`:

```js
  {
    // fflate — распаковка KMZ (zip): чистый JS без зависимостей, работает в worker и в браузере.
    // egm96-universal — сетка геоида EGM96 (NGA, 15′) и её интерполяция: чистый JS, данные
    // внутри модуля, без сети и ФС. Пересчёт GNSS-высот геоид → эллипсоид (спек высот).
    files: ['packages/parsing/**'],
    rules: {
      ...restrict(allowOnly('@skyline.core|fflate|egm96-universal', PURE_MESSAGE)),
      'no-restricted-globals': ['error', ...IO_GLOBALS],
    },
  },
```

- [ ] **Step 6: Тест проходит, линт и типы зелёные**

Run: `pnpm --filter @skyline/parsing test -- geoid && pnpm turbo lint typecheck --filter=@skyline/parsing`
Expected: 12 тестов PASS, lint и typecheck без ошибок.

- [ ] **Step 7: Commit**

```bash
git add packages/parsing/package.json pnpm-lock.yaml packages/parsing/src/geoid.ts packages/parsing/src/geoid.test.ts eslint.config.js
git commit -m "Парсинг: высота геоида EGM96 — обёртка egm96-universal, сверка с узлами NGA"
```

---

### Задача 2: датум GNSS-высоты и пересчёт колонки

**Files:**
- Modify: `packages/core/src/track.ts` (тип датума, поле в `TrackMeta`, комментарий к `altGnss`)
- Modify: `packages/core/src/parse.ts` (код предупреждения)
- Create: `packages/parsing/src/altitude-datum.ts`
- Create: `packages/parsing/src/altitude-datum.test.ts`

**Interfaces:**
- Consumes: `geoidHeightM(latDeg, lonDeg)` из задачи 1.
- Produces:
  - `GNSS_ALTITUDE_DATUMS = ['ellipsoid', 'geoid', 'assumed-geoid', 'none'] as const`, `type GnssAltitudeDatum` — в `@skyline/core`.
  - `TrackMeta.gnssAltitudeDatum?: GnssAltitudeDatum`.
  - Код предупреждения `'unknown_altitude_datum'`.
  - `igcAltitudeDatum(code: string | null): { datum: GnssAltitudeDatum; recognized: boolean }`.
  - `applyGnssDatum(points: TrackColumns, datum: GnssAltitudeDatum): GnssAltitudeDatum` — пересчитывает `points.altGnss` на месте; возвращает датум для `meta` (`'none'`, если GNSS-высоты нет ни в одной точке).

- [ ] **Step 1: Типы в core**

`packages/core/src/track.ts` — рядом с `TrackMeta`:

```ts
/**
 * Датум GNSS-высоты в исходном файле. После парсера altGnss всегда над
 * эллипсоидом WGS84 (CLAUDE.md), датум остаётся в meta для диагностики.
 * assumed-geoid — датум не объявлен, принят по CIVL Section 7H §3.2.1.
 */
export const GNSS_ALTITUDE_DATUMS = ['ellipsoid', 'geoid', 'assumed-geoid', 'none'] as const;
export type GnssAltitudeDatum = (typeof GNSS_ALTITUDE_DATUMS)[number];
```

В `TrackMeta` добавить поле:

```ts
  /** Датум GNSS-высоты в файле; заполняет парсер. */
  gnssAltitudeDatum?: GnssAltitudeDatum;
```

Комментарий у `altGnss` в `TrackPoint` и `TrackColumns` заменить на: `/** GNSS-высота над эллипсоидом WGS84, м (парсер пересчитывает из геоида). */`.

`packages/core/src/parse.ts` — в `PARSE_WARNING_CODES` после `'unexpected_datum'`:

```ts
  /** IGC HFALG с незнакомым кодом — высота принята над геоидом (CIVL 7H §3.2.1). */
  'unknown_altitude_datum',
```

- [ ] **Step 2: Написать падающий тест**

`packages/parsing/src/altitude-datum.test.ts`:

```ts
import type { TrackColumns } from '@skyline/core';
import { describe, expect, it } from 'vitest';

import { applyGnssDatum, igcAltitudeDatum } from './altitude-datum.js';
import { geoidHeightM } from './geoid.js';

const columns = (altGnss: number[]): TrackColumns => {
  const n = altGnss.length;
  return {
    t: Float64Array.from({ length: n }, (_, i) => i * 1000),
    lat: new Float64Array(n).fill(43.1274),
    lon: new Float64Array(n).fill(76.4648),
    altBaro: new Float64Array(n).fill(Number.NaN),
    altGnss: Float64Array.from(altGnss),
    valid: new Uint8Array(n).fill(1),
    fxa: new Float64Array(n).fill(Number.NaN),
    siu: new Float64Array(n).fill(Number.NaN),
  };
};
const N = geoidHeightM(43.1274, 76.4648);

describe('igcAltitudeDatum — код HF ALG (IGC FR Spec, прил. A3; CIVL 7H §3.2.3)', () => {
  it.each([
    ['ELL', 'ellipsoid'],
    ['GEO', 'geoid'],
    ['MSL', 'geoid'],
    ['NIL', 'none'],
    ['NKN', 'assumed-geoid'],
  ] as const)('%s → %s', (code, datum) => {
    expect(igcAltitudeDatum(code)).toEqual({ datum, recognized: true });
  });

  it('заголовка нет — геоид по умолчанию (CIVL 7H §3.2.1), это не ошибка', () => {
    expect(igcAltitudeDatum(null)).toEqual({ datum: 'assumed-geoid', recognized: true });
  });

  it('регистр и пробелы не важны', () => {
    expect(igcAltitudeDatum(' geo ')).toEqual({ datum: 'geoid', recognized: true });
  });

  it('незнакомый код — геоид по умолчанию, но с пометкой', () => {
    expect(igcAltitudeDatum('WGS')).toEqual({ datum: 'assumed-geoid', recognized: false });
  });
});

describe('applyGnssDatum', () => {
  it('геоид: h = H + N в каждой точке', () => {
    const points = columns([1935, 1940]);
    expect(applyGnssDatum(points, 'geoid')).toBe('geoid');
    expect(points.altGnss[0]).toBeCloseTo(1935 + N, 9);
    expect(points.altGnss[1]).toBeCloseTo(1940 + N, 9);
  });

  it('assumed-geoid пересчитывается так же', () => {
    const points = columns([1935]);
    applyGnssDatum(points, 'assumed-geoid');
    expect(points.altGnss[0]).toBeCloseTo(1935 + N, 9);
  });

  it('эллипсоид — без изменений', () => {
    const points = columns([1935]);
    expect(applyGnssDatum(points, 'ellipsoid')).toBe('ellipsoid');
    expect(points.altGnss[0]).toBe(1935);
  });

  it('NaN остаётся NaN — пропуск высоты не превращается в N', () => {
    const points = columns([Number.NaN, 1935]);
    applyGnssDatum(points, 'geoid');
    expect(points.altGnss[0]).toBeNaN();
  });

  it('none — высоты нет, даже если в B-записях были числа', () => {
    const points = columns([1935, 1940]);
    expect(applyGnssDatum(points, 'none')).toBe('none');
    expect(points.altGnss.every(Number.isNaN)).toBe(true);
  });

  it('GNSS-высоты нет ни в одной точке — в meta none, а не объявленный датум', () => {
    expect(applyGnssDatum(columns([Number.NaN, Number.NaN]), 'geoid')).toBe('none');
  });
});
```

- [ ] **Step 3: Запустить — тест падает**

Run: `pnpm --filter @skyline/core build && pnpm --filter @skyline/parsing test -- altitude-datum`
Expected: FAIL — `Cannot find module './altitude-datum.js'`.

- [ ] **Step 4: Реализация**

`packages/parsing/src/altitude-datum.ts`:

```ts
import type { GnssAltitudeDatum, TrackColumns } from '@skyline/core';

import { geoidHeightM } from './geoid.js';

/**
 * Код заголовка IGC HF ALG → датум GNSS-высоты.
 * IGC FR Specification, прил. A3: ELL — эллипсоид WGS84, GEO — геоид («approx
 * Sea Level»), NKN — неизвестен, NIL — высота не записана. MSL встречается
 * у приборов вместо GEO. Без заголовка и при NKN — геоид: так парапланерные
 * приборы писали всегда (CIVL Section 7H §3.2.1).
 */
export function igcAltitudeDatum(code: string | null): { datum: GnssAltitudeDatum; recognized: boolean } {
  switch (code?.trim().toUpperCase() ?? null) {
    case 'ELL':
      return { datum: 'ellipsoid', recognized: true };
    case 'GEO':
    case 'MSL':
      return { datum: 'geoid', recognized: true };
    case 'NIL':
      return { datum: 'none', recognized: true };
    case null:
    case '':
    case 'NKN':
      return { datum: 'assumed-geoid', recognized: true };
    default:
      return { datum: 'assumed-geoid', recognized: false };
  }
}

/**
 * Приводит GNSS-высоты к эллипсоиду WGS84 на месте: h = H + N(lat, lon).
 * N считается в точке фикса — там, где высота измерена, до чистки и ресэмплинга.
 * Возвращает датум для meta: none, если GNSS-высоты нет ни в одной точке.
 */
export function applyGnssDatum(points: TrackColumns, datum: GnssAltitudeDatum): GnssAltitudeDatum {
  const { altGnss, lat, lon } = points;
  if (datum === 'none') altGnss.fill(Number.NaN);
  if (datum === 'geoid' || datum === 'assumed-geoid') {
    for (let i = 0; i < altGnss.length; i++) {
      const height = altGnss[i] ?? Number.NaN;
      if (Number.isNaN(height)) continue;
      altGnss[i] = height + geoidHeightM(lat[i] ?? Number.NaN, lon[i] ?? Number.NaN);
    }
  }
  return altGnss.some((height) => !Number.isNaN(height)) ? datum : 'none';
}
```

- [ ] **Step 5: Тесты проходят**

Run: `pnpm --filter @skyline/core build && pnpm --filter @skyline/parsing test -- altitude-datum && pnpm turbo test lint typecheck`
Expected: новые тесты PASS; весь набор зелёный (модуль ещё никем не вызывается).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/track.ts packages/core/src/parse.ts packages/parsing/src/altitude-datum.ts packages/parsing/src/altitude-datum.test.ts
git commit -m "Парсинг: датум GNSS-высоты — код HF ALG и пересчёт колонки в эллипсоид"
```

---

### Задача 3: IGC — заголовок HFALG, пересчёт, эталоны фикстур

**Files:**
- Modify: `packages/parsing/src/igc.ts:305-395` (`parseIgc`)
- Modify: `packages/parsing/src/igc.test.ts` (эталонная строка ТЗ + новые тесты)
- Modify: `packages/parsing/src/testing/fixtures.ts` (сверка высот с допуском, датум)
- Modify: `tools/make-fixtures.mjs` (заголовок ALG, эллипсоидальные эталоны, две новые фикстуры)
- Modify: `package.json` (корневой devDependency `egm96-universal` для `tools/`)
- Regenerate: `fixtures/*.igc`, `fixtures/expected.json`, `fixtures/README.md`

**Interfaces:**
- Consumes: `igcAltitudeDatum`, `applyGnssDatum` (задача 2), `geoidHeightM` (задача 1).
- Produces: `parseIgc` возвращает `altGnss` над эллипсоидом и `meta.gnssAltitudeDatum`. В `expected.json` у каждого случая поле `gnssAltitudeDatum`; `samples.*.altGnss` и `bounds.minAlt/maxAlt` — эллипсоидальные.

- [ ] **Step 1: Падающие тесты парсера**

В `packages/parsing/src/igc.test.ts` добавить импорт `import { geoidHeightM } from './geoid.js';` и заменить ожидание в тесте «эталонная строка ТЗ §3.3»:

```ts
    expect(point).toMatchObject({ altBaro: 1752, valid: true });
    // Без HFALG высота над геоидом (CIVL 7H §3.2.1) → в эллипсоид.
    expect(point.altGnss).toBeCloseTo(1889 + geoidHeightM(point.lat, point.lon), 9);
```

И новый блок:

```ts
describe('датум GNSS-высоты (HF ALG)', () => {
  const N = geoidHeightM(46.776933333333, 13.149833333333);
  const altGnssOf = (...headers: string[]): number | null =>
    pointAt(parse(igc(...HEADER, ...headers, REFERENCE_FIX)).points, 0).altGnss;

  it.each([
    ['HFALG:GEO', 'geoid'],
    ['HFALGALTGPS:GEO', 'geoid'],
    ['HFALG:ELL', 'ellipsoid'],
    ['HFALGALTGPS:NKN', 'assumed-geoid'],
  ] as const)('%s → meta %s', (header, datum) => {
    expect(parse(igc(...HEADER, header, REFERENCE_FIX)).meta.gnssAltitudeDatum).toBe(datum);
  });

  it('GEO — высота переводится в эллипсоид, ELL — остаётся', () => {
    expect(altGnssOf('HFALG:GEO')).toBeCloseTo(1889 + N, 6);
    expect(altGnssOf('HFALG:ELL')).toBe(1889);
  });

  it('NIL — GNSS-высоты нет, даже если в B-записи число', () => {
    const track = parse(igc(...HEADER, 'HFALG:NIL', REFERENCE_FIX));
    expect(pointAt(track.points, 0).altGnss).toBeNull();
    expect(track.meta.gnssAltitudeDatum).toBe('none');
    expect(codes(track)).toContain('no_gnss_altitude');
  });

  it('заголовок после B-записей — действует на весь трек', () => {
    const track = parse(igc(...HEADER, REFERENCE_FIX, 'HFALG:ELL'));
    expect(pointAt(track.points, 0).altGnss).toBe(1889);
  });

  it('два заголовка — действует первый', () => {
    expect(altGnssOf('HFALG:ELL', 'HFALG:GEO')).toBe(1889);
  });

  it('незнакомый код — геоид и предупреждение со строкой', () => {
    const track = parse(igc(...HEADER, 'HFALG:WGS', REFERENCE_FIX));
    expect(track.meta.gnssAltitudeDatum).toBe('assumed-geoid');
    expect(track.warnings).toContainEqual({ code: 'unknown_altitude_datum', line: 3 });
  });

  it('прибор не пишет GNSS-высоту (00000) — NaN, а не высота геоида', () => {
    const track = parse(igc(...HEADER, 'B0940094646616N01308990EA0175200000'));
    expect(pointAt(track.points, 0).altGnss).toBeNull();
    expect(track.meta.gnssAltitudeDatum).toBe('none');
  });
});
```

- [ ] **Step 2: Запустить — тесты падают**

Run: `pnpm --filter @skyline/parsing test -- igc`
Expected: FAIL в «эталонная строка» (1889 вместо 1889 + N) и в новом блоке (`gnssAltitudeDatum` undefined).

- [ ] **Step 3: Реализация в `parseIgc`**

Импорт: `import { applyGnssDatum, igcAltitudeDatum } from './altitude-datum.js';`

Рядом с `let dateHeader`:

```ts
  let altitudeDatumHeader: { value: string; line: number } | null = null;
```

В разборе H-записи, после ветки `'DTM'`:

```ts
        } else if (subtype === 'ALG') {
          // HFALG:GEO и HFALGALTGPS:GEO — значение после двоеточия. Первый заголовок побеждает, как у HFDTE.
          altitudeDatumHeader ??= { value, line: lineNumber };
```

После проверки «все 00000» и до `summarizeAltitudes`:

```ts
  // После проверки нулей: иначе «высоты нет» превратилось бы в высоту геоида.
  const altitudeDatum = igcAltitudeDatum(altitudeDatumHeader?.value ?? null);
  if (!altitudeDatum.recognized) warnings.add('unknown_altitude_datum', altitudeDatumHeader?.line);
  meta.gnssAltitudeDatum = applyGnssDatum(points, altitudeDatum.datum);
```

- [ ] **Step 4: Тесты парсера проходят**

Run: `pnpm --filter @skyline/parsing test -- igc`
Expected: новые тесты PASS; тесты на фикстурах IGC FAIL (эталон ещё без пересчёта) — это ожидаемо, чинится в шагах 5–8.

- [ ] **Step 5: Корневая зависимость для генератора**

Run: `pnpm add -w -D -E egm96-universal@1.1.1`

- [ ] **Step 6: Генератор — заголовок ALG и эллипсоидальные эталоны**

В `tools/make-fixtures.mjs`:

1. Импорт: `import { meanSeaLevel } from 'egm96-universal';`
2. В `buildIgc` — параметр `algHeader = null` в деструктуризации `cfg`; после `lines.push('HFFTYFRTYPE:Skyline,Fixture');`:

```js
  if (algHeader) lines.push(algHeader);
```

и в возвращаемом объекте — `algHeader`.

3. Перед `const expected = {};`:

```js
/* ───────────────────────────────────────────────────────────────────────────
   Датум GNSS-высоты — как в парсере (packages/parsing/src/altitude-datum.ts):
   IGC без HFALG, GEO, MSL, NKN — геоид (CIVL 7H §3.2.1); ELL — эллипсоид;
   NIL — высоты нет. Эталон altGnss — над эллипсоидом WGS84: h = H + N(lat, lon)
   по EGM96, по неокруглённым координатам фикса. Независимая проверка самой
   модели — packages/parsing/src/geoid.test.ts (узлы NGA).
   ─────────────────────────────────────────────────────────────────────────── */
function gnssDatumOf(format, algHeader) {
  if (format !== 'igc') return 'ellipsoid'; // GPX и KML — задача 4
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
```

4. В цикле по `CASES`, после `const points = r.points;`:

```js
  const format = name.split('.').pop();
  const declared = gnssDatumOf(format, r.algHeader);
  // Координаты для N — неокруглённые: у IGC из r.exact, у GPX/KML текст в файле и есть значение.
  const coordsAt = (i) => (r.exact ? r.exact[i] : points[i]);
  const ellipsoidal = points.map((p, i) => toEllipsoid(p.altGnss, coordsAt(i).lat, coordsAt(i).lon, declared));
  const datum = ellipsoidal.some((a) => a !== null) ? declared : 'none';
  const sample = (p) => ({ ...p, altGnss: ellipsoidal[p.index] });
```

и заменить:
- `const altitudes = points.map(p => p.altGnss);` → `const altitudes = ellipsoidal;`
- `samples: { first: points[0], middle: mid, last },` → `samples: { first: sample(points[0]), middle: sample(mid), last: sample(last) },`
- добавить в объект эталона поле `gnssAltitudeDatum: datum,`

5. В `buildIgc` поле `alt` в `exact` для прибора без баро — эллипсоидальное (сводка по no-baro считается по GNSS):

```js
      alt: noBaro ? toEllipsoid(Math.round(altBase + gnssOffset), la.value, lo.value, gnssDatumOf('igc', algHeader))
                  : Math.round(altBase)
```

(функции `gnssDatumOf` и `toEllipsoid` объявлены как `function` — поднимаются, порядок в файле не важен).

6. Две новые фикстуры в `CASES` (после `'no-baro.igc'`):

```js
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
```

- [ ] **Step 7: Сверка высот в общих проверках фикстур**

`packages/parsing/src/testing/fixtures.ts`:

1. В `interface` эталона добавить `gnssAltitudeDatum: GnssAltitudeDatum;` (импорт типа из `@skyline/core`).
2. Помощник рядом с `expectDegrees`:

```ts
/** CLAUDE.md: эталон сверяется с допуском 1e-9, не «примерно». */
const EXACT = 1e-9;
export function expectMetres(actual: number | null, expected: number | null): void {
  if (expected === null) {
    expect(actual).toBeNull();
    return;
  }
  expect(actual).not.toBeNull();
  expect(Math.abs((actual ?? Number.NaN) - expected)).toBeLessThanOrEqual(EXACT);
}
```

3. В контрольной точке: `expect(point.altGnss).toBe(sample.altGnss);` → `expectMetres(point.altGnss, sample.altGnss);`
4. В границах: `expect(Math.min(...points.altGnss)).toBe(exp.bounds.minAlt);` → `expectMetres(Math.min(...points.altGnss), exp.bounds.minAlt);`, то же для `max`.
5. В `it('дата', …)` добавить: `expect(track.meta.gnssAltitudeDatum).toBe(exp.gnssAltitudeDatum);`

- [ ] **Step 8: Перегенерировать и прогнать всё**

Run: `node tools/make-fixtures.mjs && git status --short fixtures && pnpm turbo test lint typecheck`
Expected: изменились `expected.json`, `README.md`, добавлены `alg-geo-phone.igc` и `alg-ell.igc`; прочие файлы фикстур байт-в-байт прежние. Весь набор зелёный; тесты анализа, кроме сводки `no-baro.igc` (эталон пересчитан генератором), не меняются.

- [ ] **Step 9: Commit**

```bash
git add packages/parsing tools/make-fixtures.mjs package.json pnpm-lock.yaml fixtures
git commit -m "IGC: HFALG — высота над геоидом переводится в эллипсоид (CIVL 7H §3.2.1)"
```

---

### Задача 4: GPX и KML — высоты над уровнем моря в эллипсоид

**Files:**
- Modify: `packages/parsing/src/track-builder.ts:185-203` (`finishTimedTrack`)
- Modify: `packages/parsing/src/gpx.ts:169`, `packages/parsing/src/kml.ts:360`
- Modify: `packages/parsing/src/gpx.test.ts`, `packages/parsing/src/kml.test.ts`
- Modify: `tools/make-fixtures.mjs` (`gnssDatumOf` для GPX/KML)
- Regenerate: `fixtures/expected.json`

**Interfaces:**
- Consumes: `applyGnssDatum` (задача 2); генератор из задачи 3.
- Produces: `finishTimedTrack(builder, meta, warnings, now, gnssDatum: GnssAltitudeDatum)`.

- [ ] **Step 1: Падающие тесты**

`packages/parsing/src/gpx.test.ts` — импорт `import { geoidHeightM } from './geoid.js';`, помощник `parse` в файле уже есть:

```ts
describe('датум <ele>', () => {
  it('<ele> — над уровнем моря: переводится в эллипсоид, meta geoid', () => {
    const track = parse(
      '<gpx version="1.1"><trk><trkseg>' +
        '<trkpt lat="43.1274" lon="76.4648"><ele>1935.0</ele><time>2026-07-15T09:00:00Z</time></trkpt>' +
        '</trkseg></trk></gpx>',
    );
    expect(track.meta.gnssAltitudeDatum).toBe('geoid');
    expect(pointAt(track.points, 0).altGnss).toBeCloseTo(1935 + geoidHeightM(43.1274, 76.4648), 9);
  });
});
```

`packages/parsing/src/kml.test.ts` — тот же импорт `geoidHeightM`, помощник `parse` в файле уже есть:

```ts
describe('датум высоты', () => {
  it('altitudeMode absolute — над уровнем моря: переводится в эллипсоид, meta geoid', () => {
    const track = parse(
      '<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2">' +
        '<Document><Placemark><gx:Track><altitudeMode>absolute</altitudeMode>' +
        '<when>2026-07-15T09:00:00Z</when><gx:coord>76.4648 43.1274 1935</gx:coord>' +
        '</gx:Track></Placemark></Document></kml>',
    );
    expect(track.meta.gnssAltitudeDatum).toBe('geoid');
    expect(pointAt(track.points, 0).altGnss).toBeCloseTo(1935 + geoidHeightM(43.1274, 76.4648), 9);
  });
});
```

- [ ] **Step 2: Запустить — падают**

Run: `pnpm --filter @skyline/parsing test -- gpx kml`
Expected: FAIL — `gnssAltitudeDatum` undefined, высота 1935.

- [ ] **Step 3: Реализация**

`track-builder.ts`, `finishTimedTrack` — новый параметр и вызов перед `summarizeAltitudes`:

```ts
export function finishTimedTrack(
  builder: TrackBuilder,
  meta: TrackMeta,
  warnings: WarningLog,
  now: number,
  gnssDatum: GnssAltitudeDatum,
): ParseResult {
  const points = builder.finish();
  meta.gnssAltitudeDatum = applyGnssDatum(points, gnssDatum);
  const altitudeSource = summarizeAltitudes(points, warnings);
```

`gpx.ts`:

```ts
/** GPX 1.1 <ele> — «Elevation (in meters)»; Garmin и телефоны пишут над уровнем моря. */
const GPX_ELEVATION_DATUM: GnssAltitudeDatum = 'geoid';
…
  return finishTimedTrack(builder, reader.meta, warnings, options.now, GPX_ELEVATION_DATUM);
```

`kml.ts`:

```ts
/** KML: altitudeMode absolute — «relative to sea level» (OGC KML 2.2), EGM96. */
const KML_ALTITUDE_DATUM: GnssAltitudeDatum = 'geoid';
…
  return finishTimedTrack(builder, { date: null, dateSource: null }, warnings, options.now, KML_ALTITUDE_DATUM);
```

Генератор: в `gnssDatumOf` заменить `if (format !== 'igc') return 'ellipsoid'; // GPX и KML — задача 4` на:

```js
  if (format !== 'igc') return 'geoid'; // GPX <ele>, KML absolute — над уровнем моря
```

- [ ] **Step 4: Перегенерировать и прогнать всё**

Run: `node tools/make-fixtures.mjs && git status --short fixtures && pnpm turbo test lint typecheck`
Expected: изменился только `expected.json` (эталоны GPX/KML); весь набор зелёный.

- [ ] **Step 5: Commit**

```bash
git add packages/parsing tools/make-fixtures.mjs fixtures
git commit -m "GPX и KML: высота над уровнем моря переводится в эллипсоид"
```

---

### Задача 5: документация и приёмка на реальных треках

**Files:**
- Modify: `docs/SPEC.md:179` (строка `altGnss` в §3.4)
- Create: `tools/altitude-acceptance.mjs`

**Interfaces:**
- Consumes: собранный `packages/parsing/dist` (`parseIgc`).

- [ ] **Step 1: ТЗ §3.4**

`docs/SPEC.md`, строка 179:

```
  altGnss: number | null;  // м, над эллипсоидом WGS84 — парсер пересчитывает из геоида (HFALG, GPX, KML)
```

- [ ] **Step 2: Скрипт приёмки**

`tools/altitude-acceptance.mjs` — разбирает IGC из папки (по умолчанию `tracks/`) через `parseIgc` из `packages/parsing/dist/index.js`, берёт медиану `altGnss − рельеф` по фиксам первых и последних 60 с (одна точка шумит на ±10 м), рельеф — Re:Earth z14 с декодированием quantized-mesh и барицентрической интерполяцией (код функции `terrainHeight` — из замера в спеке), печатает таблицу и итог «в пределах ±10 м: да/нет». Имена пилотов в вывод не попадают: имя файла печатается без части до `_`.

```js
#!/usr/bin/env node
/**
 * Приёмка пересчёта высот (спек docs/superpowers/specs/2026-09-25-altitude-datum-design.md):
 * медиана «GNSS − рельеф» на старте и посадке должна быть в пределах ±10 м.
 * Запуск: pnpm --filter @skyline/parsing build && node tools/altitude-acceptance.mjs [папка]
 * Сеть: тайлы Re:Earth. Реальные треки в репозиторий не попадают (tracks/ в .gitignore).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseIgc } from '../packages/parsing/dist/index.js';

const DIR = process.argv[2] ?? 'tracks';
const TOLERANCE_M = 10;
const WINDOW_MS = 60_000;
const TERRAIN = 'https://terrain.reearth.land/cesium-mesh/ellipsoid';
const ZOOM = 14;
const QUANTIZED_MAX = 32767;
const HEADER_BYTES = 88;

const zigzag = (n) => (n >> 1) ^ -(n & 1);

async function terrainHeight(lat, lon) {
  const cols = 2 ** (ZOOM + 1), rows = 2 ** ZOOM;
  const x = Math.floor(((lon + 180) / 360) * cols), y = Math.floor(((lat + 90) / 180) * rows);
  const west = -180 + (x * 360) / cols, south = -90 + (y * 180) / rows;
  const response = await fetch(`${TERRAIN}/${ZOOM}/${x}/${y}.terrain?v=1.0.0`, {
    headers: { Accept: 'application/vnd.quantized-mesh,application/octet-stream;q=0.9' },
  });
  const view = new DataView(await response.arrayBuffer());
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
  const first = [], last = [];
  for (let i = 0; i < points.t.length; i++) {
    if (points.t[i] - t0 <= WINDOW_MS) first.push(i);
    if (t1 - points.t[i] <= WINDOW_MS) last.push(i);
  }
  const start = await offsetOver(points, first), end = await offsetOver(points, last);
  const ok = Math.abs(start) <= TOLERANCE_M && Math.abs(end) <= TOLERANCE_M;
  allOk &&= ok;
  console.log(`${file.replace(/^[^_]*_/, '<pilot>_')}  датум ${meta.gnssAltitudeDatum}  старт ${start.toFixed(1)} м  посадка ${end.toFixed(1)} м  ${ok ? 'OK' : 'ВНЕ ±10 м'}`);
}
console.log(allOk ? `\nВсе треки в пределах ±${TOLERANCE_M} м.` : `\nЕсть треки вне ±${TOLERANCE_M} м.`);
process.exitCode = allOk ? 0 : 1;
```

- [ ] **Step 3: Прогон приёмки**

Run: `pnpm --filter @skyline/parsing build && node tools/altitude-acceptance.mjs`
Expected: у всех четырёх треков `датум geoid`, медианы старта и посадки в пределах ±10 м (было +29…+45 м). Вывод целиком вставить в описание PR. Если какой-то трек вне порога — не подгонять порог: записать в PR и разобрать отдельно (открытый вопрос 4 спека).

- [ ] **Step 4: Полный прогон и коммит**

Run: `pnpm turbo build test lint typecheck`
Expected: 32 задачи зелёные.

```bash
git add docs/SPEC.md tools/altitude-acceptance.mjs
git commit -m "Высоты: ТЗ §3.4 — altGnss над эллипсоидом; скрипт приёмки на реальных треках"
```

- [ ] **Step 5: Визуальная проверка (CLAUDE.md: для 3D — скриншот)**

Поднять стек (docker compose с `--env-file .env`, API, воркер, веб), загрузить заново один трек из `tracks/`, открыть просмотрщик: старт и посадка — на рельефе, а не над ним. Скриншот — в PR.
