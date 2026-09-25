import { describe, expect, it } from 'vitest';

import {
  availableImagery,
  collapsedAttribution,
  IMAGERY_FALLBACK_AFTER_ERRORS,
  imagerySourceById,
  imagerySources,
  readViewerConfig,
  terrainSource,
  tileFailureTracker,
} from './providers';

const ENV = {
  VITE_TERRAIN_URL: 'https://terrain.example/cesium-mesh/ellipsoid',
  VITE_IMAGERY_WMTS_URL: 'https://tiles.example/wmts/1.0.0/{layer}/default/WGS84/{TileMatrix}/{TileRow}/{TileCol}.jpg',
  VITE_IMAGERY_WMTS_LAYER: 's2cloudless-2025',
  VITE_ESRI_TILE_URL: '/api/v1/tiles/esri/{z}/{y}/{x}',
};

describe('конфиг провайдеров', () => {
  it('URL берутся из окружения, а не из кода', () => {
    expect(readViewerConfig(ENV)).toEqual({
      terrainUrl: ENV.VITE_TERRAIN_URL,
      imageryWmtsUrl: ENV.VITE_IMAGERY_WMTS_URL,
      imageryWmtsLayer: ENV.VITE_IMAGERY_WMTS_LAYER,
      esriTileUrl: ENV.VITE_ESRI_TILE_URL,
    });
  });

  it('без обязательных переменных — понятная ошибка со списком', () => {
    expect(() => readViewerConfig({ ...ENV, VITE_TERRAIN_URL: '  ' })).toThrow(/VITE_TERRAIN_URL/);
    expect(() => readViewerConfig({})).toThrow(/VITE_IMAGERY_WMTS_URL/);
  });

  it('прокси Esri не настроен — подложки Esri нет в переключателе', () => {
    const config = readViewerConfig({ ...ENV, VITE_ESRI_TILE_URL: '' });

    expect(config.esriTileUrl).toBeNull();
    expect(imagerySources(config).map((source) => source.id)).toEqual(['sentinel2']);
    expect(imagerySourceById(config, 'esri')).toBeNull();
  });

  it('прокси задан — Esri доступен, ключа в конфиге фронта нет', () => {
    const config = readViewerConfig(ENV);
    const sources = imagerySources(config);

    expect(sources.map((source) => source.id)).toEqual(['sentinel2', 'esri']);
    expect(JSON.stringify(sources)).not.toMatch(/token|key/i);
    expect(imagerySourceById(config, 'esri')?.url).toBe('/api/v1/tiles/esri/{z}/{y}/{x}');
  });

  it('атрибуция обязательна и своя у каждого источника (ТЗ §11.3)', () => {
    const config = readViewerConfig(ENV);

    expect(terrainSource(config).attribution.map((entry) => entry.text).join(' ')).toMatch(/Re:Earth.*CC BY 4\.0/s);
    const [sentinel, esri] = imagerySources(config);
    expect(sentinel?.attribution.map((entry) => entry.text).join(' ')).toMatch(/Sentinel-2 cloudless.*EOX.*CC BY 4\.0/s);
    expect(esri?.attribution.map((entry) => entry.text).join(' ')).toMatch(/Powered by Esri/);
  });

  it('подпись «Рельеф» / «Подложка» — ключ для i18n, а не текст: переводит сцена', () => {
    const config = readViewerConfig(ENV);
    const entries = [terrainSource(config), ...imagerySources(config)].map((source) => source.attribution);

    expect(entries.map((attribution) => attribution[0]?.label)).toEqual(['terrain', 'imagery', 'imagery']);
    // Текст провайдеров — дословный по лицензиям, без русских вставок.
    expect(entries.flat().map((entry) => entry.text).join(' ')).not.toMatch(/[А-Яа-яЁё]/);
  });
});

describe('availableImagery — кнопки только для настроенных подложек', () => {
  const sources = imagerySources(readViewerConfig(ENV));

  it('сервер подтвердил Esri — обе кнопки', () => {
    expect(availableImagery(sources, { esri: true }).map((s) => s.id)).toEqual(['sentinel2', 'esri']);
  });

  it('ключа на сервере нет — только Sentinel-2', () => {
    expect(availableImagery(sources, { esri: false }).map((s) => s.id)).toEqual(['sentinel2']);
  });

  it('ответа ещё нет или запрос упал — только Sentinel-2, без синего шара', () => {
    expect(availableImagery(sources, undefined).map((s) => s.id)).toEqual(['sentinel2']);
  });
});

describe('tileFailureTracker — откат на Sentinel-2 при потоке ошибок тайлов', () => {
  it('срабатывает ровно один раз, на пороге', () => {
    const tracker = tileFailureTracker();
    const fired = Array.from({ length: IMAGERY_FALLBACK_AFTER_ERRORS + 3 }, () => tracker.failed());
    expect(fired.indexOf(true)).toBe(IMAGERY_FALLBACK_AFTER_ERRORS - 1);
    expect(fired.filter(Boolean)).toHaveLength(1);
  });

  it('единичная ошибка тайла подложку не срывает', () => {
    expect(IMAGERY_FALLBACK_AFTER_ERRORS).toBeGreaterThan(1);
    expect(tileFailureTracker().failed()).toBe(false);
  });

  it('404 — тайла на этом зуме нет (Esri без съёмки z18), подложку не срывает', () => {
    const tracker = tileFailureTracker();
    const fired = Array.from({ length: IMAGERY_FALLBACK_AFTER_ERRORS * 3 }, () => tracker.failed(404));
    expect(fired.some(Boolean)).toBe(false);
  });

  it('403, 429, 5xx и сетевой сбой без статуса — отказ подложки', () => {
    const tracker = tileFailureTracker();
    const statuses = [403, 429, 500, 502, undefined, 503, 401, 504];
    expect(statuses).toHaveLength(IMAGERY_FALLBACK_AFTER_ERRORS);
    const fired = statuses.map((status) => tracker.failed(status));
    expect(fired.indexOf(true)).toBe(IMAGERY_FALLBACK_AFTER_ERRORS - 1);
  });

  it('404 вперемешку с отказами не сдвигает порог', () => {
    const tracker = tileFailureTracker();
    const fired = Array.from({ length: IMAGERY_FALLBACK_AFTER_ERRORS }, () => [tracker.failed(404), tracker.failed(503)]).flat();
    expect(fired.filter(Boolean)).toHaveLength(1);
    expect(fired.at(-1)).toBe(true);
  });
});

describe('collapsedAttribution — одна строка атрибуции на телефоне', () => {
  const config = readViewerConfig(ENV);
  const full = (id: 'sentinel2' | 'esri') => [
    ...terrainSource(config).attribution,
    ...(imagerySourceById(config, id)?.attribution ?? []),
  ];

  it('названия рельефа и подложки остаются со ссылками', () => {
    const short = collapsedAttribution(full('sentinel2'));
    expect(short.map((entry) => entry.text)).toEqual(['Re:Earth Terrain', 'Sentinel-2 cloudless']);
    expect(short.every((entry) => entry.href !== undefined)).toBe(true);
  });

  it('«Powered by Esri» видно всегда — требование Esri, его не сворачивают', () => {
    expect(collapsedAttribution(full('esri')).map((entry) => entry.text)).toContain('Powered by Esri');
  });

  it('короткая строка — часть полной, в том же порядке', () => {
    for (const id of ['sentinel2', 'esri'] as const) {
      const entries = full(id);
      const short = collapsedAttribution(entries);
      expect(short.length).toBeLessThan(entries.length);
      expect(entries.filter((entry) => short.includes(entry))).toEqual(short);
    }
  });
});
