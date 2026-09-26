import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { chunkRanges, chunkShare, COMPACT_MEDIA_QUERY, flownVertexCount, progressOf, TRACK_CHUNK_POINTS, trackWidths } from './track-progress';

/**
 * «Пройденный путь»: трек нарезан на куски, каждый со своим флагом показа,
 * плюс короткий хвост от начала текущего куска до пилота. Здесь — чистая
 * арифметика кусков; примитивы Cesium строит сцена.
 */

describe('chunkRanges — куски трека', () => {
  it('соседние куски делят вершину на стыке: линия без разрывов', () => {
    const ranges = chunkRanges(100, 32);
    expect(ranges).toEqual([
      [0, 32],
      [32, 64],
      [64, 96],
      [96, 99],
    ]);
  });

  it('трек из одной вершины или пустой — кусков нет: линию не из чего строить', () => {
    expect(chunkRanges(0, 32)).toEqual([]);
    expect(chunkRanges(1, 32)).toEqual([]);
  });

  it('ровно на границе куска — лишнего пустого куска нет', () => {
    expect(chunkRanges(33, 32)).toEqual([[0, 32]]);
  });

  it('размер куска по умолчанию — компромисс: немного инстансов и короткий хвост', () => {
    expect(TRACK_CHUNK_POINTS).toBeGreaterThanOrEqual(16);
    expect(TRACK_CHUNK_POINTS).toBeLessThanOrEqual(64);
  });
});

describe('flownVertexCount — сколько вершин линии уже пройдено', () => {
  // Вершина → индекс точки трека. Точки 2 и 5 выброшены (нет координат).
  const source = Int32Array.from([0, 1, 3, 4, 6, 7]);

  it('до индекса точки включительно', () => {
    expect(flownVertexCount(source, 0)).toBe(1);
    expect(flownVertexCount(source, 3)).toBe(3);
    expect(flownVertexCount(source, 7)).toBe(6);
  });

  it('выброшенная точка — считаем по последней настоящей до неё', () => {
    expect(flownVertexCount(source, 2)).toBe(2);
    expect(flownVertexCount(source, 5)).toBe(4);
  });

  it('до трека и после — 0 и все', () => {
    expect(flownVertexCount(source, -1)).toBe(0);
    expect(flownVertexCount(source, 1000)).toBe(6);
  });
});

describe('progressOf — какие куски показать и откуда хвост', () => {
  const ranges = chunkRanges(100, 32);

  it('пилот внутри второго куска: первый целиком, хвост от начала второго до пилота', () => {
    expect(progressOf(ranges, 40)).toEqual({ fullChunks: 1, tail: [32, 39] });
  });

  it('пилот ровно на стыке: хвоста нет, куски до стыка целиком', () => {
    expect(progressOf(ranges, 33)).toEqual({ fullChunks: 1, tail: null });
  });

  it('начало трека — ничего; одна вершина — тоже ничего: линии из точки нет', () => {
    expect(progressOf(ranges, 0)).toEqual({ fullChunks: 0, tail: null });
    expect(progressOf(ranges, 1)).toEqual({ fullChunks: 0, tail: null });
  });

  it('конец трека — все куски, хвоста нет', () => {
    expect(progressOf(ranges, 100)).toEqual({ fullChunks: 4, tail: null });
  });
});

describe('trackWidths — толщина линии', () => {
  it('на телефоне тоньше: 4 px на экране 390 px — полоса поперёк долины', () => {
    const phone = trackWidths(true);
    const desktop = trackWidths(false);
    expect(phone.linePx).toBeLessThan(desktop.linePx);
    expect(phone.shadowPx).toBeLessThanOrEqual(desktop.shadowPx);
    expect(desktop.linePx).toBe(4);
  });
});

describe('COMPACT_MEDIA_QUERY — те же пороги, что у варианта compact в CSS', () => {
  it('ширина и высота совпадают с index.css', () => {
    const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8');
    for (const threshold of COMPACT_MEDIA_QUERY.match(/\(max-(?:width|height): \d+px\)/g) ?? []) {
      expect(css).toContain(threshold);
    }
    expect(COMPACT_MEDIA_QUERY).toContain('max-width');
    expect(COMPACT_MEDIA_QUERY).toContain('max-height');
  });
});

describe('chunkShare — доля куска тени до пилота', () => {
  // Отрезки 10, 30, 60 м; вершины — раз в секунду.
  const lengths = [10, 30, 60];
  const times = [0, 1000, 2000, 3000];

  it('по длине, а не по номеру вершины: пройдены отрезки плюс доля текущего по времени', () => {
    expect(chunkShare(lengths, times, 0, 0, 0)).toBe(0);
    expect(chunkShare(lengths, times, 0, 0, 500)).toBeCloseTo(0.05, 9);
    expect(chunkShare(lengths, times, 0, 1, 1000)).toBeCloseTo(0.1, 9);
    expect(chunkShare(lengths, times, 0, 2, 2500)).toBeCloseTo(0.7, 9);
    expect(chunkShare(lengths, times, 0, 3, 3000)).toBe(1);
  });

  it('плавно: доля растёт непрерывно между вершинами', () => {
    for (let ms = 1000; ms < 2000; ms += 100) {
      expect(chunkShare(lengths, times, 0, 1, ms + 100) - chunkShare(lengths, times, 0, 1, ms)).toBeCloseTo(0.03, 9);
    }
  });

  it('пилот ещё не в куске — ноль; нулевая длина — ноль', () => {
    expect(chunkShare(lengths, times, 1, 0, 500)).toBe(0);
    expect(chunkShare([0, 0], [0, 1000, 2000], 0, 1, 1500)).toBe(0);
  });
});
