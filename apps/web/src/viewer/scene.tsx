import {
  ArcType,
  BoundingSphere,
  Cartesian3,
  CesiumTerrainProvider,
  Color,
  GeometryInstance,
  ImageryLayer,
  Material,
  PolylineColorAppearance,
  PolylineGeometry,
  PolylineMaterialAppearance,
  Primitive,
  UrlTemplateImageryProvider,
  Viewer,
  WebMapTileServiceImageryProvider,
  GeographicTilingScheme,
} from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { DecodedTrack } from './decode-track';
import {
  imagerySourceById,
  imagerySources,
  readViewerConfig,
  terrainSource,
  type ImageryId,
  type ImagerySource,
  type ViewerConfig,
} from './providers';
import { buildTrackGeometry } from './track-geometry';

/**
 * Сцена CesiumJS (ТЗ §7.2, §7.3). Весь код Cesium живёт только здесь
 * (CLAUDE.md: импорт cesium вне apps/web/src/viewer — ошибка сборки).
 *
 * Трек — ОДИН примитив с вершинными цветами плюс отдельный примитив свечения
 * под ним: glow и вершинные цвета несовместимы в одном примитиве (§7.3).
 * Entity на точку трека не создаются.
 */

export interface SceneProps {
  track: DecodedTrack;
  /** Подпись слоёв и заголовки — из i18n вызывающей страницы. */
  labels: { imagery: string; points: string; sentinel2: string; esri: string };
  /**
   * Свечение под треком (ТЗ §7.3). По умолчанию выключено: прозрачный примитив
   * рисуется в проходе после непрозрачного, то есть ложится ПОВЕРХ цветной линии
   * и размывает раскраску по вариометру. Включать только вместе с решением,
   * как развести проходы (свой Appearance или порядок с translucent у обоих).
   */
  showGlow?: boolean;
}

/** ТЗ §7.2: основная линия 3–5 px, свечение — шире и приглушённее. */
const TRACK_WIDTH_PX = 4;
const GLOW_WIDTH_PX = 12;
const GLOW_INTENSITY = 0.25;
const SHADOW_ALPHA = 0.42;
const SHADOW_WIDTH_PX = 2;

function createImageryProvider(source: ImagerySource): ImageryLayer {
  if (source.kind === 'wmts') {
    return new ImageryLayer(
      new WebMapTileServiceImageryProvider({
        url: source.url.replace('{layer}', source.layer),
        layer: source.layer,
        style: 'default',
        format: 'image/jpeg',
        tileMatrixSetID: 'WGS84',
        tilingScheme: new GeographicTilingScheme(),
        maximumLevel: source.maximumLevel,
      }),
    );
  }
  return new ImageryLayer(new UrlTemplateImageryProvider({ url: source.url, maximumLevel: source.maximumLevel }));
}

