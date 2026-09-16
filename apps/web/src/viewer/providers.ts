/**
 * Источники рельефа и подложки за интерфейсами (ТЗ §4.4, §4.4.1).
 * URL и ключи — только из конфига: хардкод адреса тайл-сервера запрещён (CLAUDE.md).
 * Ключ ArcGIS во фронт не попадает — тайлы Esri идут через прокси apps/api.
 */

export interface AttributionEntry {
  text: string;
  href?: string;
}

export const IMAGERY_IDS = ['sentinel2', 'esri'] as const;
export type ImageryId = (typeof IMAGERY_IDS)[number];

export interface TerrainSource {
  url: string;
  attribution: AttributionEntry[];
}

export type ImagerySource =
  | {
      id: 'sentinel2';
      kind: 'wmts';
      /** Шаблон с {layer} и подстановками WMTS. */
      url: string;
      layer: string;
      maximumLevel: number;
      attribution: AttributionEntry[];
    }
  | {
      id: 'esri';
      kind: 'url-template';
      /** Путь прокси нашего API: ключ остаётся на сервере. */
      url: string;
      maximumLevel: number;
      attribution: AttributionEntry[];
    };

export interface ViewerConfig {
  terrainUrl: string;
  imageryWmtsUrl: string;
  imageryWmtsLayer: string;
  /** null — прокси Esri не настроен, подложка недоступна. */
  esriTileUrl: string | null;
}

/** EOX отдаёт Sentinel-2 cloudless до z14 (10 м/пиксель). */
const SENTINEL_MAX_LEVEL = 14;
/** World Imagery доходит до z18. */
const ESRI_MAX_LEVEL = 18;

const REQUIRED_VARS = ['VITE_TERRAIN_URL', 'VITE_IMAGERY_WMTS_URL', 'VITE_IMAGERY_WMTS_LAYER'] as const;

export function readViewerConfig(env: Record<string, string | undefined>): ViewerConfig {
  const missing = REQUIRED_VARS.filter((name) => (env[name] ?? '').trim() === '');
  if (missing.length > 0) {
    throw new Error(`Missing viewer configuration: ${missing.join(', ')} (see .env.example)`);
  }
  const esri = (env.VITE_ESRI_TILE_URL ?? '').trim();
  return {
    terrainUrl: (env.VITE_TERRAIN_URL ?? '').trim(),
    imageryWmtsUrl: (env.VITE_IMAGERY_WMTS_URL ?? '').trim(),
    imageryWmtsLayer: (env.VITE_IMAGERY_WMTS_LAYER ?? '').trim(),
    esriTileUrl: esri === '' ? null : esri,
  };
}

/** Атрибуция обязательна по лицензиям: Re:Earth и EOX — CC BY 4.0, Esri — «Powered by Esri» (ТЗ §11.3). */
export function terrainSource(config: ViewerConfig): TerrainSource {
  return {
    url: config.terrainUrl,
    attribution: [
      { text: 'Рельеф: Re:Earth Terrain', href: 'https://terrain.reearth.land/' },
      { text: 'Mapterhorn DEM, CC BY 4.0' },
    ],
  };
}

export function imagerySources(config: ViewerConfig): ImagerySource[] {
  const sources: ImagerySource[] = [
    {
      id: 'sentinel2',
      kind: 'wmts',
      url: config.imageryWmtsUrl,
      layer: config.imageryWmtsLayer,
      maximumLevel: SENTINEL_MAX_LEVEL,
      attribution: [
        { text: 'Подложка: Sentinel-2 cloudless', href: 'https://s2maps.eu' },
        { text: 'by EOX IT Services GmbH (Contains modified Copernicus Sentinel data), CC BY 4.0' },
      ],
    },
  ];

  if (config.esriTileUrl !== null) {
    sources.push({
      id: 'esri',
      kind: 'url-template',
      url: config.esriTileUrl,
      maximumLevel: ESRI_MAX_LEVEL,
      attribution: [
        { text: 'Подложка: Esri World Imagery — Esri, Maxar, Earthstar Geographics' },
        { text: 'Powered by Esri' },
      ],
    });
  }
  return sources;
}

export function imagerySourceById(config: ViewerConfig, id: ImageryId): ImagerySource | null {
  return imagerySources(config).find((source) => source.id === id) ?? null;
}
