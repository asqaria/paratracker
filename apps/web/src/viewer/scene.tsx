import {
  ArcType,
  BoundingSphere,
  Cartesian3,
  CesiumTerrainProvider,
  Color,
  GeographicTilingScheme,
  GeometryInstance,
  HeadingPitchRange,
  ImageryLayer,
  Material,
  Math as CesiumMath,
  Matrix4,
  PolylineColorAppearance,
  PolylineGeometry,
  PolylineMaterialAppearance,
  Primitive,
  UrlTemplateImageryProvider,
  Viewer,
  WebMapTileServiceImageryProvider,
} from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useT } from '../i18n/locale';
import { CAMERA_POSES, DEFAULT_CAMERA_MODE, smoothHeading, type CameraMode } from './camera-modes';
import type { DecodedTrack } from './decode-track';
import { setupFlightClock, type FlightClock } from './flight-clock';
import {
  DEFAULT_PLAYBACK_SPEED,
  indexAt,
  seekBy,
  timelineOf,
  type PlaybackSpeed,
} from './playback';
import {
  imagerySourceById,
  imagerySources,
  readViewerConfig,
  terrainSource,
  type ImageryId,
  type ImagerySource,
  type ViewerConfig,
} from './providers';
import { SummaryPanel } from './SummaryPanel';
import { TimelinePanel } from './TimelinePanel';
import { VarioLegend } from './VarioLegend';
import { buildTrackGeometry } from './track-geometry';
import { useHotkeys } from './use-hotkeys';

/**
 * Сцена CesiumJS (ТЗ §7.2–§7.5). Весь код Cesium живёт только здесь
 * (CLAUDE.md: импорт cesium вне apps/web/src/viewer — ошибка сборки).
 *
 * Трек — ОДИН примитив с вершинными цветами; свечение — отдельным примитивом
 * и по умолчанию выключено (§7.3). Часы Cesium — единственный источник времени.
 */

export interface SceneProps {
  track: DecodedTrack;
  /**
   * Свечение под треком (ТЗ §7.3). По умолчанию выключено: прозрачный примитив
   * рисуется в проходе после непрозрачного, то есть ложится ПОВЕРХ цветной линии
   * и размывает раскраску по вариометру.
   */
  showGlow?: boolean;
}

/** ТЗ §7.2: основная линия 3–5 px, свечение — шире и приглушённее. */
const TRACK_WIDTH_PX = 4;
const GLOW_WIDTH_PX = 12;
const GLOW_INTENSITY = 0.25;
const SHADOW_ALPHA = 0.42;
const SHADOW_WIDTH_PX = 2;
/** Кадров в секунду, на которые рассчитан шаг сглаживания курса (прототип). */
const ASSUMED_FPS = 60;

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