export function Scene({ track, labels, showGlow = false }: SceneProps) {
  const container = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<Viewer | null>(null);
  // Конфиг читается один раз и не роняет рендер: без переменных окружения
  // пользователь должен увидеть причину, а не пустой экран.
  const configured = useMemo<{ config: ViewerConfig } | { message: string }>(() => {
    try {
      return { config: readViewerConfig(import.meta.env) };
    } catch (cause) {
      return { message: cause instanceof Error ? cause.message : String(cause) };
    }
  }, []);
  const config = 'config' in configured ? configured.config : null;
  const sources = useMemo(() => (config ? imagerySources(config) : []), [config]);
  const [imagery, setImagery] = useState<ImageryId>('sentinel2');
  const [error, setError] = useState<string | null>('config' in configured ? null : configured.message);

  useEffect(() => {
    const element = container.current;
    if (!element || !config) return undefined;
    let viewer: Viewer | null = null;
    let disposed = false;

    void (async () => {
      try {
        const terrain = await CesiumTerrainProvider.fromUrl(terrainSource(config).url, { requestVertexNormals: true });
        if (disposed) return;

        const first = imagerySourceById(config, imagery) ?? sources[0];
        viewer = new Viewer(element, {
          terrainProvider: terrain,
          ...(first ? { baseLayer: createImageryProvider(first) } : {}),
          // ТЗ §7.7: рендер только при изменениях — иначе ноутбук греется зря.
          requestRenderMode: true,
          maximumRenderTimeChange: Number.POSITIVE_INFINITY,
          baseLayerPicker: false,
          geocoder: false,
          homeButton: false,
          sceneModePicker: false,
          navigationHelpButton: false,
          timeline: false,
          animation: false,
          fullscreenButton: false,
          infoBox: false,
          selectionIndicator: false,
        });
        viewerRef.current = viewer;

        const scene = viewer.scene;
        scene.globe.depthTestAgainstTerrain = true;
        scene.globe.enableLighting = true;
        // Штатный блок кредитов Cesium скрыт: все обязательные строки лицензий
        // (Re:Earth, EOX, Esri) выводит наш блок атрибуции, иначе они наложатся.
        const credits = viewer.cesiumWidget.creditContainer;
        if (credits instanceof HTMLElement) credits.style.display = 'none';
        // Счётчик кадров только в dev: по нему проверяется FPS из ТЗ §7.7.
        scene.debugShowFramesPerSecond = import.meta.env.DEV;

        const geometry = buildTrackGeometry(track);
        const positions = Cartesian3.fromDegreesArrayHeights(Array.from(geometry.positions));
        const colors: Color[] = [];
        for (let i = 0; i < geometry.pointCount; i++) {
          const at = i * 4;
          colors.push(
            Color.fromBytes(
              geometry.colors[at],
              geometry.colors[at + 1],
              geometry.colors[at + 2],
              geometry.colors[at + 3],
            ),
          );
        }

        // Слой 1: свечение одним приглушённым цветом — по умолчанию выключено (см. showGlow).
        if (showGlow) {
          scene.primitives.add(
            new Primitive({
              geometryInstances: new GeometryInstance({
                geometry: new PolylineGeometry({
                  positions,
                  width: GLOW_WIDTH_PX,
                  arcType: ArcType.NONE,
                  vertexFormat: PolylineMaterialAppearance.VERTEX_FORMAT,
                }),
              }),
              appearance: new PolylineMaterialAppearance({
                material: Material.fromType('PolylineGlow', {
                  color: Color.fromCssColorString('#4DA3FF').withAlpha(GLOW_INTENSITY),
                  glowPower: 0.2,
                }),
              }),
              asynchronous: false,
            }),
          );
        }

        // Слой 2: сам трек с вершинными цветами по вариометру.
        scene.primitives.add(
          new Primitive({
            geometryInstances: new GeometryInstance({
              geometry: new PolylineGeometry({
                positions,
                width: TRACK_WIDTH_PX,
                colors,
                colorsPerVertex: true,
                arcType: ArcType.NONE,
                vertexFormat: PolylineColorAppearance.VERTEX_FORMAT,
              }),
            }),
            appearance: new PolylineColorAppearance({ translucent: false }),
            asynchronous: false,
          }),
        );

        // Тень трека на рельефе — одна линия на весь трек, не Entity на точку.
        viewer.entities.add({
          polyline: {
            positions: Cartesian3.fromDegreesArray(Array.from(geometry.groundPositions)),
            width: SHADOW_WIDTH_PX,
            clampToGround: true,
            material: new Color(0, 0, 0, SHADOW_ALPHA),
          },
        });

        if (positions.length > 0) {
          viewer.camera.flyToBoundingSphere(BoundingSphere.fromPoints(positions), { duration: 0 });
        }
        scene.requestRender();
      } catch (cause) {
        if (!disposed) setError(cause instanceof Error ? cause.message : String(cause));
      }
    })();

    return () => {
      disposed = true;
      viewerRef.current = null;
      viewer?.destroy();
    };
  }, [track, config, imagery, sources, showGlow]);

  /** Переключение подложки: слой пересоздаётся, атрибуция меняется вместе с ним. */
  const switchImagery = (id: ImageryId): void => {
    const viewer = viewerRef.current;
    const source = config ? imagerySourceById(config, id) : null;
    if (!viewer || !source) return;
    viewer.imageryLayers.removeAll();
    viewer.imageryLayers.add(createImageryProvider(source));
    viewer.scene.requestRender();
    setImagery(id);
  };

  const active = (config ? imagerySourceById(config, imagery) : null) ?? sources[0] ?? null;
  const attribution = config ? [...terrainSource(config).attribution, ...(active?.attribution ?? [])] : [];

  return (
    <div className="relative h-dvh w-full">
      <div ref={container} className="h-full w-full" data-testid="cesium-container" />

      {error !== null && (
        <p role="alert" className="absolute left-4 top-4 rounded bg-glass px-3 py-2 text-danger">
          {error}
        </p>
      )}

      <div className="absolute right-4 top-4 flex flex-col gap-2 rounded-xl border border-subtle bg-glass p-3 text-sm backdrop-blur-xl">
        <span className="text-secondary">{labels.imagery}</span>
        <div role="group" aria-label={labels.imagery} className="flex gap-1">
          {sources.map((source) => (
            <button
              key={source.id}
              type="button"
              aria-pressed={source.id === imagery}
              onClick={() => switchImagery(source.id)}
              className="rounded px-2 py-1 text-secondary aria-pressed:bg-subtle aria-pressed:text-primary"
            >
              {source.id === 'esri' ? labels.esri : labels.sentinel2}
            </button>
          ))}
        </div>
        <span className="font-numeric tabular-nums text-secondary">
          {labels.points}: {track.pointCount}
        </span>
      </div>

      {/* Атрибуция обязательна по лицензиям и не скрывается (ТЗ §4.4, §11.3). */}
      <p className="absolute bottom-0 left-0 right-0 bg-void/70 px-3 py-1 text-xs text-secondary">
        {attribution.map((entry, index) => (
          <span key={entry.text}>
            {index > 0 && ' · '}
            {entry.href === undefined ? (
              entry.text
            ) : (
              <a href={entry.href} target="_blank" rel="noopener noreferrer" className="text-accent">
                {entry.text}
              </a>
            )}
          </span>
        ))}
      </p>
    </div>
  );
}

export default Scene;
