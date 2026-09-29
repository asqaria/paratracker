import 'maplibre-gl/dist/maplibre-gl.css';

import type { ForecastMapResponse } from '@skyline/core';
import {
  AttributionControl,
  LngLatBounds,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  setWorkerUrl,
  type RasterTileSource,
} from 'maplibre-gl';
// Воркер MapLibre — отдельный модуль (как в логбуке): Vite собирает его сам.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { useEffect, useRef } from 'react';

import { documentColorTokens, withAlpha } from '../design/tokens';
import { useLocaleStore, useT } from '../i18n/locale';
import { groundSpeed, metres } from '../viewer/units';
import { WIND_COLOR } from '../viewer/wind-palette';
import { VERDICT_COLOR } from './forecast-palette';
import { FLOW, flowVelocity, spawnParticle, stepParticles, type FlowParticle } from './wind-flow';

/**
 * Карта прогноза (задача П.3, ТЗ §6.9): места старта — значки цветом по
 * вердикту выбранного часа, стрелка — куда сносит ветер, подпись — ветер и
 * потолок. Ленивый чанк: MapLibre не попадает в начальный бандл (ТЗ §7.7).
 * Подложка — Esri через прокси API, атрибуция обязательна (ТЗ §11.3).
 */

type MapSite = ForecastMapResponse['sites'][number];

interface ForecastMapProps {
  sites: MapSite[];
  /** Выбранный час, ISO UTC. */
  time: string | null;
  selected: string | null;
  onSelect: (slug: string) => void;
  /** Шаблон тайлов прокси Esri; null — без подложки. */
  esriTileUrl: string | null;
  /**
   * Слои карты термиков kk7 — готовые адреса тайлов ({z}/{x}/{y}); null — слой
   * выключен. Смена часа меняет адрес — MapLibre подгружает новые тайлы.
   */
  kk7: { thermals: string | null; skyways: string | null };
}

const ESRI_MAX_ZOOM = 18;
const TILE_SIZE_PX = 256;
const FIT_PADDING_PX = 64;
/** Одно место — показать округу старта, а не двор. */
const FIT_MAX_ZOOM = 9;
/** Слабая уверенность — значок бледнее (ТЗ §6.9: уверенность — прозрачностью). */
const CONFIDENCE_OPACITY = { high: 1, medium: 0.8, low: 0.55 } as const;
/** Стрелка показывает, куда сносит: «откуда» + 180°. */
const DOWNWIND_DEG = 180;
/** Дословно по лицензии, не переводится. */
const ESRI_ATTRIBUTION = 'Powered by Esri | Esri World Imagery — Esri, Maxar, Earthstar Geographics';
/** Условие лицензии kk7 (CC BY-NC-SA 4.0): автор и ссылка, не переводится. */
const KK7_ATTRIBUTION = 'Thermals: <a href="https://thermal.kk7.ch" target="_blank" rel="noopener">thermal.kk7.ch</a> (CC BY-NC-SA 4.0)';
const KK7_TILE_PX = 256;
/** kk7 рисует термики до z12, коридоры — до z13; ближе — растягивает. */
const KK7_MAX_ZOOM = { thermals: 12, skyways: 13 } as const;
/** Слои kk7 поверх спутника, но не глушат его. */
const KK7_OPACITY = 0.75;
const KK7_KINDS = ['skyways', 'thermals'] as const;
/** Пустой адрес-заглушка, пока слой выключен: у источника MapLibre должен быть адрес. */
const NO_TILES = 'data:,';
/** Хвосты частиц: каждый кадр прошлое гаснет на 8 % — штрих длиной в полсекунды. */
const TRAIL_FADE = 0.08;
const PARTICLE_WIDTH_PX = 1.5;
/** Потолок шага кадра, с: после фоновой вкладки частицы не прыгают через весь круг. */
const MAX_FRAME_S = 0.1;
const METRES_PER_DEGREE_LAT = 111_320;
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

setWorkerUrl(maplibreWorkerUrl);

