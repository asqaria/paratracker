import { PARSER } from '@skyline/core';
import { readTrack } from '@skyline/track-format';
import { afterEach, describe, expect, it } from 'vitest';

import { createPipelinePool, type PipelinePool } from './pool.js';
import { fourHourIgc, measureEventLoopLag, NOW, readFixture, repeatedIgc } from './testing/tracks.js';

const OPTIONS = { size: 1, timeoutS: 30, memoryLimitMb: 512 };
/** ТЗ §5.2: основной поток обязан отвечать быстрее 200 мс во время обработки. */
const MAX_MAIN_THREAD_LAG_MS = 200;
/**
 * Таймаут теста про отказ по времени. Зажат с двух сторон, и запас нужен с обеих:
 * трек предельного размера (PARSER.maxPoints) считается ≈1 с, то есть порог
 * пробивается втрое, а на более медленной машине — с ещё большим запасом;
 * baseline на восстановленном потоке — это ≈10 мс счёта, и остальное окно уходит
 * в запас на вытеснение потока. Прежние 50 мс запаса не давали: на общем раннере
 * CI baseline не получал процессор вовремя и тест падал вторым таймаутом.
 * Старт потока в окно не входит — таймер заводится после ready.
 */
const TIMEOUT_TEST_S = 0.3;

let pool: PipelinePool | undefined;
afterEach(async () => {
  await pool?.close();
  pool = undefined;
});

describe('пул worker_threads', () => {
  it('прогоняет parse → clean → derive → pack и отдаёт готовый .track', async () => {
    pool = createPipelinePool(OPTIONS);
    const progress: number[] = [];

    const result = await pool.run({ sourceFormat: 'igc', bytes: readFixture('baseline.igc'), now: NOW }, (value) =>
      progress.push(value),
    );

    expect(result.ok, `code: ${result.ok ? '' : result.errorCode}`).toBe(true);
    if (!result.ok) return;
    expect(result.pointCount).toBe(960);
    expect(result.analysisLevel).toBe('full');
    expect(result.altitudeSource).toBe('baro');
    // Датум GNSS-высоты доходит до основного потока — для логов (спек высот).
    expect(result.gnssAltitudeDatum).toBe('assumed-geoid');
    expect(readTrack(result.track).pointCount).toBe(960);
    expect(result.startedAt).toBe(Date.UTC(2026, 6, 15, 9));
    expect(result.durationS).toBe(959);

    expect(progress.at(-1)).toBe(1);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
  });

  it('битый файл — отказ с кодом, поток остаётся рабочим', async () => {
    pool = createPipelinePool(OPTIONS);

    const broken = await pool.run({ sourceFormat: 'igc', bytes: Buffer.from('это не трек'), now: NOW });
    expect(broken).toMatchObject({ ok: false, errorCode: 'no_fixes' });

    const good = await pool.run({ sourceFormat: 'igc', bytes: readFixture('baseline.igc'), now: NOW });
    expect(good.ok).toBe(true);
  });

  it('GPX и KMZ идут тем же конвейером', async () => {
    pool = createPipelinePool(OPTIONS);

    const gpx = await pool.run({ sourceFormat: 'gpx', bytes: readFixture('baseline.gpx'), now: NOW });
    const kmz = await pool.run({ sourceFormat: 'kml', bytes: readFixture('gx-track.kmz'), now: NOW });

    expect(gpx).toMatchObject({ ok: true, pointCount: 600 });
    expect(kmz).toMatchObject({ ok: true, pointCount: 480 });
  });

  it('обработка 4-часового трека не блокирует основной поток', async () => {
    pool = createPipelinePool(OPTIONS);
    const bytes = fourHourIgc();
    const lag = measureEventLoopLag();

    const result = await pool.run({ sourceFormat: 'igc', bytes, now: NOW });
    const worstLagMs = lag.stop();

    expect(result).toMatchObject({ ok: true, pointCount: 14_400 });
    expect(worstLagMs).toBeLessThan(MAX_MAIN_THREAD_LAG_MS);
  });

  it('задачи сверх размера пула ждут очереди, а не падают', async () => {
    const running = createPipelinePool({ ...OPTIONS, size: 2 });
    pool = running;
    const bytes = readFixture('baseline.igc');

    const results = await Promise.all(
      Array.from({ length: 5 }, () => running.run({ sourceFormat: 'igc', bytes, now: NOW })),
    );

    expect(results.every((result) => result.ok)).toBe(true);
  });

  it('превышение таймаута — код timeout, пул продолжает работать', async () => {
    pool = createPipelinePool({ ...OPTIONS, timeoutS: TIMEOUT_TEST_S });

    const timedOut = await pool.run({ sourceFormat: 'igc', bytes: repeatedIgc(PARSER.maxPoints), now: NOW });
    expect(timedOut).toMatchObject({ ok: false, errorCode: 'timeout' });

    const next = await pool.run({ sourceFormat: 'igc', bytes: readFixture('baseline.igc'), now: NOW });
    expect(next.ok, `code: ${next.ok ? '' : next.errorCode}`).toBe(true);
  });
});
