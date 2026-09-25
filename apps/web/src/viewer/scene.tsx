import {
  ArcType,
  BoundingSphere,
  CameraEventType,
  Cartesian3,
  Cartographic,
  CesiumTerrainProvider,
  Color,
  GeographicTilingScheme,
  GeometryInstance,
  HeadingPitchRange,
  ImageryLayer,
  KeyboardEventModifier,
  Material,
  Math as CesiumMath,
  Matrix4,
  PolylineColorAppearance,
  PolylineGeometry,
  PolylineMaterialAppearance,
  Primitive,
  sampleTerrainMostDetailed,
  type TerrainProvider,
  Transforms,
  UrlTemplateImageryProvider,
  Viewer,
  WebMapTileServiceImageryProvider,
} from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { documentColorTokens } from '../design/tokens';
import { useT } from '../i18n/locale';
import {
  FREE_CAMERA,
  hprFromOffset,
  initialAdjust,
  orbitAroundPilot,
  orbitBy,
  poseFor,
  wheelZoomInPx,
  zoomBy,
  type CameraAdjust,
} from './camera-input';
import { CAMERA_POSES, DEFAULT_CAMERA_MODE, nearestHeading, smoothHeading, type CameraMode } from './camera-modes';
import type { DecodedTrack } from './decode-track';
import { setupFlightClock, type FlightClock } from './flight-clock';
import {
  calibrateAltitudes,
  flightRange,
  GROUND_CALIBRATION,
  groundAnchor,
  groundOffset,
  groundSegment,
  settleOnGround,
  type FlightRange,
} from './ground-calibration';
import { DEFAULT_PLAYBACK_SPEED, indexAt, MS_PER_SECOND, type PlaybackSpeed, seekBy, timelineOf } from './playback';
import { fetchImageryCapabilities } from './imagery-capabilities';
import {
  availableImagery,
  imagerySourceById,
  imagerySources,
  readViewerConfig,
  terrainSource,
  tileFailureTracker,
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
/** Основная кнопка мыши (PointerEvent.button): ею облетают пилота. */
const PRIMARY_BUTTON = 0;

/** Ответ /api/v1/imagery меняется только с перезапуском API — минуты хватит. */
const IMAGERY_CAPABILITIES_STALE_MS = 60_000;

/** Высоты рельефа для калибровки ждём не дольше 4 с: медленный Re:Earth не должен задерживать сцену. */
const CALIBRATION_TIMEOUT_MS = 4000;

/**
 * Трек для сцены, откалиброванный по земле (ground-calibration.ts): полёт
 * сдвигается поправками старта и посадки, ходьба до взлёта и после посадки
 * ложится ровно на рельеф — тот, который сцена рисует. Нет ответа рельефа —
 * трек как есть. Данные трека не меняются.
 */
async function calibratedForScene(
  terrain: TerrainProvider,
  track: DecodedTrack,
  range: FlightRange,
): Promise<DecodedTrack> {
  const n = track.pointCount;
  const onGround: number[] = [];
  // Рельеф нужен для ходьбы и для плавного перехода в первые/последние секунды полёта.
  const transitionMs = GROUND_CALIBRATION.transitionS * MS_PER_SECOND;
  const takeoffMs = track.t[range.takeoff] ?? Number.NaN;
  const landingMs = track.t[range.landing] ?? Number.NaN;
  for (let i = 0; i < n; i++) {
    const tMs = track.t[i] ?? Number.NaN;
    if (tMs <= takeoffMs + transitionMs || tMs >= landingMs - transitionMs) onGround.push(i);
  }
  if (onGround.length === 0) return track;

  const places = onGround.map((i) => Cartographic.fromDegrees(track.lon[i] ?? Number.NaN, track.lat[i] ?? Number.NaN));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), CALIBRATION_TIMEOUT_MS);
  });
  const sampled = await Promise.race([sampleTerrainMostDetailed(terrain, places), timeout]).catch(() => null);
  clearTimeout(timer);
  if (!sampled) return track;

  const terrainHeights = new Float64Array(n).fill(Number.NaN);
  onGround.forEach((i, k) => {
    terrainHeights[i] = sampled[k]?.height ?? Number.NaN;
  });
  const [start, end] = (['start', 'end'] as const).map((side) => {
    const indices = groundSegment(track.t, track.lat, track.lon, track.gSpeed, side);
    const offset = groundOffset(
      indices.map((i) => track.alt[i] ?? Number.NaN),
      indices.map((i) => terrainHeights[i] ?? Number.NaN),
    );
    return groundAnchor(track.t, indices, offset, side);
  });
  const calibrated = calibrateAltitudes(track.t, track.alt, start ?? null, end ?? null);
  return { ...track, alt: settleOnGround(track.t, calibrated, terrainHeights, range) };
}