export default function ForecastMap({ sites, time, selected, onSelect, esriTileUrl, kk7 }: ForecastMapProps) {
  const t = useT();
  const locale = useLocaleStore((state) => state.locale);
  const container = useRef<HTMLDivElement>(null);
  const markers = useRef(new Map<string, HTMLButtonElement>());
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const mapRef = useRef<MapLibreMap | null>(null);
  const kk7Ref = useRef(kk7);
  kk7Ref.current = kk7;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** Ветер выбранного часа по местам — кадр читает его, не пересоздавая анимацию. */
  const windRef = useRef(new Map<string, { speedMs: number; dirDeg: number }>());
  windRef.current = new Map(
    sites.flatMap((site) => {
      const hour = site.hours.find((h) => h.time === time);
      return hour ? [[site.slug, { speedMs: hour.windSpeedMs, dirDeg: hour.windDirDeg }] as const] : [];
    }),
  );

  // Карта и значки — один раз на набор мест; час и выбор меняют только значки.
  useEffect(() => {
    if (!container.current) return undefined;
    const colors = documentColorTokens();
    const map = new MapLibreMap({
      container: container.current,
      attributionControl: false,
      style: {
        version: 8,
        sources:
          esriTileUrl === null
            ? {}
            : { imagery: { type: 'raster', tiles: [esriTileUrl], tileSize: TILE_SIZE_PX, maxzoom: ESRI_MAX_ZOOM, attribution: ESRI_ATTRIBUTION } },
        layers: [
          { id: 'background', type: 'background', paint: { 'background-color': colors.void } },
          ...(esriTileUrl === null ? [] : [{ id: 'imagery', type: 'raster' as const, source: 'imagery' }]),
        ],
      },
    });
    mapRef.current = map;
    // Слои kk7: TMS-нумерация тайлов (как на thermal.kk7.ch).
    map.on('load', () => {
      for (const kind of KK7_KINDS) {
        const url = kk7Ref.current[kind];
        map.addSource(`kk7-${kind}`, {
          type: 'raster',
          tiles: [url ?? NO_TILES],
          scheme: 'tms',
          tileSize: KK7_TILE_PX,
          maxzoom: KK7_MAX_ZOOM[kind],
          attribution: KK7_ATTRIBUTION,
        });
        map.addLayer({
          id: `kk7-${kind}`,
          type: 'raster',
          source: `kk7-${kind}`,
          paint: { 'raster-opacity': KK7_OPACITY },
          layout: { visibility: url === null ? 'none' : 'visible' },
        });
      }
    });
    map.addControl(new AttributionControl({ compact: false }));
    map.addControl(new NavigationControl({ showCompass: false }));

    const created: Marker[] = [];
    for (const site of sites) {
      const element = document.createElement('button');
      element.type = 'button';
      element.dataset.site = site.slug;
      element.className = 'flex flex-col items-center gap-0.5 rounded-lg px-1.5 py-1 glass text-xs text-primary';
      element.addEventListener('click', () => onSelectRef.current(site.slug));
      markers.current.set(site.slug, element);
      created.push(new Marker({ element, anchor: 'bottom' }).setLngLat([site.lon, site.lat]).addTo(map));
    }
    if (sites.length > 0) {
      const bounds = new LngLatBounds();
      for (const site of sites) bounds.extend([site.lon, site.lat]);
      map.fitBounds(bounds, { padding: FIT_PADDING_PX, maxZoom: FIT_MAX_ZOOM, animate: false });
    }
    const markerMap = markers.current;
    return () => {
      created.forEach((marker) => marker.remove());
      markerMap.clear();
      mapRef.current = null;
      map.remove();
    };
  }, [sites, esriTileUrl]);

  // Частицы ветра (задача П.5): canvas поверх карты, свой кадр; при сдвиге карты — заново.
  useEffect(() => {
    const map = mapRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!map || !canvas || !ctx || window.matchMedia(REDUCED_MOTION).matches) return undefined;
    const fade = withAlpha(documentColorTokens().void, TRAIL_FADE);
    const particles = new Map<string, FlowParticle[]>();
    const areaOf = (site: (typeof sites)[number]) => {
      const center = map.project([site.lon, site.lat]);
      const edge = map.project([site.lon, site.lat + FLOW.radiusM / METRES_PER_DEGREE_LAT]);
      return { cx: center.x, cy: center.y, r: Math.hypot(edge.x - center.x, edge.y - center.y) };
    };
    const reset = (): void => {
      particles.clear();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    };
    map.on('move', reset);
    let frame = 0;
    let last: number | null = null;
    const tick = (now: number): void => {
      frame = requestAnimationFrame(tick);
      const dt = last === null ? 0 : Math.min(MAX_FRAME_S, (now - last) / 1000);
      last = now;
      const ratio = window.devicePixelRatio || 1;
      const { clientWidth: w, clientHeight: h } = canvas;
      if (canvas.width !== Math.round(w * ratio) || canvas.height !== Math.round(h * ratio)) {
        canvas.width = Math.round(w * ratio);
        canvas.height = Math.round(h * ratio);
        particles.clear();
      }
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      // Прошлый кадр гаснет, а не стирается — остаётся хвост.
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = fade;
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = WIND_COLOR;
      ctx.lineWidth = PARTICLE_WIDTH_PX;
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (const site of sites) {
        const wind = windRef.current.get(site.slug);
        if (!wind) continue;
        const area = areaOf(site);
        let list = particles.get(site.slug);
        if (!list) {
          list = Array.from({ length: FLOW.particlesPerSite }, () => spawnParticle(area, Math.random));
          particles.set(site.slug, list);
        }
        stepParticles(list, dt, flowVelocity(wind.speedMs, wind.dirDeg, map.getBearing()), area, Math.random);
        for (const p of list) {
          if (p.prevX === p.x && p.prevY === p.y) continue;
          ctx.moveTo(p.prevX, p.prevY);
          ctx.lineTo(p.x, p.y);
        }
      }
      ctx.stroke();
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      map.off('move', reset);
    };
  }, [sites, esriTileUrl]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.isStyleLoaded()) return;
    for (const kind of KK7_KINDS) {
      const url = kk7[kind];
      const source = map.getSource<RasterTileSource>(`kk7-${kind}`);
      if (!source) continue;
      if (url !== null) source.setTiles([url]);
      map.setLayoutProperty(`kk7-${kind}`, 'visibility', url === null ? 'none' : 'visible');
    }
  }, [kk7]);

  useEffect(() => {
    for (const site of sites) {
      const element = markers.current.get(site.slug);
      if (!element) continue;
      const hour = site.hours.find((h) => h.time === time);
      element.setAttribute('aria-pressed', String(site.slug === selected));
      element.setAttribute(
        'aria-label',
        hour ? `${site.name}: ${t(`forecast.verdict.${hour.verdict}`)}` : `${site.name}: ${t('forecast.noData')}`,
      );
      element.style.outline = site.slug === selected ? '2px solid currentColor' : '';
      element.replaceChildren();
      const dot = document.createElement('span');
      dot.className = 'inline-block h-3.5 w-3.5 rounded-full';
      if (hour) {
        dot.style.background = VERDICT_COLOR[hour.verdict];
        dot.style.opacity = String(CONFIDENCE_OPACITY[hour.confidence]);
      }
      const name = document.createElement('span');
      name.className = 'font-semibold';
      name.textContent = site.name;
      const line = document.createElement('span');
      line.className = 'numeric flex items-center gap-1 text-secondary';
      if (hour) {
        const arrow = document.createElement('span');
        arrow.textContent = '↑';
        arrow.style.display = 'inline-block';
        arrow.style.transform = `rotate(${hour.windDirDeg + DOWNWIND_DEG}deg)`;
        const text = document.createElement('span');
        text.textContent = [groundSpeed(hour.windSpeedMs, locale, t), hour.ceilingM === null ? null : `↥ ${metres(hour.ceilingM, locale, t)}`]
          .filter(Boolean)
          .join(' · ');
        line.append(arrow, text);
      }
      element.append(dot, name, line);
    }
  }, [sites, time, selected, locale, t]);

  return (
    <div className="relative h-full w-full">
      <div ref={container} role="region" aria-label={t('forecast.map')} className="h-full w-full" />
      <canvas ref={canvasRef} aria-hidden data-panel="wind-flow" className="pointer-events-none absolute inset-0 h-full w-full" />
    </div>
  );
}
