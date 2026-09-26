import {
  ArcType,
  BoundingSphere,
  CameraEventType,
  Cartesian3,
  Cartographic,
  CesiumTerrainProvider,
  Color,
  GeometryInstance,
  HeadingPitchRange,
  JulianDate,
  KeyboardEventModifier,
  Material,
  Math as CesiumMath,
  Matrix4,
  PerspectiveFrustum,
  PolylineGeometry,
  PolylineMaterialAppearance,
  Primitive,
  sampleTerrain as sampleTerrainAtLevel,
  Transforms,
  Viewer,
} from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
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
import { gliderAttitude, launchHeadingDeg } from './glider-attitude';
import { gliderPose } from './glider-pose';
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
  flightRange,
} from './ground-calibration';
import { DEFAULT_PLAYBACK_SPEED, indexAt, MS_PER_SECOND, type PlaybackSpeed, seekBy, timelineOf } from './playback';
import {
  imagerySourceById,
  readViewerConfig,
  terrainSource,
  type ViewerConfig,
} from './providers';
import { AnalyticsPanel, type SelectedSegment } from './AnalyticsPanel';
import { BottomSheet } from './BottomSheet';
import { useCreateSite, useFlightAnalytics, useOwnGliders, usePrivacyControls, useSetFlightGlider } from './flight-analytics';
import { SummaryLine, SummaryPanel } from './SummaryPanel';
import { ReviewPanel } from '../review/ReviewPanel';
import { shareHash } from '../routing';
import { aglProfile } from './agl';
import { TimelinePanel } from './TimelinePanel';
import { VarioLegend } from './VarioLegend';
import { buildTrackGeometry } from './track-geometry';
import { flownByTime, smoothTrack } from './track-smooth';
import { CURTAIN, curtainInMode, curtainOnByDefault, curtainPieces, curtainSamples, curtainSegmentsShown } from './curtain';
import { CurtainLayer } from './curtain-layer';
import { columnStates, thermalColumns, type ThermalColumn } from './thermal-columns';
import { ThermalLayer } from './thermal-layer';
import { XcLayer } from './xc-layer';
import { xcRoute } from './xc-route';
import {
  COMPACT_MEDIA_QUERY,
  DEFAULT_TRACK_SHOWN,
  TRAIL_GAP_S,
  type TrackShown,
} from './track-progress';
import { useHotkeys } from './use-hotkeys';
import { ImageryButtons, SceneAttribution, useSceneImagery } from './scene-imagery';
import { calibratedForScene, createSkylineViewer, lookAtAboveGround, sceneTrackLayer } from './scene-kit';

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
  /** Режим сверки термиков владельцем (DoD фазы 2): панель сверки вместо «Аналитики». */
  review?: boolean;
  /** Токен ссылки «по ссылке» (задача 3.7): идёт в запросы аналитики. */
  share?: string;
  /**
   * Свечение под треком (ТЗ §7.3). По умолчанию выключено: прозрачный примитив
   * рисуется в проходе после непрозрачного, то есть ложится ПОВЕРХ цветной линии
   * и размывает раскраску по вариометру.
   */
  showGlow?: boolean;
  /** Встроен в чужой сайт (задача 3.9): сцена, таймлайн, сводка — без аналитики и настроек. */
  embed?: boolean;
}

/** Перелёт свободной камеры к сегменту из аналитики: длительность, наклон, дальность в радиусах сегмента. */
const SEGMENT_FLIGHT_S = 1.2;
const SEGMENT_PITCH_DEG = -35;
/**
 * Весь XC-маршрут (задача 3.3): сверху под 60° и с севера — треугольник
 * читается формой, как на карте; дальность — два с небольшим радиуса сферы.
 */
const XC_VIEW_PITCH_DEG = -60;
const XC_VIEW_RANGE_FACTOR = 2.4;
const SEGMENT_RANGE_FACTOR = 3;

