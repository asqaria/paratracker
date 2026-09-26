import {
  Cartesian3,
  Cartographic,
  Color,
  GeographicTilingScheme,
  HeadingPitchRange,
  ImageryLayer,
  Math as CesiumMath,
  NeverTileDiscardPolicy,
  sampleTerrainMostDetailed,
  type Scene,
  type TerrainProvider,
  type TileProviderError,
  UrlTemplateImageryProvider,
  Viewer,
  WebMapTileServiceImageryProvider,
} from 'cesium';

import type { HeadingPitchRangeDeg } from './camera-input';
import type { DecodedTrack } from './decode-track';
import {
  calibrateAltitudes,
  fillTerrain,
  groundAnchor,
  groundOffset,
  groundWindow,
  settleOnGround,
  terrainSampleIndices,
  type FlightRange,
} from './ground-calibration';
import { pitchClearingGround } from './ground-clearance';
import type { ImagerySource } from './providers';
import type { TrackGeometry } from './track-geometry';
import { TrackLayer } from './track-layer';
import { COMPACT_MEDIA_QUERY, trackWidths } from './track-progress';
import type { SmoothTrack } from './track-smooth';

/**
 * Общее для сцен Cesium: просмотрщика полёта (scene.tsx) и сравнения
 * (compare-scene.tsx, задача 3.12) — создание Viewer, подложка, калибровка
 * трека по земле, слой линии, камера над склоном.
 */

/**
 * Предел плотности пикселей рендера. По умолчанию Cesium рисует в CSS-пикселях
 * (useBrowserRecommendedResolution) — на экранах с масштабом 125–200 % сцена
 * растягивалась, и края линии, тени и занавеса шли грубой лесенкой. Рендер —
 * в пикселях экрана, но не плотнее 2: выше разница глазу почти не видна, а
 * число пикселей и нагрузка на видеокарту растут квадратично (ТЗ §7.7).
 */
const MAX_PIXEL_RATIO = 2;

/** Проходов подъёма камеры над склоном: после первого она над другой точкой склона. */
const CAMERA_CLEARANCE_PASSES = 2;

/** Прозрачность тени трека на земле. */
const SHADOW_ALPHA = 0.42;

/** Ответ /api/v1/imagery меняется только с перезапуском API — минуты хватит. */
export const IMAGERY_CAPABILITIES_STALE_MS = 60_000;

/** Viewer без штатных виджетов: время, подложку и атрибуцию ведёт наш интерфейс. */
export function createSkylineViewer(element: HTMLElement, terrain: TerrainProvider, first: ImagerySource | null): Viewer {
  const viewer = new Viewer(element, {
    terrainProvider: terrain,
    ...(first ? { baseLayer: createImageryProvider(first) } : {}),
    // ТЗ §7.7: рендер только при изменениях; на время проигрывания включается непрерывный.
    requestRenderMode: true,
    maximumRenderTimeChange: Number.POSITIVE_INFINITY,
    useBrowserRecommendedResolution: false,
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
  // Толщина линий в пикселях Cesium умножает на ту же плотность — на экране она не меняется.
  viewer.resolutionScale = Math.min(1, MAX_PIXEL_RATIO / window.devicePixelRatio);
  const scene = viewer.scene;
  scene.globe.depthTestAgainstTerrain = true;
  scene.globe.enableLighting = true;
  scene.debugShowFramesPerSecond = import.meta.env.DEV;
  // Штатный блок кредитов Cesium скрыт: все обязательные строки лицензий
  // (Re:Earth, EOX, Esri) выводит наш блок атрибуции, иначе они наложатся.
  const credits = viewer.cesiumWidget.creditContainer;
  if (credits instanceof HTMLElement) credits.style.display = 'none';
  return viewer;
}

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
export async function calibratedForScene(
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

/**
 * Камера смотрит на цель с позы; если под камерой склон выше неё — наклон
 * круче, камера поднимается над склоном по дуге на той же дальности. Рельеф —
 * тот, что сцена рисует сейчас; два прохода: после подъёма камера над другой
 * точкой склона.
 */
export function lookAtAboveGround(viewer: Viewer, target: Cartesian3, targetM: number, pose: HeadingPitchRangeDeg): void {
  let pitchDeg = pose.pitchDeg;
  for (let pass = 0; pass < CAMERA_CLEARANCE_PASSES; pass++) {
    viewer.camera.lookAt(
      target,
      new HeadingPitchRange(CesiumMath.toRadians(pose.headingDeg), CesiumMath.toRadians(pitchDeg), pose.rangeM),
    );
    const place = Cartographic.fromCartesian(viewer.camera.positionWC);
    const next = place ? pitchClearingGround({ pitchDeg, rangeM: pose.rangeM }, targetM, viewer.scene.globe.getHeight(place)) : pitchDeg;
    if (next === pitchDeg) return;
    pitchDeg = next;
  }
  viewer.camera.lookAt(
    target,
    new HeadingPitchRange(CesiumMath.toRadians(pose.headingDeg), CesiumMath.toRadians(pitchDeg), pose.rangeM),
  );
}

/**
 * HTTP-статус упавшего тайла. Cesium кладёт в `error` RequestErrorEvent со
 * `statusCode`; у сетевого сбоя статуса нет — undefined.
 */
export function httpStatusOf(error: TileProviderError): number | undefined {
  const cause: unknown = error.error;
  if (typeof cause !== 'object' || cause === null || !('statusCode' in cause)) return undefined;
  return typeof cause.statusCode === 'number' ? cause.statusCode : undefined;
}

export function createImageryProvider(source: ImagerySource): ImageryLayer {
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

/**
 * Слой линии трека (track-layer.ts) и время каждой её вершины. Вершины без
 * координат buildTrackGeometry пропускает — время берётся только у годных.
 * Толщина — по экрану: на телефоне 4 px — полоса поперёк долины.
 */
export function sceneTrackLayer(
  scene: Scene,
  geometry: TrackGeometry,
  positions: Cartesian3[],
  smooth: SmoothTrack,
): { layer: TrackLayer; vertexTimes: Float64Array } {
  const widths = trackWidths(window.matchMedia(COMPACT_MEDIA_QUERY).matches);
  const vertexTimes = new Float64Array(geometry.pointCount);
  let v = 0;
  for (let j = 0; j < smooth.t.length && v < geometry.pointCount; j++) {
    const usable = [smooth.lat[j], smooth.lon[j], smooth.alt[j]].every((x) => Number.isFinite(x ?? Number.NaN));
    if (!usable) continue;
    vertexTimes[v] = smooth.t[j] ?? Number.NaN;
    v += 1;
  }
  const layer = new TrackLayer(scene, geometry, positions, vertexTimes, {
    linePx: widths.linePx,
    shadowPx: widths.shadowPx,
    shadowColor: new Color(0, 0, 0, SHADOW_ALPHA),
  });
  return { layer, vertexTimes };
}
