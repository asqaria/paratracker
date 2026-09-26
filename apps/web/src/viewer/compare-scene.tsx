import {
  BoundingSphere,
  CallbackPositionProperty,
  Cartesian2,
  Cartesian3,
  CesiumTerrainProvider,
  Color,
  JulianDate,
  LabelStyle,
  Matrix4,
  type SampledPositionProperty,
  type Viewer,
  VerticalOrigin,
} from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { useLocaleStore, useT } from '../i18n/locale';
import { FREE_CAMERA, initialAdjust, orbitBy, poseFor, wheelZoomInPx, zoomBy, type CameraAdjust } from './camera-input';
import { CAMERA_POSES, frameSeconds, nearestHeading, springHeading, type HeadingState } from './camera-modes';
import { travelCourse } from './camera-course';
import { cameraTarget, easeHalfWidth, targetHalfWidthS } from './camera-target';
import { CompareControls } from './CompareControls';
import {
  alignmentOffsets,
  compareTimeline,
  defaultAlignment,
  type CompareAlignment,
  type CompareTrackTimes,
} from './compare-timeline';
import type { DecodedTrack } from './decode-track';
import { toJulian, setupSceneClock, trackPosition } from './flight-clock';
import { addGlider } from './glider';
import { gliderAttitude, launchHeadingDeg } from './glider-attitude';
import { gliderPose } from './glider-pose';
import { flightRange, type FlightRange } from './ground-calibration';
import { DEFAULT_PLAYBACK_SPEED, indexAt, MS_PER_SECOND, type PlaybackSpeed } from './playback';
import { readViewerConfig, terrainSource, type ViewerConfig } from './providers';
import { ImageryButtons, SceneAttribution, useSceneImagery } from './scene-imagery';
import { calibratedForScene, createSkylineViewer, lookAtAboveGround, sceneTrackLayer } from './scene-kit';
import { buildTrackGeometry } from './track-geometry';
import type { TrackLayer } from './track-layer';
import { DEFAULT_TRACK_SHOWN, TRAIL_GAP_S, type TrackShown } from './track-progress';
import { flownByTime, smoothTrack } from './track-smooth';
import { metres, verticalSpeed } from './units';
import { useHotkeys } from './use-hotkeys';

/**
 * Сцена сравнения треков (задача 3.12, ТЗ US-08): до 8 полётов на одном
 * рельефе, одни часы, у каждого пилота свой цвет. Трек — одним цветом
 * пилота: раскраска по вариометру у восьми линий сливалась бы в кашу.
 * Общее с просмотрщиком полёта — в scene-kit и scene-imagery.
 */

export interface CompareFlight {
  /** Ключ полёта в сравнении (compare-refs refKey). */
  key: string;
  track: DecodedTrack;
  color: string;
  /** Имя пилота или «Полёт N». */
  label: string;
  /** Дата и место — вторая строка в списке. */
  detail: string;
  /** IANA-таймзона места старта: часы сравнения — по первому полёту. */
  timezone: string | null;
}

export interface CompareSceneProps {
  flights: CompareFlight[];
  onRemove: (key: string) => void;
  /** Под списком пилотов: добавить полёт, скопировать ссылку (страница сравнения). */
  toolbar?: ReactNode;
}

/** Подпись пилота над моделью: крупнее подписей интерфейса — видна над рельефом. */
const LABEL_FONT = '600 14px Inter, system-ui, sans-serif';
const LABEL_OFFSET_PX = -34;
const LABEL_OUTLINE_PX = 3;
/** Перелёт камеры к «все в кадре». */
const OVERVIEW_FLIGHT_S = 1;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;

/** Всё, что сцена знает о треке после построения. */
interface SceneFlight {
  shown: DecodedTrack;
  track: DecodedTrack;
  range: FlightRange;
  layer: TrackLayer;
  vertexTimes: Float64Array;
  position: SampledPositionProperty;
  positions: Cartesian3[];
}

