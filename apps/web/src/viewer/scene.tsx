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
  NeverTileDiscardPolicy,
  PolylineGeometry,
  PolylineMaterialAppearance,
  Primitive,
  sampleTerrainMostDetailed,
  type TerrainProvider,
  type TileProviderError,
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
  pinchBy,
  poseFor,
  wheelZoomInPx,
  zoomBy,
  type CameraAdjust,
} from './camera-input';
import { travelCourse } from './camera-course';
import { cameraTarget, easeHalfWidth, targetHalfWidthS } from './camera-target';
import { addGlider } from './glider';
import { gliderAttitude } from './glider-attitude';
import {
  CAMERA_POSES,
  DEFAULT_CAMERA_MODE,
  frameSeconds,
  nearestHeading,
  springHeading,
  type HeadingState,
  type CameraMode,
} from './camera-modes';
import type { DecodedTrack } from './decode-track';
import { setupFlightClock, type FlightClock } from './flight-clock';
import {
  calibrateAltitudes,
  fillTerrain,
  flightRange,
  groundAnchor,
  groundOffset,
  groundWindow,
  settleOnGround,
  terrainSampleIndices,
  type FlightRange,
} from './ground-calibration';
import { DEFAULT_PLAYBACK_SPEED, indexAt, type PlaybackSpeed, seekBy, timelineOf } from './playback';
import { fetchImageryCapabilities } from './imagery-capabilities';
import {
  availableImagery,
  collapsedAttribution,
  imagerySourceById,
  imagerySources,
  readViewerConfig,
  terrainSource,
  tileFailureTracker,
  type AttributionEntry,
  type ImageryId,
  type ImagerySource,
  type ViewerConfig,
} from './providers';
import { AnalyticsPanel, type SelectedSegment } from './AnalyticsPanel';
import { useFlightAnalytics } from './flight-analytics';
import { SummaryPanel } from './SummaryPanel';
import { TimelinePanel } from './TimelinePanel';
import { VarioLegend } from './VarioLegend';
import { buildTrackGeometry } from './track-geometry';
import { currentColumn, thermalColumns, type ThermalColumn } from './thermal-columns';
import { ThermalLayer } from './thermal-layer';
import { TrackLayer } from './track-layer';
import {
  COMPACT_MEDIA_QUERY,
  DEFAULT_TRACK_SHOWN,
  flownVertexCount,
  trackWidths,
  type TrackShown,
} from './track-progress';
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
  /** id полёта в API — для аналитики; null — демо-трек, панели нет. */
  flightId?: string | null;
  /**
   * Свечение под треком (ТЗ §7.3). По умолчанию выключено: прозрачный примитив
   * рисуется в проходе после непрозрачного, то есть ложится ПОВЕРХ цветной линии
   * и размывает раскраску по вариометру.
   */
  showGlow?: boolean;
}

/** Перелёт свободной камеры к сегменту из аналитики: длительность, наклон, дальность в радиусах сегмента. */
const SEGMENT_FLIGHT_S = 1.2;
const SEGMENT_PITCH_DEG = -35;
const SEGMENT_RANGE_FACTOR = 3;

/** ТЗ §7.2: основная линия 3–5 px, свечение — шире и приглушённее. */
const GLOW_WIDTH_PX = 12;
const GLOW_INTENSITY = 0.25;
const SHADOW_ALPHA = 0.42;
/** Основная кнопка мыши (PointerEvent.button): ею облетают пилота. */
const PRIMARY_BUTTON = 0;

/** Ответ /api/v1/imagery меняется только с перезапуском API — минуты хватит. */
const IMAGERY_CAPABILITIES_STALE_MS = 60_000;

/**
 * Высоты рельефа у старта и посадки ждём не дольше 4 с: медленный Re:Earth не
 * должен задерживать сцену. По длинной ходьбе (подъём пешком — часы) — ещё до 6 с.
 */
