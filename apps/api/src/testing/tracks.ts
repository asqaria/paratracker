import { readFileSync } from 'node:fs';

/** Помощники сквозных тестов. Из сборки исключены. */

const FIXTURES = new URL('../../../../fixtures/', import.meta.url);

export const readFixture = (name: string): Buffer => readFileSync(new URL(name, FIXTURES));

/**
 * IGC на заданное число точек (1 Гц) из фиксов baseline.igc: время идёт подряд,
 * квантование и форма — как в реальном треке.
 */
export function repeatedIgc(pointCount: number): Buffer {
  const lines = readFixture('baseline.igc').toString('latin1').split('\r\n');
  const out = lines.filter((line) => !line.startsWith('B')).slice(0, -2);
  const fixes = lines.filter((line) => line.startsWith('B'));
  const hhmmss = (seconds: number): string => {
    const time = seconds % 86_400;
    return [Math.floor(time / 3600), Math.floor(time / 60) % 60, time % 60]
      .map((value) => String(value).padStart(2, '0'))
      .join('');
  };

  for (let i = 0; i < pointCount; i++) {
    out.push(`B${hhmmss(6 * 3600 + i)}${(fixes[i % fixes.length] ?? '').slice(7)}`);
  }
  return Buffer.from(out.join('\r\n'), 'latin1');
}

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
