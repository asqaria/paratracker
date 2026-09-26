import { RETENTION, TIME } from '@skyline/core';
import type { ExpiredFlight } from '@skyline/db';
import { describe, expect, it } from 'vitest';

import { createRetentionSweep, type RetentionRepository, type RetentionStorage } from './retention.js';

const NOW = Date.UTC(2026, 8, 25, 12);
const TTL_MS = RETENTION.anonymousDays * TIME.secondsPerDay * TIME.msPerSecond;

const flight = (id: string, track = true): ExpiredFlight => ({
  id,
  rawObjectKey: `raw/anonymous/${id}.igc.gz`,
  trackObjectKey: track ? `tracks/${id}.track` : null,
  publicTrackObjectKey: track ? `tracks/${id}.public.track` : null,
  previewObjectKey: track ? `previews/${id}.jpg` : null,
});

/** Журнал действий: по нему проверяется порядок «сначала S3, потом строка». */
function world(expired: ExpiredFlight[], options: { failKeys?: string[] } = {}) {
  const log: string[] = [];
  const cutoffs: Date[] = [];
  const pending = [...expired];
  const repository: RetentionRepository = {
    listExpired: (before, limit) => {
      cutoffs.push(before);
      return Promise.resolve(pending.slice(0, limit));
    },
    delete: (ids) => {
      log.push(`rows:${ids.join(',')}`);
      for (const id of ids) pending.splice(pending.findIndex((f) => f.id === id), 1);
      return Promise.resolve(ids.length);
    },
  };
  const storage: RetentionStorage = {
    delete: (key) => {
      if (options.failKeys?.includes(key)) return Promise.reject(new Error(`S3 down: ${key}`));
      log.push(`s3:${key}`);
      return Promise.resolve();
    },
  };
  const errors: Array<string | undefined> = [];
  const sweep = createRetentionSweep({
    repository,
    storage,
    now: () => NOW,
    batchSize: 2,
    onError: (_error, flightId) => errors.push(flightId),
  });
  return { sweep, log, cutoffs, errors, pending };
}

describe('createRetentionSweep', () => {
  it('порог — «сейчас» минус срок хранения анонимных', async () => {
    const { sweep, cutoffs } = world([]);
    await sweep.run();
    expect(cutoffs[0]?.getTime()).toBe(NOW - TTL_MS);
  });

  it('пустая выборка — ничего не удаляет', async () => {
    const { sweep, log } = world([]);
    expect(await sweep.run()).toEqual({ deleted: 0, failed: 0 });
    expect(log).toEqual([]);
  });

  it('сначала объекты в S3 (сырой файл, оба трека, превью), потом строка', async () => {
    const { sweep, log } = world([flight('a')]);
    expect(await sweep.run()).toEqual({ deleted: 1, failed: 0 });
    expect(log).toEqual([
      's3:raw/anonymous/a.igc.gz',
      's3:tracks/a.track',
      's3:tracks/a.public.track',
      's3:previews/a.jpg',
      'rows:a',
    ]);
  });

  it('полёт без .track (упал при разборе) тоже удаляется', async () => {
    const { sweep, log } = world([flight('a', false)]);
    await sweep.run();
    expect(log).toEqual(['s3:raw/anonymous/a.igc.gz', 'rows:a']);
  });

  it('отказ S3 на одном полёте: его строка остаётся, остальные удаляются, ошибка с flightId', async () => {
    const { sweep, log, errors, pending } = world([flight('a'), flight('b')], { failKeys: ['tracks/a.track'] });
    expect(await sweep.run()).toEqual({ deleted: 1, failed: 1 });
    expect(log).toContain('rows:b');
    expect(log.some((entry) => entry.startsWith('rows:') && entry.includes('a'))).toBe(false);
    expect(errors).toEqual(['a']);
    expect(pending.map((f) => f.id)).toEqual(['a']);
  });

  it('полная пачка — берёт следующую, пока не выберет всё', async () => {
    const { sweep, pending } = world([flight('a'), flight('b'), flight('c'), flight('d'), flight('e')]);
    expect(await sweep.run()).toEqual({ deleted: 5, failed: 0 });
    expect(pending).toEqual([]);
  });

  it('при отказе в пачке не крутится вечно на тех же полётах', async () => {
    const { sweep, cutoffs } = world([flight('a'), flight('b')], { failKeys: ['raw/anonymous/a.igc.gz', 'raw/anonymous/b.igc.gz'] });
    expect(await sweep.run()).toEqual({ deleted: 0, failed: 2 });
    expect(cutoffs).toHaveLength(1);
  });
});