/** Время трека → «+1:23:45» от взлёта первого (режим «по взлёту»). */
function elapsedLabel(ms: number): string {
  const sign = ms < 0 ? '−' : '+';
  const total = Math.round(Math.abs(ms) / MS_PER_SECOND);
  const h = Math.floor(total / (SECONDS_PER_MINUTE * MINUTES_PER_HOUR));
  const m = Math.floor(total / SECONDS_PER_MINUTE) % MINUTES_PER_HOUR;
  const s = total % SECONDS_PER_MINUTE;
  return `${sign}${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Цвет CSS → RGBA-байты для вершин линии. */
const rgbaOf = (css: string): [number, number, number, number] => {
  const [r = 0, g = 0, b = 0, a = 0] = Color.fromCssColorString(css).toBytes();
  return [r, g, b, a];
};

export function CompareScene({ flights, onRemove, toolbar }: CompareSceneProps) {
  const t = useT();
  const locale = useLocaleStore((state) => state.locale);
  const container = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const sceneFlightsRef = useRef<SceneFlight[]>([]);

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
  const [error, setError] = useState<string | null>('config' in configured ? null : configured.message);

  // Времена треков и взлёт — до сцены: по ним выбирается режим времени.
  const times = useMemo<CompareTrackTimes[]>(
    () =>
      flights.map(({ track }) => {
        const range = flightRange(track.t, track.gSpeed);
        return {
          startMs: track.t[0] ?? Number.NaN,
          endMs: track.t[track.pointCount - 1] ?? Number.NaN,
          takeoffMs: track.t[range.takeoff] ?? Number.NaN,
        };
      }),
    [flights],
  );
  const [alignment, setAlignment] = useState<CompareAlignment>(() => defaultAlignment(times));
  const offsets = useMemo(() => alignmentOffsets(times, alignment), [times, alignment]);
  const timeline = useMemo(() => compareTimeline(times, offsets), [times, offsets]);
  const offsetsRef = useRef(offsets);
  const timelineRef = useRef(timeline);

  const [timeMs, setTimeMs] = useState(timeline.startMs);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<PlaybackSpeed>(DEFAULT_PLAYBACK_SPEED);
  const [trackShown, setTrackShown] = useState<TrackShown>(DEFAULT_TRACK_SHOWN);
  const trackShownRef = useRef(trackShown);
  /** За кем следит камера; null — все в кадре, камера свободная. */
  const [followed, setFollowed] = useState<number | null>(null);
  const followedRef = useRef(followed);
  const adjustRef = useRef<CameraAdjust>(initialAdjust('chase'));
  const headingRef = useRef<HeadingState | null>(null);

  useEffect(() => {
    const element = container.current;
    if (!element || !config) return undefined;
    let viewer: Viewer | null = null;
    let disposed = false;

    void (async () => {
      try {
        const terrain = await CesiumTerrainProvider.fromUrl(terrainSource(config).url, { requestVertexNormals: true });
        if (disposed) return;
        const first = sources.find((source) => source.id === imageryRef.current) ?? sources[0] ?? null;
        viewer = createSkylineViewer(element, terrain, first);
        viewerRef.current = viewer;
        const scene = viewer.scene;
        const controller = scene.screenSpaceCameraController;
        controller.zoomFactor = FREE_CAMERA.zoomFactor;
        controller.inertiaZoom = FREE_CAMERA.inertiaZoom;
        controller.inertiaSpin = FREE_CAMERA.inertiaSpin;
        controller.inertiaTranslate = FREE_CAMERA.inertiaTranslate;
        controller.minimumZoomDistance = FREE_CAMERA.minimumZoomDistanceM;

        // Калибровка по земле — у каждого трека своя, параллельно (рельеф спрашивается сетью).
        const shownTracks = await Promise.all(
          flights.map(({ track }) => calibratedForScene(terrain, track, flightRange(track.t, track.gSpeed))),
        );
        if (disposed || !viewer) return;
        const built: SceneFlight[] = flights.map((flight, i) => {
          const { track } = flight;
          const shown = shownTracks[i] ?? track;
          const range = flightRange(track.t, track.gSpeed);
          const smooth = smoothTrack(shown);
          const geometry = buildTrackGeometry(smooth);
          // Линия — цветом пилота целиком: вершинные цвета те же, один на всех.
          const [r, g, b, a] = rgbaOf(flight.color);
          for (let v = 0; v < geometry.colors.length; v += 4) {
            geometry.colors[v] = r;
            geometry.colors[v + 1] = g;
            geometry.colors[v + 2] = b;
            geometry.colors[v + 3] = a;
          }
          const positions = Cartesian3.fromDegreesArrayHeights(Array.from(geometry.positions));
          const { layer, vertexTimes } = sceneTrackLayer(scene, geometry, positions, smooth);
          const position = trackPosition(
            { ...shown, t: smooth.t, lat: smooth.lat, lon: smooth.lon, alt: smooth.alt, pointCount: smooth.t.length },
            true,
          );
          // Модель и подпись живут во времени сцены; трек — в своём: сдвиг режима времени.
          const scratch = new JulianDate();
          const local = (time: JulianDate): JulianDate =>
            JulianDate.addSeconds(time, -(offsetsRef.current[i] ?? 0) / MS_PER_SECOND, scratch);
          const shifted = new CallbackPositionProperty(
            (time, result) => (time ? position.getValue(local(time), result) : undefined),
            false,
          );
          const localMs = (sceneMs: number): number => sceneMs - (offsetsRef.current[i] ?? 0);
          const launchHeading = launchHeadingDeg(shown, track.t[range.takeoff] ?? Number.NaN);
          addGlider(
            viewer as Viewer,
            shifted,
            (sceneMs) => {
              const at = indexAt(track.t, localMs(sceneMs));
              const attitude = gliderAttitude(shown, localMs(sceneMs), at >= range.takeoff && at <= range.landing);
              return Number.isNaN(attitude.headingDeg) && at <= range.takeoff ? { ...attitude, headingDeg: launchHeading } : attitude;
            },
            (sceneMs) => gliderPose(track, range, localMs(sceneMs)),
          );
          viewer?.entities.add({
            position: shifted,
            label: {
              text: flight.label,
              font: LABEL_FONT,
              fillColor: Color.fromCssColorString(flight.color),
              outlineColor: Color.BLACK,
              outlineWidth: LABEL_OUTLINE_PX,
              style: LabelStyle.FILL_AND_OUTLINE,
              verticalOrigin: VerticalOrigin.BOTTOM,
              pixelOffset: new Cartesian2(0, LABEL_OFFSET_PX),
              // Имя видно и из-за склона: иначе пилот за хребтом терялся.
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
          });
          return { shown, track, range, layer, vertexTimes, position, positions };
        });
        sceneFlightsRef.current = built;

        setupSceneClock(viewer, timelineRef.current);

        let lastSecond = Number.NaN;
        let lastFrameMs: number | null = null;
        let halfWidthS: number | null = null;
        const onPreRender = (): void => {
          if (!viewer) return;
          const frameNowMs = performance.now();
          const elapsedS = frameSeconds(lastFrameMs, frameNowMs);
          lastFrameMs = frameNowMs;
          const current = JulianDate.toDate(viewer.clock.currentTime).getTime();
          const second = Math.floor(current / MS_PER_SECOND);
          if (second !== lastSecond) {
            lastSecond = second;
            setTimeMs(current);
          }
          let pending = false;
          built.forEach((item, i) => {
            const local = current - (offsetsRef.current[i] ?? 0);
            const startMs = item.track.t[0] ?? local;
            const trailEndMs = Math.max(startMs, local - TRAIL_GAP_S * MS_PER_SECOND);
            const trailEnd = item.position.getValue(toJulian(trailEndMs));
            item.layer.update(trackShownRef.current, flownByTime(item.vertexTimes, trailEndMs), trailEnd, trailEndMs);
            pending ||= item.layer.pending;
          });
          if (pending) scene.requestRender();

          // Слежение за пилотом — как Chase просмотрщика, по его треку и его времени.
          const index = followedRef.current;
          const item = index === null ? undefined : built[index];
          const pose = CAMERA_POSES.chase;
          if (!item || index === null || !pose) return;
          const local = current - (offsetsRef.current[index] ?? 0);
          halfWidthS = easeHalfWidth(halfWidthS, targetHalfWidthS(viewer.clock.multiplier), elapsedS);
          const aim = cameraTarget(item.shown, local, halfWidthS);
          if (![aim.lat, aim.lon, aim.alt].every(Number.isFinite)) return;
          const course = pose.headingDeg ?? travelCourse(item.track, local);
          const previous = headingRef.current;
          const target = Number.isNaN(course) && previous === null
            ? nearestHeading(item.track.heading, indexAt(item.track.t, local))
            : course;
          headingRef.current = springHeading(previous, target, elapsedS);
          const next = poseFor('chase', adjustRef.current, headingRef.current.headingDeg);
          if (![next.headingDeg, next.pitchDeg, next.rangeM].every(Number.isFinite)) return;
          lookAtAboveGround(viewer, Cartesian3.fromDegrees(aim.lon, aim.lat, aim.alt), aim.alt, next);
        };
        scene.preRender.addEventListener(onPreRender);

        const all = built.flatMap((item) => item.positions);
        if (all.length > 0) viewer.camera.flyToBoundingSphere(BoundingSphere.fromPoints(all), { duration: 0 });
        scene.requestRender();
      } catch (cause) {
        if (!disposed) setError(cause instanceof Error ? cause.message : String(cause));
      }
    })();

    return () => {
      disposed = true;
      viewerRef.current = null;
      sceneFlightsRef.current = [];
      viewer?.destroy();
    };
    // Подложка и режим времени в зависимостях не нужны: их меняют эффекты ниже без пересоздания сцены.
  }, [flights, config]);

  const seekTo = useCallback((next: number) => {
    const { startMs, endMs } = timelineRef.current;
    const clamped = Math.max(startMs, Math.min(endMs, next));
    const viewer = viewerRef.current;
    if (viewer) viewer.clock.currentTime = toJulian(clamped);
    headingRef.current = null;
    setTimeMs(clamped);
    viewer?.scene.requestRender();
  }, []);

  /** Режим времени: сдвиги треков и границы часов меняются без пересоздания сцены. */
  useEffect(() => {
    offsetsRef.current = offsets;
    timelineRef.current = timeline;
    const viewer = viewerRef.current;
    if (viewer) {
      viewer.clock.startTime = toJulian(timeline.startMs);
      viewer.clock.stopTime = toJulian(timeline.endMs);
    }
    seekTo(timeline.startMs);
  }, [offsets, timeline, seekTo]);

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
    trackShownRef.current = trackShown;
    viewerRef.current?.scene.requestRender();
  }, [trackShown]);

  /** Слежение: ввод Cesium выключен — камеру ставит кадр; «все в кадре» — облёт к общей сфере. */
  useEffect(() => {
    followedRef.current = followed;
    headingRef.current = null;
    adjustRef.current = initialAdjust('chase');
    const viewer = viewerRef.current;
    if (!viewer) return;
    viewer.scene.screenSpaceCameraController.enableInputs = followed === null;
    if (followed === null) {
      viewer.camera.lookAtTransform(Matrix4.IDENTITY);
      const all = sceneFlightsRef.current.flatMap((item) => item.positions);
      if (all.length > 0) viewer.camera.flyToBoundingSphere(BoundingSphere.fromPoints(all), { duration: OVERVIEW_FLIGHT_S });
    }
    viewer.scene.requestRender();
  }, [followed]);

  /** В слежении колесо — дистанция до пилота, перетаскивание — облёт вокруг него. */
  useEffect(() => {
    const element = container.current;
    if (!element) return undefined;
    let drag: { x: number; y: number } | null = null;
    const redraw = (): void => viewerRef.current?.scene.requestRender();
    const onWheel = (event: WheelEvent): void => {
      if (followedRef.current === null) return;
      event.preventDefault();
      adjustRef.current = zoomBy(adjustRef.current, 'chase', wheelZoomInPx(event));
      redraw();
    };
    const onPointerDown = (event: PointerEvent): void => {
      if (followedRef.current !== null) drag = { x: event.clientX, y: event.clientY };
    };
    const onPointerMove = (event: PointerEvent): void => {
      if (!drag || followedRef.current === null) return;
      adjustRef.current = orbitBy(adjustRef.current, 'chase', event.clientX - drag.x, event.clientY - drag.y);
      drag = { x: event.clientX, y: event.clientY };
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

  const togglePlay = useCallback(() => {
    if (timeMs >= timeline.endMs) seekTo(timeline.startMs);
    setPlaying((value) => !value);
  }, [seekTo, timeMs, timeline]);
  const hotkeys = useMemo(
    () => ({
      onTogglePlay: togglePlay,
      onSeek: (deltaSeconds: number) => seekTo(timeMs + deltaSeconds * MS_PER_SECOND),
      // Режимы камеры просмотрщика здесь не действуют: слежение — выбором пилота.
      onCameraMode: () => undefined,
    }),
    [seekTo, timeMs, togglePlay],
  );
  useHotkeys(hotkeys);

  const firstZone = flights[0]?.timezone ?? 'UTC';
  const anchorMs = (times[0]?.takeoffMs ?? Number.NaN) + (offsets[0] ?? 0);
  const clockLabel =
    alignment === 'absolute'
      ? new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: firstZone }).format(timeMs)
      : elapsedLabel(timeMs - (Number.isFinite(anchorMs) ? anchorMs : timeline.startMs));

  return (
    <div className="relative h-dvh w-full">
      <div ref={container} className="h-full w-full touch-none" data-testid="cesium-container" />

      <div className="pointer-events-none absolute left-4 right-4 top-4 flex flex-wrap items-start gap-2 compact:left-[max(0.5rem,env(safe-area-inset-left))] compact:right-[max(0.5rem,env(safe-area-inset-right))] compact:top-[max(0.5rem,env(safe-area-inset-top))]">
        <section
          data-panel="compare-list"
          aria-label={t('compare.title')}
          className="pointer-events-auto flex max-h-[60dvh] w-80 flex-col gap-2 overflow-y-auto rounded-xl glass p-3 text-sm compact:max-h-[35dvh] compact:w-full"
        >
          <div className="flex items-center justify-between gap-2">
            <h1 className="font-semibold">{t('compare.title')}</h1>
            <button
              type="button"
              aria-pressed={followed === null}
              onClick={() => setFollowed(null)}
              className="rounded px-2 py-0.5 text-xs text-secondary aria-pressed:bg-subtle aria-pressed:text-primary compact:min-h-11"
            >
              {t('compare.overview')}
            </button>
          </div>
          <ul className="flex flex-col gap-1">
            {flights.map((flight, i) => (
              <li key={flight.key} className="flex items-center gap-2">
                <button
                  type="button"
                  aria-pressed={followed === i}
                  aria-label={`${t('compare.follow')}: ${flight.label}`}
                  onClick={() => setFollowed(followed === i ? null : i)}
                  className="flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-1 text-left aria-pressed:bg-subtle compact:min-h-11"
                >
                  <span aria-hidden className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: flight.color }} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-primary">{flight.label}</span>
                    <span className="block truncate text-xs text-secondary">{flight.detail}</span>
                  </span>
                  <PilotReadout track={flight.track} localMs={timeMs - (offsets[i] ?? 0)} />
                </button>
                <button
                  type="button"
                  aria-label={`${t('compare.remove')}: ${flight.label}`}
                  onClick={() => onRemove(flight.key)}
                  className="rounded px-2 text-secondary hover:text-primary compact:min-h-11"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          {toolbar}
          {error !== null && (
            <p role="alert" className="text-danger">
              {error}
            </p>
          )}
        </section>

        <div data-panel="imagery" className="pointer-events-auto ml-auto flex flex-col gap-2 rounded-xl glass p-3 text-sm compact:hidden">
          <span className="text-secondary">{t('viewer.imagery')}</span>
          <ImageryButtons imagery={imagery} />
        </div>
      </div>

      <div className="absolute bottom-0 left-0 right-0">
        <SceneAttribution entries={imagery.attribution} />
        <CompareControls
          startMs={timeline.startMs}
          endMs={timeline.endMs}
          timeMs={timeMs}
          clockLabel={clockLabel}
          playing={playing}
          speed={speed}
          alignment={alignment}
          trackShown={trackShown}
          onTogglePlay={togglePlay}
          onSeekTo={seekTo}
          onSpeed={setSpeed}
          onAlignment={setAlignment}
          onTrackShown={setTrackShown}
        />
      </div>
    </div>
  );

}

/** Высота и варио пилота сейчас; до начала трека — «на старте», после — «сел». */
function PilotReadout({ track, localMs }: { track: DecodedTrack; localMs: number }) {
  const t = useT();
  const locale = useLocaleStore((state) => state.locale);
  const first = track.t[0] ?? Number.NaN;
  const last = track.t[track.pointCount - 1] ?? Number.NaN;
  if (localMs < first) return <span className="shrink-0 text-xs text-secondary">{t('compare.waiting')}</span>;
  if (localMs > last) return <span className="shrink-0 text-xs text-secondary">{t('compare.landed')}</span>;
  const i = indexAt(track.t, localMs);
  const alt = track.alt[i] ?? Number.NaN;
  const vario = track.vSpeed[i] ?? Number.NaN;
  return (
    <span className="numeric shrink-0 text-right text-xs">
      <span className="block">{Number.isFinite(alt) ? metres(alt, locale, t) : '—'}</span>
      <span className="block text-secondary">{Number.isFinite(vario) ? verticalSpeed(vario, locale, t) : '—'}</span>
    </span>
  );
}

export default CompareScene;
