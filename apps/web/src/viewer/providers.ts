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
  /** Видна всегда, даже в свёрнутой строке на телефоне (требование лицензии). */
  pinned?: true;
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
        { text: 'Powered by Esri', pinned: true },
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
 * Подложка по умолчанию — Esri, если сервер её подтвердил (решение владельца:
 * суб-метровые снимки над населёнными местами), иначе Sentinel-2. При отказе
 * тайлов Esri сцена сама откатывается на Sentinel-2 (tileFailureTracker).
 */
export function preferredImagery(available: readonly ImagerySource[]): ImageryId {
  return available.some((source) => source.id === 'esri') ? 'esri' : 'sentinel2';
}

/**
 * Ошибок тайлов подряд, после которых подложка считается сломанной и сцена
 * откатывается на Sentinel-2. Одиночная ошибка тайла — обычное дело и
 * подложку срывать не должна; восемь — это уже экран без снимков.
 */
export const IMAGERY_FALLBACK_AFTER_ERRORS = 8;

/**
 * HTTP-статус «тайла здесь нет». У Esri World Imagery покрытие детальных зумов
 * неровное: над Казахстаном z18 местами отсутствует, и прокси честно отдаёт 404.
 * Это не отказ подложки — Cesium оставляет на экране родительский тайл.
 */
export const TILE_ABSENT_STATUS = 404;

/**
 * Счётчик ошибок тайлов активной подложки: true — ровно один раз, на пороге.
 * `status` — HTTP-статус ответа; без статуса (сеть, CORS) — тоже отказ.
 */
export function tileFailureTracker(threshold: number = IMAGERY_FALLBACK_AFTER_ERRORS): {
  failed(status?: number): boolean;
} {
  let failures = 0;
  return {
    failed: (status?: number) => {
      if (status === TILE_ABSENT_STATUS) return false;
      failures += 1;
      return failures === threshold;
    },
  };
}

/**
 * Свёрнутая атрибуция для узкого экрана: названия источников (с подписью
 * «Рельеф» / «Подложка») и то, что лицензия велит держать на виду всегда.
 * Полный текст — по тапу; так сворачивает атрибуцию и сам ArcGIS JS API.
 */
export function collapsedAttribution(entries: readonly AttributionEntry[]): AttributionEntry[] {
  return entries.filter((entry) => entry.label !== undefined || entry.pinned === true);
}

export function imagerySourceById(config: ViewerConfig, id: ImageryId): ImagerySource | null {
  return imagerySources(config).find((source) => source.id === id) ?? null;
}