const CALIBRATION_TIMEOUT_MS = 4000;
const WALK_TERRAIN_TIMEOUT_MS = 6000;

/** Высоты рельефа в точках трека или null, если не пришли вовремя. */
async function sampleTerrain(
  terrain: TerrainProvider,
  track: DecodedTrack,
  indices: readonly number[],
  timeoutMs: number,
): Promise<number[] | null> {
  if (indices.length === 0) return [];
  const places = indices.map((i) => Cartographic.fromDegrees(track.lon[i] ?? Number.NaN, track.lat[i] ?? Number.NaN));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  const sampled = await Promise.race([sampleTerrainMostDetailed(terrain, places), timeout]).catch(() => null);
  clearTimeout(timer);
  return sampled ? sampled.map((place) => place.height) : null;
}

/**
 * Трек для сцены, откалиброванный по земле (ground-calibration.ts): полёт
 * сдвигается поправками старта и посадки, ходьба до взлёта и после посадки
 * ложится ровно на рельеф — тот, который сцена рисует. Рельеф спрашивается
 * в два захода: точно у старта и посадки (без них калибровки нет) и редко по
 * длинной ходьбе (не пришло — ходьба остаётся со сдвигом стартовой поправки).
 * Данные трека не меняются.
 */
async function calibratedForScene(
  terrain: TerrainProvider,
  track: DecodedTrack,
  range: FlightRange,
): Promise<DecodedTrack> {
  const { exact, sparse } = terrainSampleIndices(track.t, range);
  const exactHeights = await sampleTerrain(terrain, track, exact, CALIBRATION_TIMEOUT_MS);
  if (!exactHeights) return track;

  const terrainHeights = new Float64Array(track.pointCount).fill(Number.NaN);
  exact.forEach((i, k) => {
    terrainHeights[i] = exactHeights[k] ?? Number.NaN;
  });
  const [start, end] = (['start', 'end'] as const).map((side) => {
    const indices = groundWindow(track.t, range, side);
    const offset = groundOffset(
      indices.map((i) => track.alt[i] ?? Number.NaN),
      indices.map((i) => terrainHeights[i] ?? Number.NaN),
    );
    return groundAnchor(track.t, indices, offset, side);
  });
  const calibrated = calibrateAltitudes(track.t, track.alt, start ?? null, end ?? null);

  const walkHeights = await sampleTerrain(terrain, track, sparse, WALK_TERRAIN_TIMEOUT_MS);
  if (!walkHeights) return { ...track, alt: settleOnGround(track.t, calibrated, terrainHeights, range) };
  sparse.forEach((i, k) => {
    terrainHeights[i] = walkHeights[k] ?? Number.NaN;
  });
  const filled = fillTerrain(track.t, terrainHeights, range);
  return { ...track, alt: settleOnGround(track.t, calibrated, filled, range) };
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

/**
 * HTTP-статус упавшего тайла. Cesium кладёт в `error` RequestErrorEvent со
 * `statusCode`; у сетевого сбоя статуса нет — undefined.
 */
function httpStatusOf(error: TileProviderError): number | undefined {
  const cause: unknown = error.error;
  if (typeof cause !== 'object' || cause === null || !('statusCode' in cause)) return undefined;
  return typeof cause.statusCode === 'number' ? cause.statusCode : undefined;
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
  return new ImageryLayer(
    new UrlTemplateImageryProvider({
      url: source.url,
      maximumLevel: source.maximumLevel,
      // Политика «ничего не отбрасывать» заставляет Cesium грузить тайл через
      // XHR во всех браузерах — только так в ошибке есть HTTP-статус (httpStatusOf),
      // и 404 «тайла нет» отличим от отказа подложки. Без неё Safari грузит <img>.
      tileDiscardPolicy: new NeverTileDiscardPolicy(),
    }),
  );
}

export function Scene({ track, flightId = null, showGlow = false }: SceneProps) {
  const t = useT();
  const container = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const clockRef = useRef<FlightClock | null>(null);
  const cameraModeRef = useRef<CameraMode>(DEFAULT_CAMERA_MODE);
  const smoothHeadingRef = useRef<HeadingState | null>(null);
  const glowRef = useRef<Primitive | null>(null);
  const [trackShown, setTrackShown] = useState<TrackShown>(DEFAULT_TRACK_SHOWN);
  const trackShownRef = useRef<TrackShown>(DEFAULT_TRACK_SHOWN);
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
  const [attributionOpen, setAttributionOpen] = useState(false);
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
  /** Трек сцены — откалиброванный по земле; колонны термиков строятся по нему. */
  const [sceneTrack, setSceneTrack] = useState<DecodedTrack | null>(null);
  const [columnsShown, setColumnsShown] = useState(true);
  const thermalLayerRef = useRef<ThermalLayer | null>(null);
  const columnsRef = useRef<ThermalColumn[]>([]);

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
        // Free: левая кнопка и один палец — облёт пилота (обработчик ниже), как
        // в Chase; штатное «тащить глобус» Cesium уехало на правую кнопку. На
        // телефоне иначе вокруг пилота было не повернуть: Ctrl там нет.
        // Зум — колесо и щипок; наклон — средняя кнопка, Ctrl + правая и два пальца.
        controller.rotateEventTypes = [CameraEventType.RIGHT_DRAG];
        controller.zoomEventTypes = [CameraEventType.WHEEL, CameraEventType.PINCH];
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
        const range = flightRange(track.t, track.gSpeed);
        const shown = await calibratedForScene(terrain, track, range);
        if (disposed) return;
        setSceneTrack(shown);

        // Ходьба до взлёта и после посадки — серым: вариометр там — шум GPS на месте.
        const [r = 0, g = 0, b = 0, a = 0] = Color.fromCssColorString(documentColorTokens().secondary).toBytes();
        const geometry = buildTrackGeometry(shown, {
          flight: range,
          groundRgba: [r, g, b, a],
        });
        const positions = Cartesian3.fromDegreesArrayHeights(Array.from(geometry.positions));

        // Свечение — целиком (по умолчанию выключено); в режиме «Пройденный» скрыто.
        if (showGlow) {
          const glow = new Primitive({
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
          });
          scene.primitives.add(glow);
          glowRef.current = glow;
        }

        // Линия и тень — кусками, чтобы показывать только пройденный путь (track-layer.ts).
        // Толщина — по экрану: на телефоне 4 px — полоса поперёк долины.
        const widths = trackWidths(window.matchMedia(COMPACT_MEDIA_QUERY).matches);
        const layer = new TrackLayer(scene, geometry, positions, {
          linePx: widths.linePx,
          shadowPx: widths.shadowPx,
          shadowColor: new Color(0, 0, 0, SHADOW_ALPHA),
        });
        const flightClock = setupFlightClock(viewer, shown);
        clockRef.current = flightClock;
        // Пилот — модель параплана: курс по сглаженной траектории, крен в вираже.
        // На земле (до взлёта, после посадки) — без крена.
        addGlider(viewer, flightClock.position, (timeMs) => {
          const at = indexAt(track.t, timeMs);
          return gliderAttitude(shown, timeMs, at >= range.takeoff && at <= range.landing);
        });

        // Кадровый обработчик: время → HUD и камера. Состояние React обновляется
        // только при смене точки, иначе перерисовка шла бы 60 раз в секунду.
        let lastIndex = -1;
        let lastFrameMs: number | null = null;
        let halfWidthS: number | null = null;
        const onPreRender = (): void => {
          const frameNowMs = performance.now();
          const elapsedS = frameSeconds(lastFrameMs, frameNowMs);
          lastFrameMs = frameNowMs;
          const current = flightClock.currentTimeMs();
          const index = indexAt(track.t, current);
          if (index !== lastIndex) {
            lastIndex = index;
            setTimeMs(current);
          }
          layer.update(trackShownRef.current, flownVertexCount(geometry.sourceIndex, index));
          // Тень строится асинхронно: пока её куски не готовы, кадры нужны и в покое.
          if (layer.pending) scene.requestRender();

          const mode = cameraModeRef.current;
          const modePose = CAMERA_POSES[mode];
          const adjust = adjustRef.current;
          if (mode === 'free' || !modePose || !adjust || !viewer) return;
          // Камера смотрит не на сырую точку пилота, а на сглаженную траекторию
          // (camera-target.ts): у сырой скорость скачет на каждом фиксе — кадр
          // дёргался. Окно — в долях секунды экрана, поэтому растёт со скоростью.
          halfWidthS = easeHalfWidth(halfWidthS, targetHalfWidthS(viewer.clock.multiplier), elapsedS);
          const aim = cameraTarget(shown, current, halfWidthS);
          if (![aim.lat, aim.lon, aim.alt].every(Number.isFinite)) return;
          const position = Cartesian3.fromDegrees(aim.lon, aim.lat, aim.alt);

          // Сглаживается только курс полёта; поправка мыши применяется сразу.
          // Курс — направление перемещения за окно (camera-course.ts): в термике
          // он держит снос, а не обходит круг. Поворот к нему — пружиной, без
          // рывка на старте. Курса нет (стоим, крутим без сноса) — камера плавно
          // тормозит; на первом кадре — ближайший курс из трека.
          const course = modePose.headingDeg ?? travelCourse(track, current);
          const previous = smoothHeadingRef.current;
          const target = Number.isNaN(course) && previous === null ? nearestHeading(track.heading, index) : course;
          smoothHeadingRef.current = springHeading(previous, target, elapsedS);
          const pose = poseFor(mode, adjust, smoothHeadingRef.current.headingDeg);
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

  /** «Весь / Пройденный»: применяется в кадре (onPreRender), здесь — только перерисовка. */
  useEffect(() => {
    trackShownRef.current = trackShown;
    if (glowRef.current) glowRef.current.show = trackShown === 'all';
    viewerRef.current?.scene.requestRender();
  }, [trackShown]);

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
   * облёт вокруг него. В Free левая кнопка и один палец тоже облетают пилота,
   * остальное (правая — сдвиг, колесо и щипок — зум) штатное от Cesium.
   */
  useEffect(() => {
    const element = container.current;
    if (!element) return undefined;
    let drag: { x: number; y: number; kind: 'follow' | 'free-orbit' } | null = null;
    // Пальцы на экране: два — щипок (дистанция до пилота), один — облёт.
    const touches = new Map<number, { x: number; y: number }>();
    let pinchDistance: number | null = null;
    const touchSpread = (): number | null => {
      const [a, b] = [...touches.values()];
      return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : null;
    };

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
      // Облёт в Free — кроме Shift + левой: это у Cesium «оглядеться».
      if (event.pointerType === 'touch') {
        touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (touches.size >= 2) {
          // Второй палец — это щипок, а не облёт: облёт гасим до отпускания.
          drag = null;
          pinchDistance = touchSpread();
          return;
        }
      }
      if (event.button !== PRIMARY_BUTTON) return;
      if (follow()) {
        drag = { x: event.clientX, y: event.clientY, kind: 'follow' };
      } else if (cameraModeRef.current === 'free' && !event.shiftKey) {
        drag = { x: event.clientX, y: event.clientY, kind: 'free-orbit' };
      }
      // Свой захват указателя не ставим: Cesium уже захватил его на canvas.
      // Перехват на контейнер уводил pointerup мимо canvas — Cesium считал
      // кнопку зажатой и тащил камеру после отпускания. События с canvas
      // всплывают сюда и так.
    };
    const onPointerMove = (event: PointerEvent): void => {
      if (touches.has(event.pointerId)) touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pinchDistance !== null) {
        const mode = follow();
        const spread = touchSpread();
        if (mode && adjustRef.current && spread !== null) {
          adjustRef.current = pinchBy(adjustRef.current, mode, pinchDistance, spread);
          pinchDistance = spread;
          redraw();
        }
        return;
      }
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
    const onPointerUp = (event: PointerEvent): void => {
      touches.delete(event.pointerId);
      if (touches.size < 2) pinchDistance = null;
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

  const analytics = useFlightAnalytics(flightId);
  // Данные запроса стабильны между рендерами, в отличие от объекта состояния вокруг них.
  const analyticsData = analytics?.status === 'ready' ? analytics.analytics : null;

  // Колонны термиков (ТЗ §7.2): по треку сцены, когда есть и он, и аналитика.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !sceneTrack || !analyticsData) return undefined;
    const columns = thermalColumns(
      sceneTrack,
      analyticsData.thermals.map((th) => ({
        startMs: Date.parse(th.startedAt),
        endMs: Date.parse(th.endedAt),
        avgClimbMs: th.avgClimbMs,
        avgRadiusM: th.avgRadiusM,
      })),
    );
    const layer = new ThermalLayer(viewer.scene, columns);
    columnsRef.current = columns;
    thermalLayerRef.current = layer;
    viewer.scene.requestRender();
    return () => {
      layer.destroy();
      thermalLayerRef.current = null;
      columnsRef.current = [];
    };
  }, [sceneTrack, analyticsData]);

  useEffect(() => {
    thermalLayerRef.current?.setVisible(columnsShown);
    viewerRef.current?.scene.requestRender();
  }, [columnsShown, sceneTrack, analyticsData]);

  // Термик, в котором пилот: со стороны (Free, Top) — плотнее; из следящей камеры,
  // которая у самого пилота, то есть у стенки колонны, — скрыт.
  useEffect(() => {
    const style = cameraMode === 'free' || cameraMode === 'top' ? 'highlight' : 'hide';
    thermalLayerRef.current?.setCurrent(currentColumn(columnsRef.current, timeMs), style);
  }, [timeMs, cameraMode, sceneTrack, analyticsData]);

  /**
   * Клик по сегменту в аналитике: время — на его начало. Следящие камеры
   * (Chase, Side, Cockpit, Top) придут за пилотом сами; свободная — перелетает
   * к сегменту так, чтобы он целиком был в кадре.
   */
  const selectSegment = useCallback(
    (segment: SelectedSegment) => {
      seekTo(segment.startMs);
      const viewer = viewerRef.current;
      if (!viewer || cameraModeRef.current !== 'free') return;
      const from = indexAt(track.t, segment.startMs);
      const to = indexAt(track.t, segment.endMs);
      const points: Cartesian3[] = [];
      for (let i = from; i <= to; i++) {
        points.push(Cartesian3.fromDegrees(track.lon[i] ?? 0, track.lat[i] ?? 0, track.alt[i] ?? 0));
      }
      if (points.length === 0) return;
      const sphere = BoundingSphere.fromPoints(points);
      viewer.camera.flyToBoundingSphere(sphere, {
        duration: SEGMENT_FLIGHT_S,
        offset: new HeadingPitchRange(viewer.camera.heading, CesiumMath.toRadians(SEGMENT_PITCH_DEG), sphere.radius * SEGMENT_RANGE_FACTOR),
      });
    },
    [seekTo, track],
  );

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
      stopTileWatch.current = layer.imageryProvider.errorEvent.addEventListener((error: TileProviderError) => {
        if (tracker.failed(httpStatusOf(error))) switchImagery('sentinel2', t('viewer.imagery.fallback'));
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
      {/* touch-none: жесты на сцене — камере, а не прокрутке и зуму страницы. */}
      <div ref={container} className="h-full w-full touch-none" data-testid="cesium-container" />

      {/*
        Верх сцены — один ряд с переносом: на узком экране подложка уходит под
        сводку, а не наезжает на неё. Пустое место ряда пропускает жесты к сцене.
        Отступы — не меньше выреза экрана (viewport-fit=cover).
      */}
      <div className="pointer-events-none absolute left-4 right-4 top-4 flex flex-wrap items-start gap-2 compact:left-[max(0.5rem,env(safe-area-inset-left))] compact:right-[max(0.5rem,env(safe-area-inset-right))] compact:top-[max(0.5rem,env(safe-area-inset-top))]">
        <div className="pointer-events-auto flex flex-col gap-2">
          <SummaryPanel summary={track.summary} />
          {error !== null && (
            <p role="alert" className="glass rounded-xl px-3 py-2 text-danger">
              {error}
            </p>
          )}
        </div>

        <div className="pointer-events-auto ml-auto flex flex-col items-end gap-2">
        <div data-panel="imagery" className="flex flex-col gap-2 rounded-xl glass p-3 text-sm compact:gap-1 compact:p-1">
          <span className="text-secondary compact:hidden">{t('viewer.imagery')}</span>
          <div role="group" aria-label={t('viewer.imagery')} className="flex gap-1">
            {shownSources.map((source) => (
              <button
                key={source.id}
                type="button"
                aria-pressed={source.id === imagery}
                onClick={() => switchImagery(source.id)}
                className="rounded px-2 py-1 text-secondary aria-pressed:bg-subtle aria-pressed:text-primary compact:min-h-11"
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
          <span className="numeric text-secondary compact:hidden">
            {t('viewer.points')}: {track.pointCount}
          </span>
        </div>
        {analytics !== null && (
          <AnalyticsPanel
            state={analytics}
            timeline={timeline}
            timeMs={timeMs}
            onSelect={selectSegment}
            columnsShown={columnsShown}
            onColumnsShown={setColumnsShown}
          />
        )}
        </div>
      </div>

      {/*
        Атрибуция и таймлайн — один прижатый к низу поток, а не два блока
        с отступами: при фиксированном bottom панель накрывала атрибуцию,
        а она обязательна по лицензиям и не скрывается (ТЗ §4.4, §11.3).
      */}
      <div className="absolute bottom-0 left-0 right-0">
        <div className="px-4 pb-2 compact:px-2 compact:pb-1">
          <VarioLegend />
        </div>

        {/*
          На телефоне атрибуция свёрнута до названий источников и «Powered by
          Esri» (collapsedAttribution), полный текст — по кнопке. Не скрывается.
        */}
        <div data-panel="attribution" className="flex items-start bg-void/70 text-xs text-secondary compact:text-2xs">
          <AttributionLine entries={attribution} className={attributionOpen ? '' : 'compact:hidden'} />
          <AttributionLine
            entries={collapsedAttribution(attribution)}
            className={attributionOpen ? 'hidden' : 'hidden compact:block'}
          />
          <button
            type="button"
            aria-expanded={attributionOpen}
            aria-label={attributionOpen ? t('viewer.attribution.less') : t('viewer.attribution.more')}
            onClick={() => setAttributionOpen((open) => !open)}
            className="hidden min-h-8 px-3 text-primary compact:block"
          >
            {attributionOpen ? '▴' : '▾'}
          </button>
        </div>

        <TimelinePanel
          track={track}
          timeline={timeline}
          timeMs={timeMs}
          playing={playing}
          speed={speed}
          cameraMode={cameraMode}
          trackShown={trackShown}
          onTrackShown={setTrackShown}
          onTogglePlay={togglePlay}
          onSeekTo={seekTo}
          onSpeed={setSpeed}
          onCameraMode={setCameraMode}
        />
      </div>
    </div>
  );
}

/** Строка атрибуции: подпись «Рельеф» / «Подложка» переводится, текст лицензии — дословно. */
function AttributionLine({ entries, className }: { entries: readonly AttributionEntry[]; className: string }) {
  const t = useT();
  return (
    <p className={`flex-1 px-3 py-1 ${className}`}>
      {entries.map((entry, index) => (
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
  );
}

export default Scene;
