import { describe, expect, it } from 'vitest';

import { imagerySourceById, imagerySources, readViewerConfig, terrainSource } from './providers';

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
});
