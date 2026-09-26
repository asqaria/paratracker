import 'maplibre-gl/dist/maplibre-gl.css';

import type { LogbookMapResponse } from '@skyline/core';
import { AttributionControl, LngLatBounds, Map as MapLibreMap, NavigationControl, setWorkerUrl } from 'maplibre-gl';
// Воркер MapLibre 6 — отдельный модуль: Vite собирает его сам, иначе карта
// искала бы maplibre-gl-worker.mjs рядом со своим чанком и не находила.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { useEffect, useRef } from 'react';

import { documentColorTokens } from '../design/tokens';
import { useT } from '../i18n/locale';
import { flightHash } from '../routing';

/**
 * Карта всех полётов логбука (задача 2.11, ТЗ §4.3: 2D — MapLibre). Грузится
 * ленивым чанком только на этой странице — в начальный бандл не попадает.
 * Подложка — Esri через прокси API (ключ на сервере), как и в 3D; нет прокси —
 * треки на тёмном фоне. Атрибуция Esri обязательна (ТЗ §11.3).
 */

interface LogbookMapProps {
  data: LogbookMapResponse;
  /** Шаблон тайлов прокси Esri ({z}/{y}/{x}); null — без подложки. */
  esriTileUrl: string | null;
}

/** World Imagery доходит до z18 (как в 3D). */
const ESRI_MAX_ZOOM = 18;
const TILE_SIZE_PX = 256;
/** Отступ треков от краёв карты при подгонке, px. */
const FIT_PADDING_PX = 32;
/** Один короткий полёт не должен раскрываться до домов. */
const FIT_MAX_ZOOM = 13;
const LINE_WIDTH_PX = 2;
const LINE_HOVER_WIDTH_PX = 4;
const LINE_OPACITY = 0.9;
/** Дословно по лицензии, не переводится. */
const ESRI_ATTRIBUTION = 'Powered by Esri | Esri World Imagery — Esri, Maxar, Earthstar Geographics';

const FLIGHTS = 'flights';

setWorkerUrl(maplibreWorkerUrl);

export default function LogbookMap({ data, esriTileUrl }: LogbookMapProps) {
  const t = useT();
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!container.current || data.features.length === 0) return undefined;
    const colors = documentColorTokens();

    const map = new MapLibreMap({
      container: container.current,
      attributionControl: false,
      style: {
        version: 8,
        sources: {
          ...(esriTileUrl === null
            ? {}
            : {
                imagery: {
                  type: 'raster',
                  tiles: [esriTileUrl],
                  tileSize: TILE_SIZE_PX,
                  maxzoom: ESRI_MAX_ZOOM,
                  attribution: ESRI_ATTRIBUTION,
                },
              }),
          [FLIGHTS]: { type: 'geojson', data, promoteId: 'id' },
        },
        layers: [
          { id: 'background', type: 'background', paint: { 'background-color': colors.void } },
          ...(esriTileUrl === null ? [] : [{ id: 'imagery', type: 'raster' as const, source: 'imagery' }]),
          {
            id: FLIGHTS,
            type: 'line',
            source: FLIGHTS,
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: {
              'line-color': colors.accent,
              'line-opacity': LINE_OPACITY,
              'line-width': ['case', ['boolean', ['feature-state', 'hover'], false], LINE_HOVER_WIDTH_PX, LINE_WIDTH_PX],
            },
          },
        ],
      },
    });
    map.addControl(new AttributionControl({ compact: false }));
    map.addControl(new NavigationControl({ showCompass: false }));

    const bounds = new LngLatBounds();
    for (const feature of data.features) for (const [lon, lat] of feature.geometry.coordinates) bounds.extend([lon, lat]);
    map.fitBounds(bounds, { padding: FIT_PADDING_PX, maxZoom: FIT_MAX_ZOOM, animate: false });

    // Клик по треку — в 3D; наведение подсвечивает трек и меняет курсор.
    let hovered: string | number | undefined;
    const setHover = (id: string | number | undefined): void => {
      if (hovered !== undefined) map.setFeatureState({ source: FLIGHTS, id: hovered }, { hover: false });
      hovered = id;
      if (id !== undefined) map.setFeatureState({ source: FLIGHTS, id }, { hover: true });
      map.getCanvas().style.cursor = id === undefined ? '' : 'pointer';
    };
    map.on('mousemove', FLIGHTS, (event) => setHover(event.features?.[0]?.id));
    map.on('mouseleave', FLIGHTS, () => setHover(undefined));
    map.on('click', FLIGHTS, (event) => {
      const id = event.features?.[0]?.properties.id as unknown;
      if (typeof id === 'string') window.location.hash = flightHash(id);
    });

    return () => map.remove();
  }, [data, esriTileUrl]);

  return <div ref={container} role="region" aria-label={t('logbook.map')} className="h-72 w-full overflow-hidden rounded-xl compact:h-56" />;
}
