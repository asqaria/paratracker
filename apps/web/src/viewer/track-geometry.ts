import type { FlightRange } from './ground-calibration';
import { varioRgba, type Rgba } from './vario-palette';

/**
 * Геометрия трека как обычные массивы — без Cesium, чтобы это было проверяемо
 * тестами и считалось один раз. ТЗ §7.3: трек рисуется ОДНИМ примитивом
 * с вершинными цветами, Entity на точку запрещены.
 */

export interface DecodedTrackColumns {
  lat: Float64Array;
  lon: Float64Array;
  alt: Float64Array;
  vSpeed: Float64Array;
}

export interface TrackGeometry {
  /** Долгота, широта, высота тройками — под Cartesian3.fromDegreesArrayHeights. */
  positions: Float64Array;
  /** RGBA 0…255 на вершину — под colors + colorsPerVertex. */
  colors: Uint8Array;
  /** Долгота и широта парами для тени на рельефе (ТЗ §7.2). */
  groundPositions: Float64Array;
  pointCount: number;
}

const COORDS_PER_POSITION = 3;
const COORDS_PER_GROUND = 2;
const CHANNELS_PER_COLOR = 4;

const usable = (lat: number, lon: number, alt: number): boolean =>
  Number.isFinite(lat) && Number.isFinite(lon) && Number.isFinite(alt);

/**
 * Ходьба по земле до взлёта и после посадки рисуется одним нейтральным цветом:
 * вариометр там — шум GPS на месте, раскраска выдавала его за полёт.
 */
export interface GroundStyle {
  flight: FlightRange;
  groundRgba: Rgba;
}

export function buildTrackGeometry(track: DecodedTrackColumns, ground?: GroundStyle): TrackGeometry {
  const count = track.lat.length;
  const positions = new Float64Array(count * COORDS_PER_POSITION);
  const groundPositions = new Float64Array(count * COORDS_PER_GROUND);
  const colors = new Uint8Array(count * CHANNELS_PER_COLOR);

  let kept = 0;
  for (let i = 0; i < count; i++) {
    const lat = track.lat[i] ?? Number.NaN;
    const lon = track.lon[i] ?? Number.NaN;
    const alt = track.alt[i] ?? Number.NaN;
    if (!usable(lat, lon, alt)) continue;

    positions[kept * COORDS_PER_POSITION] = lon;
    positions[kept * COORDS_PER_POSITION + 1] = lat;
    positions[kept * COORDS_PER_POSITION + 2] = alt;
    groundPositions[kept * COORDS_PER_GROUND] = lon;
    groundPositions[kept * COORDS_PER_GROUND + 1] = lat;

    const onGround = ground !== undefined && (i < ground.flight.takeoff || i > ground.flight.landing);
    const [r, g, b, a] = onGround ? ground.groundRgba : varioRgba(track.vSpeed[i] ?? Number.NaN);
    colors[kept * CHANNELS_PER_COLOR] = r;
    colors[kept * CHANNELS_PER_COLOR + 1] = g;
    colors[kept * CHANNELS_PER_COLOR + 2] = b;
    colors[kept * CHANNELS_PER_COLOR + 3] = a;
    kept += 1;
  }

  return {
    positions: positions.slice(0, kept * COORDS_PER_POSITION),
    colors: colors.slice(0, kept * CHANNELS_PER_COLOR),
    groundPositions: groundPositions.slice(0, kept * COORDS_PER_GROUND),
    pointCount: kept,
  };
}
