import { readTrack } from '@skyline/track-format';
import { afterEach, describe, expect, it } from 'vitest';

import { createPipelinePool, type PipelinePool } from './pool.js';
import { fourHourIgc, measureEventLoopLag, NOW, readFixture, repeatedIgc } from './testing/tracks.js';

const OPTIONS = { size: 1, timeoutS: 30, memoryLimitMb: 512 };
/** ТЗ §5.2: основной поток обязан отвечать быстрее 200 мс во время обработки. */
const MAX_MAIN_THREAD_LAG_MS = 200;

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
    // Таймаут выбран так, чтобы огромный трек его гарантированно пробил
    // (300 000 точек — это доли секунды счёта), а baseline на том же пуле прошёл.
    pool = createPipelinePool({ ...OPTIONS, timeoutS: 0.05 });

    const timedOut = await pool.run({ sourceFormat: 'igc', bytes: repeatedIgc(300_000), now: NOW });
    expect(timedOut).toMatchObject({ ok: false, errorCode: 'timeout' });

    const next = await pool.run({ sourceFormat: 'igc', bytes: readFixture('baseline.igc'), now: NOW });
    expect(next.ok, `code: ${next.ok ? '' : next.errorCode}`).toBe(true);
  });
});
