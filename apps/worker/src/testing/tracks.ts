import { readFileSync } from 'node:fs';

/** Помощники тестов воркера. Из сборки исключены. */

const FIXTURES = new URL('../../../../fixtures/', import.meta.url);

/** Фикстуры датированы до 22.11.2026 — «сейчас» должно быть позже. */
export const NOW = Date.UTC(2027, 0, 1);

export const readFixture = (name: string): Buffer => readFileSync(new URL(name, FIXTURES));

/**
 * IGC на заданное число точек (1 Гц) из фиксов baseline.igc: время идёт подряд,
 * квантование и форма — как в реальном треке. Время суток переполняется через
 * полночь, парсер это учитывает.
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

/** 4-часовой трек: 14 400 точек — контрольный размер из ТЗ §5.2. */
export const fourHourIgc = (): Buffer => repeatedIgc(14_400);

/** Максимальная задержка таймера за время работы: лаг основного потока. */
export function measureEventLoopLag(): { stop: () => number } {
  const intervalMs = 20;
  let worst = 0;
  let previous = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    worst = Math.max(worst, now - previous - intervalMs);
    previous = now;
  }, intervalMs);

  return {
    stop: () => {
      clearInterval(timer);
      return worst;
    },
  };
}
