import { PARSER, TRACK_FLAGS } from '@skyline/core';
import { readTrack } from '@skyline/track-format';
import { afterEach, describe, expect, it } from 'vitest';

import { createPipelinePool, type PipelinePool } from './pool.js';
import { fourHourIgc, measureEventLoopLag, NOW, readFixture, repeatedIgc } from './testing/tracks.js';

const OPTIONS = { size: 1, timeoutS: 30, memoryLimitMb: 512 };
/** ТЗ §5.2: основной поток обязан отвечать быстрее 200 мс во время обработки. */
const MAX_MAIN_THREAD_LAG_MS = 200;
/**
 * Таймаут теста про отказ по времени. Зажат с двух сторон, и запас нужен с обеих:
 * трек предельного размера (PARSER.maxPoints) с анализом полёта (задача 2.5)
 * считается ≈1.6 с локально и дольше на раннере CI — порог пробит с запасом;
 * baseline на восстановленном потоке — десятки миллисекунд счёта, но поток
 * холодный (JIT), и на общем раннере CI он не всегда сразу получает процессор.
 * 0.3 с хватало, пока в конвейере не было анализа: после 2.5 холодный baseline
 * в CI перестал укладываться. Старт потока в окно не входит — таймер заводится
 * после ready.
 */
const TIMEOUT_TEST_S = 1;
/**
 * Лимит vitest для этого теста. По умолчанию 5 с, а тест гоняет настоящие потоки
 * и 18.5 МБ входа: локально ≈0.85 с (генерация 0.13 с, снятие по таймауту 0.52 с,
 * восстановление 0.19 с), на медленном раннере CI — 5.03 с, и он падал по
 * общему лимиту, хотя таймаут пула и восстановление отработали. Проверяется
 * поведение, а не скорость: запас в ~6 раз от худшего замера в CI.
 */
const TIMEOUT_TEST_LIMIT_MS = 30_000;

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

  it('анализ полёта — в потоке: термики, глайды, ветер; точки термиков помечены в .track', async () => {
    pool = createPipelinePool(OPTIONS);
    const result = await pool.run({ sourceFormat: 'igc', bytes: readFixture('real-wind-thermals.igc'), now: NOW }, () => {});

    expect(result.ok, `code: ${result.ok ? '' : result.errorCode}`).toBe(true);
    if (!result.ok) return;
    const { analysis } = result;
    expect(analysis?.thermals.length).toBeGreaterThan(20);
    expect(analysis?.glides.length).toBeGreaterThan(20);
    expect(analysis?.wind?.speedMs).toBeGreaterThan(0);
    expect(analysis?.windProfile.length).toBeGreaterThan(0);

    const track = readTrack(result.track);
    const flags = track.flags ?? new Uint8Array();
    const inThermal = (i: number): boolean => ((flags[i] ?? 0) & TRACK_FLAGS.thermal) !== 0;
    for (const thermal of analysis?.thermals ?? []) {
      expect(inThermal(thermal.startIndex)).toBe(true);
      expect(inThermal(thermal.endIndex)).toBe(true);
    }
    const flagged = Array.from(flags).filter((flag) => (flag & TRACK_FLAGS.thermal) !== 0).length;
    const thermalPoints = (analysis?.thermals ?? []).reduce((sum, t) => sum + t.endIndex - t.startIndex + 1, 0);
    expect(flagged).toBe(thermalPoints);
  });

  it('редкий трек (basic) — без анализа: виражи срезаны хордами', async () => {
    pool = createPipelinePool(OPTIONS);
    const result = await pool.run({ sourceFormat: 'igc', bytes: readFixture('sparse-10s.igc'), now: NOW }, () => {});
    expect(result).toMatchObject({ ok: true, analysisLevel: 'basic', analysis: null });
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
  }, TIMEOUT_TEST_LIMIT_MS);
});