/** ТЗ §7.2: основная линия 3–5 px, свечение — шире и приглушённее. */
const GLOW_WIDTH_PX = 12;
const GLOW_INTENSITY = 0.25;
/** Основная кнопка мыши (PointerEvent.button): ею облетают пилота. */
const PRIMARY_BUTTON = 0;

/** Поправки мыши для следящего режима; у Free их нет — там управляет Cesium. */
const adjustFor = (mode: CameraMode): CameraAdjust | null => (mode === 'free' ? null : initialAdjust(mode));

/**
 * Штатное управление Cesium — только в Free. В следящих режимах камеру ставит
 * кадр, и ввод Cesium он бы перезаписывал: мышь там меняет поправки (camera-input).
 */
function applyCameraInputs(viewer: Viewer, mode: CameraMode): void {
  viewer.scene.screenSpaceCameraController.enableInputs = mode === 'free';
}


export function Scene({ track, flightId = null, showGlow = false, review = false, share, embed = false }: SceneProps) {
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
  const imagery = useSceneImagery(config, viewerRef);
  const { sources, imageryRef } = imagery;
  const timeline = useMemo(() => timelineOf(track.t), [track]);

  const [error, setError] = useState<string | null>('config' in configured ? null : configured.message);
  const [timeMs, setTimeMs] = useState<number>(timeline.startMs);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<PlaybackSpeed>(DEFAULT_PLAYBACK_SPEED);
  const [cameraMode, setCameraMode] = useState<CameraMode>(DEFAULT_CAMERA_MODE);
  // Занавес (ТЗ §7.2): на телефоне по умолчанию выключен (§5.3).
  const [curtainOn, setCurtainOn] = useState(() =>
    curtainOnByDefault(typeof window !== 'undefined' && window.matchMedia(COMPACT_MEDIA_QUERY).matches),
  );
  const curtainOnRef = useRef(curtainOn);
  const curtainRef = useRef<CurtainLayer | null>(null);
  /** Трек сцены — откалиброванный по земле; колонны термиков строятся по нему. */
  const [sceneTrack, setSceneTrack] = useState<DecodedTrack | null>(null);
  /** Высота над рельефом для графика (задача 2.15); null — рельеф под полётом ещё не пришёл. */
  const [agl, setAgl] = useState<Float64Array | null>(null);
  const [columnsShown, setColumnsShown] = useState(true);
  /** XC-маршрут на сцене (задача 3.3): виден сразу — это итог полёта. */
  const [xcRouteShown, setXcRouteShown] = useState(true);
  const xcLayerRef = useRef<XcLayer | null>(null);
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
        viewer = createSkylineViewer(element, terrain, first ?? null);
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

        // Линия и пилот — по высоте, откалиброванной по земле; телеметрия — по данным.
        const range = flightRange(track.t, track.gSpeed);
        const shown = await calibratedForScene(terrain, track, range);
        if (disposed) return;
        setSceneTrack(shown);

        // Ходьба до взлёта и после посадки — серым: вариометр там — шум GPS на месте.
        const [r = 0, g = 0, b = 0, a = 0] = Color.fromCssColorString(documentColorTokens().secondary).toBytes();
        // Для отрисовки трек сглажен (track-smooth.ts): запись раз в секунду, и круг
        // термика был ломаной из 20 отрезков. Линия, тень и пилот — по одной кривой.
        const smooth = smoothTrack(shown);
        const geometry = buildTrackGeometry(smooth, {
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
        const { layer, vertexTimes } = sceneTrackLayer(scene, geometry, positions, smooth);
        // Занавес: низ — рельеф под прореженными точками, грубый уровень тайлов
        // (CURTAIN.terrainLevel). Опрос идёт параллельно, трек его не ждёт.
        const samples = curtainSamples(range);
        const curtainColor = Color.fromCssColorString(documentColorTokens().primary);
        void sampleTerrainAtLevel(
          terrain,
          CURTAIN.terrainLevel,
          samples.map((i) => Cartographic.fromDegrees(shown.lon[i] ?? 0, shown.lat[i] ?? 0)),
        )
          .then((places) => places.map((place) => place.height))
          .catch(() => samples.map(() => Number.NaN))
          .then((ground) => {
            if (disposed) return;
            const pieces = curtainPieces(samples, curtainSegmentsShown(samples, shown.flags), shown.lat, shown.lon);
            const groundAt = new Map(samples.map((i, k) => [i, ground[k] ?? Number.NaN]));
            // Высота над рельефом для графика (задача 2.15) — по тому же рельефу, что и занавес.
            setAgl(aglProfile(shown.alt, groundAt));
            const curtain = new CurtainLayer(scene, shown, pieces, groundAt, curtainColor);
            curtain.setVisible(curtainOnRef.current && curtainInMode(cameraModeRef.current));
            curtainRef.current = curtain;
            scene.requestRender();
          });
        // Пилот — по той же сглаженной кривой, что и линия: иначе он съезжал бы с неё в вираже.
        const flightClock = setupFlightClock(viewer, { ...shown, t: smooth.t, lat: smooth.lat, lon: smooth.lon, alt: smooth.alt, pointCount: smooth.t.length });
        clockRef.current = flightClock;
        // Пилот — модель параплана: курс по сглаженной траектории, крен в вираже.
        // На земле (до взлёта, после посадки) — без крена.
        const launchHeading = launchHeadingDeg(shown, track.t[range.takeoff] ?? Number.NaN);
        addGlider(
          viewer,
          flightClock.position,
          (timeMs) => {
            const at = indexAt(track.t, timeMs);
            const attitude = gliderAttitude(shown, timeMs, at >= range.takeoff && at <= range.landing);
            // До взлёта стоит на месте — лицом к разбегу: крыло за спиной ляжет вверх по склону.
            return Number.isNaN(attitude.headingDeg) && at <= range.takeoff ? { ...attitude, headingDeg: launchHeading } : attitude;
          },
          // На земле — стоит, идёт, разбег с подъёмом крыла, посадка (glider-pose.ts).
          (timeMs) => gliderPose(track, range, timeMs),
        );

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
          // «Пройденный»: линия, тень и занавес кончаются чуть позади пилота (TRAIL_GAP_S) —
          // не прошивают модель. Конец — по времени этого кадра: между вершинами без ступенек.
          const trailEndMs = Math.max(timeline.startMs, current - TRAIL_GAP_S * MS_PER_SECOND);
          const trailEnd = viewer ? flightClock.position.getValue(JulianDate.fromDate(new Date(trailEndMs))) : undefined;
          layer.update(trackShownRef.current, flownByTime(vertexTimes, trailEndMs), trailEnd, trailEndMs);
          curtainRef.current?.update(trackShownRef.current === 'all' ? null : trailEndMs);
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
          lookAtAboveGround(viewer, position, aim.alt, pose);
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
      curtainRef.current = null;
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
    curtainOnRef.current = curtainOn;
    curtainRef.current?.setVisible(curtainOn && curtainInMode(cameraMode));
    viewerRef.current?.scene.requestRender();
  }, [curtainOn, cameraMode]);

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
      const pilotM = Cartographic.fromCartesian(pilot)?.height ?? Number.NaN;
      lookAtAboveGround(viewer, pilot, pilotM, next);
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

  const analytics = useFlightAnalytics(flightId, share ?? null);
  const privacy = usePrivacyControls(flightId);
  const createSite = useCreateSite(flightId);
  const setGlider = useSetFlightGlider(flightId);
  const ownGliders = useOwnGliders();
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

  // XC-маршрут (задача 3.3): по данным анализа, ППМ — на высоте трека сцены в момент прохождения.
  useEffect(() => {
    const viewer = viewerRef.current;
    const xc = analyticsData?.details.xc;
    const route = xc ? xcRoute(xc) : null;
    if (!viewer || !sceneTrack || !route) return undefined;
    const layer = new XcLayer(
      viewer.scene,
      route,
      Color.fromCssColorString(documentColorTokens().accent),
      (timeMs) => sceneTrack.alt[indexAt(sceneTrack.t, timeMs)] ?? 0,
    );
    xcLayerRef.current = layer;
    viewer.scene.requestRender();
    return () => {
      layer.destroy();
      xcLayerRef.current = null;
    };
  }, [sceneTrack, analyticsData]);

  useEffect(() => {
    xcLayerRef.current?.setVisible(xcRouteShown);
    viewerRef.current?.scene.requestRender();
  }, [xcRouteShown, sceneTrack, analyticsData]);

  useEffect(() => {
    thermalLayerRef.current?.setVisible(columnsShown);
    viewerRef.current?.scene.requestRender();
  }, [columnsShown, sceneTrack, analyticsData]);

  // Термик, в котором пилот: со стороны (Free, Top) — плотнее; из следящей камеры,
  // которая у самого пилота, то есть у стенки колонны, — скрыт. «Пройденный» —
  // колонна появляется, когда пилот входит в термик.
  useEffect(() => {
    const style = cameraMode === 'free' || cameraMode === 'top' ? 'highlight' : 'hide';
    thermalLayerRef.current?.setStates(columnStates(columnsRef.current, { timeMs, style, flown: trackShown === 'flown' }));
  }, [timeMs, cameraMode, trackShown, sceneTrack, analyticsData]);

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

  /** Облёт всего XC-маршрута: свободная камера, затем перелёт (следящая перебила бы его). */
  const pendingXcViewRef = useRef<BoundingSphere | null>(null);
  const showXcRoute = useCallback(() => {
    const xc = analyticsData?.details.xc;
    if (!xc || !sceneTrack) return;
    const points = xc.route.map((p) =>
      Cartesian3.fromDegrees(p.lon, p.lat, sceneTrack.alt[indexAt(sceneTrack.t, p.timeMs)] ?? 0),
    );
    if (points.length === 0) return;
    pendingXcViewRef.current = BoundingSphere.fromPoints(points);
    setXcRouteShown(true);
    setCameraMode('free');
  }, [analyticsData, sceneTrack]);

  useEffect(() => {
    const sphere = pendingXcViewRef.current;
    const viewer = viewerRef.current;
    if (!sphere || !viewer || cameraMode !== 'free') return;
    pendingXcViewRef.current = null;
    // Справа сцену закрывает панель «Аналитика»: прицел сдвигается на восток
    // (камера смотрит на север — восток справа) на половину закрытой ширины,
    // и маршрут встаёт в середину открытой части, а не под панель.
    const canvasPx = viewer.scene.canvas.clientWidth;
    const panelPx = document.querySelector('[data-panel="analytics"]')?.getBoundingClientRect().width ?? 0;
    const rangeM = sphere.radius * XC_VIEW_RANGE_FACTOR;
    const fov = viewer.camera.frustum instanceof PerspectiveFrustum ? (viewer.camera.frustum.fov ?? 1) : 1;
    const visibleWidthM = 2 * rangeM * Math.tan(fov / 2);
    const shiftM = canvasPx > 0 ? (visibleWidthM * panelPx) / canvasPx / 2 : 0;
    const east = Matrix4.multiplyByPointAsVector(
      Transforms.eastNorthUpToFixedFrame(sphere.center),
      new Cartesian3(shiftM, 0, 0),
      new Cartesian3(),
    );
    sphere.center = Cartesian3.add(sphere.center, east, new Cartesian3());
    viewer.camera.flyToBoundingSphere(sphere, {
      duration: SEGMENT_FLIGHT_S,
      offset: new HeadingPitchRange(0, CesiumMath.toRadians(XC_VIEW_PITCH_DEG), rangeM),
    });
  }, [cameraMode, showXcRoute]);

  const editing = {
    ...(createSite ? { onCreateSite: createSite } : {}),
    ...(setGlider ? { onSetGlider: setGlider } : {}),
    gliders: ownGliders,
    xcRouteShown,
    onXcRouteShown: setXcRouteShown,
    onShowXcRoute: showXcRoute,
    ...(privacy ? { privacy } : {}),
  };

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

  const imageryButtons = <ImageryButtons imagery={imagery} />;

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
          {/* На телефоне сводка, подложка и аналитика — в шторке снизу. */}
          <div className="compact:hidden">
            <SummaryPanel summary={track.summary} />
          </div>
          {error !== null && (
            <p role="alert" className="glass rounded-xl px-3 py-2 text-danger">
              {error}
            </p>
          )}
        </div>

        <div className={`pointer-events-auto ml-auto flex flex-col items-end gap-2 ${embed ? '' : 'compact:hidden'}`}>
        {/* Встроенный просмотрщик: вместо аналитики — выход на полную страницу полёта. */}
        {embed && share !== undefined && (
          <a
            data-panel="open-in-app"
            href={`/${shareHash(share)}`}
            target="_blank"
            rel="noopener"
            className="glass flex items-center rounded-xl px-3 py-2 text-sm text-accent compact:min-h-11"
          >
            {t('embed.open')}
          </a>
        )}
        <div data-panel="imagery" className="flex flex-col gap-2 rounded-xl glass p-3 text-sm compact:hidden">
          <span className="text-secondary">{t('viewer.imagery')}</span>
          {imageryButtons}
          <span className="numeric text-secondary">
            {t('viewer.points')}: {track.pointCount}
          </span>
        </div>
        {analytics !== null && review && flightId !== null && (
          <ReviewPanel flightId={flightId} analytics={analytics} timeline={timeline} timeMs={timeMs} onSelect={selectSegment} />
        )}
        {analytics !== null && !review && !embed && (
          <AnalyticsPanel
            state={analytics}
            timeline={timeline}
            timeMs={timeMs}
            onSelect={selectSegment}
            columnsShown={columnsShown}
            onColumnsShown={setColumnsShown}
            {...editing}
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
        {/* На телефоне легенда — в шторке: поверх сцены она съедала высоту. */}
        <div className="px-4 pb-2 compact:hidden">
          <VarioLegend />
        </div>

        {/* Телефон: шторка — сводка всегда видна, остальное по жесту (ТЗ §8.3). */}
        <div className="hidden px-[max(0.5rem,env(safe-area-inset-left))] pb-1 compact:block">
          <BottomSheet summary={<SummaryLine summary={track.summary} />}>
            <div className="flex flex-col gap-3">
              <SummaryPanel summary={track.summary} bare />
              <VarioLegend />
              <div data-panel="sheet-imagery" className="flex items-center justify-between gap-2 text-sm">
                <span className="text-secondary">{t('viewer.imagery')}</span>
                {imageryButtons}
              </div>
              {analytics !== null && review && flightId !== null && (
                <ReviewPanel
                  flightId={flightId}
                  analytics={analytics}
                  timeline={timeline}
                  timeMs={timeMs}
                  onSelect={selectSegment}
                  embedded
                />
              )}
              {analytics !== null && !review && !embed && (
                <AnalyticsPanel
                  state={analytics}
                  timeline={timeline}
                  timeMs={timeMs}
                  onSelect={selectSegment}
                  columnsShown={columnsShown}
                  onColumnsShown={setColumnsShown}
                  embedded
                  {...editing}
                />
              )}
            </div>
          </BottomSheet>
        </div>

        <SceneAttribution entries={imagery.attribution} />

        <TimelinePanel
          track={track}
          timeline={timeline}
          timeMs={timeMs}
          playing={playing}
          speed={speed}
          cameraMode={cameraMode}
          trackShown={trackShown}
          onTrackShown={setTrackShown}
          curtainOn={curtainOn}
          {...(curtainInMode(cameraMode) ? { onCurtainOn: setCurtainOn } : {})}
          onTogglePlay={togglePlay}
          onSeekTo={seekTo}
          onSpeed={setSpeed}
          onCameraMode={setCameraMode}
          agl={agl}
        />
      </div>
    </div>
  );
}

export default Scene;