export function Scene({ track, showGlow = false }: SceneProps) {
  const t = useT();
  const container = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const clockRef = useRef<FlightClock | null>(null);
  const cameraModeRef = useRef<CameraMode>(DEFAULT_CAMERA_MODE);
  const smoothHeadingRef = useRef<number | null>(null);

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
  const timeline = useMemo(() => timelineOf(track.t), [track]);

  const [imagery, setImagery] = useState<ImageryId>('sentinel2');
  // Выбранная подложка нужна эффекту только при создании сцены. В зависимостях
  // её держать нельзя: смена подложки пересоздала бы Viewer вместе с часами,
  // и время проигрывания сбрасывалось бы в начало.
  const imageryRef = useRef<ImageryId>(imagery);
  const [error, setError] = useState<string | null>('config' in configured ? null : configured.message);
  const [timeMs, setTimeMs] = useState<number>(timeline.startMs);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<PlaybackSpeed>(DEFAULT_PLAYBACK_SPEED);
  const [cameraMode, setCameraMode] = useState<CameraMode>(DEFAULT_CAMERA_MODE);

  useEffect(() => {
    const element = container.current;
    if (!element || !config) return undefined;
    let viewer: Viewer | null = null;
    let disposed = false;

    void (async () => {
      try {
        const terrain = await CesiumTerrainProvider.fromUrl(terrainSource(config).url, { requestVertexNormals: true });
        if (disposed) return;

        const first = imagerySourceById(config, imageryRef.current) ?? sources[0];
        viewer = new Viewer(element, {
          terrainProvider: terrain,
          ...(first ? { baseLayer: createImageryProvider(first) } : {}),
          // ТЗ §7.7: рендер только при изменениях; на время проигрывания включается непрерывный.
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
        scene.debugShowFramesPerSecond = import.meta.env.DEV;
        // Штатный блок кредитов Cesium скрыт: все обязательные строки лицензий
        // (Re:Earth, EOX, Esri) выводит наш блок атрибуции, иначе они наложатся.
        const credits = viewer.cesiumWidget.creditContainer;
        if (credits instanceof HTMLElement) credits.style.display = 'none';

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

        const flightClock = setupFlightClock(viewer, track);
        clockRef.current = flightClock;

        // Кадровый обработчик: время → HUD и камера. Состояние React обновляется
        // только при смене точки, иначе перерисовка шла бы 60 раз в секунду.
        let lastIndex = -1;
        const onPreRender = (): void => {
          const current = flightClock.currentTimeMs();
          const index = indexAt(track.t, current);
          if (index !== lastIndex) {
            lastIndex = index;
            setTimeMs(current);
          }

          const pose = CAMERA_POSES[cameraModeRef.current];
          if (!pose || !viewer) return;
          const position = flightClock.position.getValue(viewer.clock.currentTime);
          if (!position) return;

          const target = pose.headingDeg ?? (track.heading[index] ?? Number.NaN);
          const elapsedS = Math.abs(viewer.clock.multiplier) / ASSUMED_FPS;
          smoothHeadingRef.current = smoothHeading(smoothHeadingRef.current, target, elapsedS);
          viewer.camera.lookAt(
            position,
            new HeadingPitchRange(
              CesiumMath.toRadians(smoothHeadingRef.current),
              CesiumMath.toRadians(pose.pitchDeg),
              pose.rangeM,
            ),
          );
        };
        scene.preRender.addEventListener(onPreRender);

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
      clockRef.current = null;
      viewer?.destroy();
    };
  }, [track, config, sources, showGlow]);

  /** Проигрывание: на это время нужен непрерывный рендер (ТЗ §7.7). */
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    viewer.clock.shouldAnimate = playing;
    viewer.scene.requestRenderMode = !playing;
    viewer.scene.requestRender();
  }, [playing]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (viewer) viewer.clock.multiplier = speed;
  }, [speed]);

  useEffect(() => {
    cameraModeRef.current = cameraMode;
    smoothHeadingRef.current = null;
    const viewer = viewerRef.current;
    if (!viewer) return;
    // При выходе из слежения обязательно снять трансформацию камеры, иначе
    // свободное вращение пойдёт вокруг старой точки (ТЗ §7.4).
    if (CAMERA_POSES[cameraMode] === null) viewer.camera.lookAtTransform(Matrix4.IDENTITY);
    viewer.scene.requestRender();
  }, [cameraMode]);

  const seekTo = useCallback((next: number) => {
    const clamped = Math.max(timeline.startMs, Math.min(timeline.endMs, next));
    clockRef.current?.setTimeMs(clamped);
    smoothHeadingRef.current = null;
    setTimeMs(clamped);
    viewerRef.current?.scene.requestRender();
  }, [timeline]);

  const togglePlay = useCallback(() => {
    // Доиграли до посадки — следующий запуск с начала.
    if (timeMs >= timeline.endMs) seekTo(timeline.startMs);
    setPlaying((value) => !value);
  }, [seekTo, timeMs, timeline]);

  const hotkeys = useMemo(
    () => ({
      onTogglePlay: togglePlay,
      onSeek: (deltaSeconds: number) => seekTo(seekBy(timeline, timeMs, deltaSeconds)),
      onCameraMode: setCameraMode,
    }),
    [seekTo, timeMs, timeline, togglePlay],
  );
  useHotkeys(hotkeys);

  /** Переключение подложки: слой пересоздаётся, атрибуция меняется вместе с ним. */
  const switchImagery = (id: ImageryId): void => {
    const viewer = viewerRef.current;
    const source = config ? imagerySourceById(config, id) : null;
    if (!viewer || !source) return;
    viewer.imageryLayers.removeAll();
    viewer.imageryLayers.add(createImageryProvider(source));
    viewer.scene.requestRender();
    imageryRef.current = id;
    setImagery(id);
  };

  const active = (config ? imagerySourceById(config, imagery) : null) ?? sources[0] ?? null;
  const attribution = config ? [...terrainSource(config).attribution, ...(active?.attribution ?? [])] : [];

  return (
    <div className="relative h-dvh w-full">
      <div ref={container} className="h-full w-full" data-testid="cesium-container" />

      <div className="absolute left-4 top-4 flex flex-col gap-2">
        <SummaryPanel summary={track.summary} />
        {error !== null && (
          <p role="alert" className="rounded bg-glass px-3 py-2 text-danger">
            {error}
          </p>
        )}
      </div>

      <div className="absolute right-4 top-4 flex flex-col gap-2 rounded-xl border border-subtle bg-glass p-3 text-sm backdrop-blur-xl">
        <span className="text-secondary">{t('viewer.imagery')}</span>
        <div role="group" aria-label={t('viewer.imagery')} className="flex gap-1">
          {sources.map((source) => (
            <button
              key={source.id}
              type="button"
              aria-pressed={source.id === imagery}
              onClick={() => switchImagery(source.id)}
              className="rounded px-2 py-1 text-secondary aria-pressed:bg-subtle aria-pressed:text-primary"
            >
              {source.id === 'esri' ? t('viewer.imagery.esri') : t('viewer.imagery.sentinel2')}
            </button>
          ))}
        </div>
        <span className="font-numeric tabular-nums text-secondary">
          {t('viewer.points')}: {track.pointCount}
        </span>
      </div>

      {/*
        Атрибуция и таймлайн — один прижатый к низу поток, а не два блока
        с отступами: при фиксированном bottom панель накрывала атрибуцию,
        а она обязательна по лицензиям и не скрывается (ТЗ §4.4, §11.3).
      */}
      <div className="absolute bottom-0 left-0 right-0">
        <div className="px-4 pb-2">
          <VarioLegend />
        </div>
        <p className="bg-void/70 px-3 py-1 text-xs text-secondary">
          {attribution.map((entry, index) => (
            <span key={entry.text}>
              {index > 0 && ' · '}
              {entry.label !== undefined && `${t(`viewer.attribution.${entry.label}`)}: `}
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

        <TimelinePanel
          track={track}
          timeline={timeline}
          timeMs={timeMs}
          playing={playing}
          speed={speed}
          cameraMode={cameraMode}
          onTogglePlay={togglePlay}
          onSeekTo={seekTo}
          onSpeed={setSpeed}
          onCameraMode={setCameraMode}
        />
      </div>
    </div>
  );
}

export default Scene;
