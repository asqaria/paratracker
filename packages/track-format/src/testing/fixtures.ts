import { readFileSync } from 'node:fs';

import { cleanAndDerive } from '@skyline/analysis';
import type { DerivedTrack, ParseResult, ParsedTrack } from '@skyline/core';
import { parseGpx, parseIgc } from '@skyline/parsing';
import { expect } from 'vitest';

/** Помощники тестов track-format. Из сборки исключены. */

const FIXTURES = new URL('../../../../fixtures/', import.meta.url);

/** Фикстуры датированы до 22.11.2026 — «сейчас» должно быть позже. */
const NOW = Date.UTC(2027, 0, 1);

function unwrap(result: ParseResult): ParsedTrack {
  if (!result.ok) throw new Error(`parse failed: ${result.code}`);
  return result.track;
}

/** Фикстура, прогнанная через разбор и чистку: то, что реально пойдёт в .track. */
export function derivedFixture(name: string): DerivedTrack {
  const bytes = readFileSync(new URL(name, FIXTURES));
  return cleanAndDerive(unwrap(name.endsWith('.gpx') ? parseGpx(bytes, { now: NOW }) : parseIgc(bytes, { now: NOW })));
}

/** Сверка колонок с допуском: формат квантует значения, точного равенства нет. */
export function expectClose(
  actual: ArrayLike<number> | undefined,
  wanted: ArrayLike<number>,
  tolerance: number,
  label: string,
): void {
  expect(actual, label).toBeDefined();
  const values = actual ?? [];
  expect(values.length, `${label}: length`).toBe(wanted.length);
  for (let i = 0; i < wanted.length; i++) {
    const a = values[i] ?? Number.NaN;
    const w = wanted[i] ?? Number.NaN;
    if (Number.isNaN(w)) expect(a, `${label}[${i}]`).toBeNaN();
    else expect(Math.abs(a - w), `${label}[${i}]: ${a} vs ${w}`).toBeLessThanOrEqual(tolerance);
  }
}

/** Разность курсов с учётом перехода через 360°. */
export function expectHeadingsClose(actual: ArrayLike<number> | undefined, wanted: ArrayLike<number>, tolerance: number): void {
  const values = actual ?? [];
  expect(values.length, 'heading: length').toBe(wanted.length);
  for (let i = 0; i < wanted.length; i++) {
    const a = values[i] ?? Number.NaN;
    const w = wanted[i] ?? Number.NaN;
    if (Number.isNaN(w)) {
      expect(a, `heading[${i}]`).toBeNaN();
      continue;
    }
    const diff = Math.abs(((a - w + 540) % 360) - 180);
    expect(diff, `heading[${i}]: ${a} vs ${w}`).toBeLessThanOrEqual(tolerance);
  }
}
