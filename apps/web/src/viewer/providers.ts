/**
 * Источники рельефа и подложки за интерфейсами (ТЗ §4.4, §4.4.1).
 * URL и ключи — только из конфига: хардкод адреса тайл-сервера запрещён (CLAUDE.md).
 * Ключ ArcGIS во фронт не попадает — тайлы Esri идут через прокси apps/api.
 */

import type { ImageryCapabilities } from '@skyline/core';

export interface AttributionEntry {
  /** Дословно, как требует лицензия провайдера, — не переводится. */
  text: string;
  href?: string;
  /** Подпись перед записью («Рельеф:» / «Подложка:») — переводит сцена по ключу. */
  label?: 'terrain' | 'imagery';
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
      { label: 'terrain', text: 'Re:Earth Terrain', href: 'https://terrain.reearth.land/' },
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
        { label: 'imagery', text: 'Sentinel-2 cloudless', href: 'https://s2maps.eu' },
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
        { label: 'imagery', text: 'Esri World Imagery — Esri, Maxar, Earthstar Geographics' },
        { text: 'Powered by Esri' },
      ],
    });
  }
  return sources;
}

/**
 * Кнопки подложек: Esri — только если сервер подтвердил настроенный прокси.
 * Ответа нет или запрос упал — только Sentinel-2: иначе пилот нажимал Esri
 * и получал синий шар без единого слова.
 */
export function availableImagery(
  sources: readonly ImagerySource[],
  capabilities: ImageryCapabilities | undefined,
): ImagerySource[] {
  return sources.filter((source) => source.id !== 'esri' || capabilities?.esri === true);
}

/**
 * Ошибок тайлов подряд, после которых подложка считается сломанной и сцена
 * откатывается на Sentinel-2. Одиночная ошибка тайла — обычное дело и
 * подложку срывать не должна; восемь — это уже экран без снимков.
 */
export const IMAGERY_FALLBACK_AFTER_ERRORS = 8;

/** Счётчик ошибок тайлов активной подложки: true — ровно один раз, на пороге. */
export function tileFailureTracker(threshold: number = IMAGERY_FALLBACK_AFTER_ERRORS): { failed(): boolean } {
  let failures = 0;
  return {
    failed: () => {
      failures += 1;
      return failures === threshold;
    },
  };
}

export function imagerySourceById(config: ViewerConfig, id: ImageryId): ImagerySource | null {
  return imagerySources(config).find((source) => source.id === id) ?? null;
}
