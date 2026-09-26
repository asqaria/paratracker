import type { TileSource } from './preview.js';

/**
 * Тайлы Esri World Imagery для превью (задача 3.8) — те же ключ и шаблон,
 * что у прокси подложки в apps/api (ТЗ §4.4.1). Ключ остаётся на сервере.
 */

/** Дословно по условиям ArcGIS Location Platform, как в 3D-сцене. */
export const ESRI_ATTRIBUTION = 'Powered by Esri · Esri, Maxar, Earthstar Geographics';
/** Тайл дольше — превью без него: карточка в мессенджере важнее идеальной подложки. */
const TILE_TIMEOUT_MS = 5000;

export function esriTileSource(template: string, apiKey: string, fetchImpl: typeof fetch = fetch): TileSource {
  return {
    attribution: ESRI_ATTRIBUTION,
    fetchTile: async (z, x, y) => {
      const url = new URL(template.replace('{z}', String(z)).replace('{y}', String(y)).replace('{x}', String(x)));
      url.searchParams.set('token', apiKey);
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(TILE_TIMEOUT_MS) });
      return response.ok ? new Uint8Array(await response.arrayBuffer()) : null;
    },
  };
}