/** Поправки мыши для следящего режима; у Free их нет — там управляет Cesium. */
const adjustFor = (mode: CameraMode): CameraAdjust | null => (mode === 'free' ? null : initialAdjust(mode));

/**
 * Штатное управление Cesium — только в Free. В следящих режимах камеру ставит
 * кадр, и ввод Cesium он бы перезаписывал: мышь там меняет поправки (camera-input).
 */
function applyCameraInputs(viewer: Viewer, mode: CameraMode): void {
  viewer.scene.screenSpaceCameraController.enableInputs = mode === 'free';
}

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
  const adjustRef = useRef<CameraAdjust | null>(adjustFor(DEFAULT_CAMERA_MODE));

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
  // Кнопки — только для подложек, которые сервер подтвердил. Сам Viewer строится
  // по полному списку: смена sources в его зависимостях пересоздала бы сцену
  // и сбросила бы время проигрывания, когда придёт ответ.
  const capabilities = useQuery({
    queryKey: ['imagery-capabilities'],
    queryFn: ({ signal }) => fetchImageryCapabilities(signal),
    staleTime: IMAGERY_CAPABILITIES_STALE_MS,
    retry: false,
  });
  const shownSources = useMemo(() => availableImagery(sources, capabilities.data), [sources, capabilities.data]);
  const [imageryNotice, setImageryNotice] = useState<string | null>(null);
  const stopTileWatch = useRef<(() => void) | null>(null);
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
        const controller = scene.screenSpaceCameraController;
        controller.zoomFactor = FREE_CAMERA.zoomFactor;
        controller.inertiaZoom = FREE_CAMERA.inertiaZoom;
        controller.inertiaSpin = FREE_CAMERA.inertiaSpin;
        controller.inertiaTranslate = FREE_CAMERA.inertiaTranslate;
        controller.minimumZoomDistance = FREE_CAMERA.minimumZoomDistanceM;
        // Ctrl + левая кнопка в Free — облёт пилота (обработчик ниже), а не
        // штатный наклон вокруг центра экрана. Наклон остаётся на средней
        // кнопке, Ctrl + правой и жесте двумя пальцами.
        controller.tiltEventTypes = [
          CameraEventType.MIDDLE_DRAG,
          CameraEventType.PINCH,
          { eventType: CameraEventType.RIGHT_DRAG, modifier: KeyboardEventModifier.CTRL },
        ];
        applyCameraInputs(viewer, cameraModeRef.current);
        scene.globe.depthTestAgainstTerrain = true;
        scene.globe.enableLighting = true;
        scene.debugShowFramesPerSecond = import.meta.env.DEV;
        // Штатный блок кредитов Cesium скрыт: все обязательные строки лицензий
        // (Re:Earth, EOX, Esri) выводит наш блок атрибуции, иначе они наложатся.
        const credits = viewer.cesiumWidget.creditContainer;
        if (credits instanceof HTMLElement) credits.style.display = 'none';

        // Линия и пилот — по высоте, откалиброванной по земле; телеметрия — по данным.
        const range = flightRange(track.t, track.lat, track.lon, track.gSpeed);
        const shown = await calibratedForScene(terrain, track, range);
        if (disposed) return;

        // Ходьба до взлёта и после посадки — серым: вариометр там — шум GPS на месте.
        const [r = 0, g = 0, b = 0, a = 0] = Color.fromCssColorString(documentColorTokens().secondary).toBytes();
        const geometry = buildTrackGeometry(shown, {
          flight: range,
          groundRgba: [r, g, b, a],
        });
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
                  color: Color.fromCssColorString(documentColorTokens().accent).withAlpha(GLOW_INTENSITY),
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

        const flightClock = setupFlightClock(viewer, shown);
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

          const mode = cameraModeRef.current;
          const modePose = CAMERA_POSES[mode];
          const adjust = adjustRef.current;
          if (mode === 'free' || !modePose || !adjust || !viewer) return;
          const position = flightClock.position.getValue(viewer.clock.currentTime);
          if (!position) return;

          // Сглаживается только курс полёта; поправка мыши применяется сразу.
          const target = modePose.headingDeg ?? nearestHeading(track.heading, index);
          const elapsedS = Math.abs(viewer.clock.multiplier) / ASSUMED_FPS;
          smoothHeadingRef.current = smoothHeading(smoothHeadingRef.current, target, elapsedS);
          const pose = poseFor(mode, adjust, smoothHeadingRef.current);
          // NaN в lookAt останавливает рендер Cesium целиком — лучше пропустить кадр.
          if (![pose.headingDeg, pose.pitchDeg, pose.rangeM].every(Number.isFinite)) return;
          viewer.camera.lookAt(
            position,
            new HeadingPitchRange(
              CesiumMath.toRadians(pose.headingDeg),
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
    adjustRef.current = adjustFor(cameraMode);
    const viewer = viewerRef.current;
    if (!viewer) return;
    applyCameraInputs(viewer, cameraMode);
    // При выходе из слежения обязательно снять трансформацию камеры, иначе
    // свободное вращение пойдёт вокруг старой точки (ТЗ §7.4).
    if (CAMERA_POSES[cameraMode] === null) viewer.camera.lookAtTransform(Matrix4.IDENTITY);
    viewer.scene.requestRender();
  }, [cameraMode]);

  /**
   * Мышь в следящих режимах: колесо — дистанция до пилота, перетаскивание —
   * облёт вокруг него. В Free всё штатное от Cesium, кроме Ctrl + левой
   * кнопки: она облетает пилота, как в Chase.
   */
  useEffect(() => {
    const element = container.current;
    if (!element) return undefined;
    let drag: { x: number; y: number; kind: 'follow' | 'free-orbit' } | null = null;

    const follow = (): Exclude<CameraMode, 'free'> | null => {
      const mode = cameraModeRef.current;
      return mode === 'free' || !adjustRef.current ? null : mode;
    };
    const redraw = (): void => viewerRef.current?.scene.requestRender();

    const onWheel = (event: WheelEvent): void => {
      const mode = follow();
      if (!mode || !adjustRef.current) return;
      event.preventDefault();
      adjustRef.current = zoomBy(adjustRef.current, mode, wheelZoomInPx(event));
      redraw();
    };
    /** Облёт пилота в Free: камера остаётся свободной, меняется только её место. */
    const orbitPilot = (dx: number, dy: number): void => {
      const viewer = viewerRef.current;
      const pilot = viewer ? clockRef.current?.position.getValue(viewer.clock.currentTime) : undefined;
      if (!viewer || !pilot) return;
      const toLocal = Matrix4.inverseTransformation(Transforms.eastNorthUpToFixedFrame(pilot), new Matrix4());
      const local = Matrix4.multiplyByPoint(toLocal, viewer.camera.positionWC, new Cartesian3());
      const next = orbitAroundPilot(hprFromOffset({ east: local.x, north: local.y, up: local.z }), dx, dy);
      viewer.camera.lookAt(
        pilot,
        new HeadingPitchRange(CesiumMath.toRadians(next.headingDeg), CesiumMath.toRadians(next.pitchDeg), next.rangeM),
      );
      viewer.camera.lookAtTransform(Matrix4.IDENTITY);
    };

    const onPointerDown = (event: PointerEvent): void => {
      if (event.button !== PRIMARY_BUTTON) return;
      if (follow()) {
        drag = { x: event.clientX, y: event.clientY, kind: 'follow' };
      } else if (cameraModeRef.current === 'free' && event.ctrlKey) {
        drag = { x: event.clientX, y: event.clientY, kind: 'free-orbit' };
      }
      // Свой захват указателя не ставим: Cesium уже захватил его на canvas.
      // Перехват на контейнер уводил pointerup мимо canvas — Cesium считал
      // кнопку зажатой и тащил камеру после отпускания. События с canvas
      // всплывают сюда и так.
    };
    const onPointerMove = (event: PointerEvent): void => {
      if (!drag) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      drag = { ...drag, x: event.clientX, y: event.clientY };
      const mode = follow();
      if (drag.kind === 'follow' && mode && adjustRef.current) {
        adjustRef.current = orbitBy(adjustRef.current, mode, dx, dy);
      } else if (drag.kind === 'free-orbit' && cameraModeRef.current === 'free') {
        orbitPilot(dx, dy);
      } else {
        return;
      }
      redraw();
    };
    const onPointerUp = (): void => {
      drag = null;
    };

    element.addEventListener('wheel', onWheel, { passive: false });
    element.addEventListener('pointerdown', onPointerDown);
    element.addEventListener('pointermove', onPointerMove);
    element.addEventListener('pointerup', onPointerUp);
    element.addEventListener('pointercancel', onPointerUp);
    return () => {
      element.removeEventListener('wheel', onWheel);
      element.removeEventListener('pointerdown', onPointerDown);
      element.removeEventListener('pointermove', onPointerMove);
      element.removeEventListener('pointerup', onPointerUp);
      element.removeEventListener('pointercancel', onPointerUp);
    };
  }, []);

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
  const switchImagery = (id: ImageryId, notice: string | null = null): void => {
    const viewer = viewerRef.current;
    const source = config ? imagerySourceById(config, id) : null;
    if (!viewer || !source) return;
    stopTileWatch.current?.();
    stopTileWatch.current = null;
    viewer.imageryLayers.removeAll();
    const layer = createImageryProvider(source);
    viewer.imageryLayers.add(layer);
    // Esri через прокси может перестать отдавать тайлы (истёк ключ, лимит, сбой).
    // Поток ошибок — откат на Sentinel-2 с объяснением, а не синий шар.
    // Для Sentinel-2 отката нет: откатываться некуда, пусть будет видно.
    if (id !== 'sentinel2') {
      const tracker = tileFailureTracker();
      stopTileWatch.current = layer.imageryProvider.errorEvent.addEventListener(() => {
        if (tracker.failed()) switchImagery('sentinel2', t('viewer.imagery.fallback'));
      });
    }
    viewer.scene.requestRender();
    imageryRef.current = id;
    setImagery(id);
    setImageryNotice(notice);
  };

  const active = (config ? imagerySourceById(config, imagery) : null) ?? sources[0] ?? null;
  const attribution = config ? [...terrainSource(config).attribution, ...(active?.attribution ?? [])] : [];

  return (
    <div className="relative h-dvh w-full">
      <div ref={container} className="h-full w-full" data-testid="cesium-container" />

      <div className="absolute left-4 top-4 flex flex-col gap-2">
        <SummaryPanel summary={track.summary} />
        {error !== null && (
          <p role="alert" className="glass rounded-xl px-3 py-2 text-danger">
            {error}
          </p>
        )}
      </div>

      <div className="absolute right-4 top-4 flex flex-col gap-2 rounded-xl glass p-3 text-sm">
        <span className="text-secondary">{t('viewer.imagery')}</span>
        <div role="group" aria-label={t('viewer.imagery')} className="flex gap-1">
          {shownSources.map((source) => (
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
        {imageryNotice !== null && (
          <p role="status" className="max-w-48 text-xs text-danger">
            {imageryNotice}
          </p>
        )}
        <span className="numeric text-secondary">
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
