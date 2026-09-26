import { GEO, RACE, type FlightRange } from '@skyline/core';

/**
 * Гонка в сравнении треков (задача 3.12б): насколько каждый пилот отстаёт
 * от лидера — как в повторах соревнований. Задания (маршрута с цилиндрами)
 * нет, поэтому «маршрут» — сам трек:
 *
 * 1. Кто впереди — по треку опорного пилота: у каждого ищется точка опорного
 *    трека, ближайшая к нему сейчас; чей момент на опорном треке позже, тот
 *    дальше продвинулся. Лидер — самый дальний.
 * 2. Отставание — по треку лидера: «сейчас» минус момент, когда лидер
 *    пролетал то место, где пилот сейчас. Будущее лидера не в счёт.
 *
 * В термике пилот рядом сразу с несколькими витками чужой спирали: среди
 * отрезков не дальше ближайшего плюс RACE.matchToleranceM выбирается тот,
 * чей момент ближе к ожидаемому — столько же от взлёта, сколько у пилота.
 * Детерминировано: один вход — один выход, без памяти прошлых кадров.
 */

export interface RaceTrack {
  /** Время точек, UNIX мс, по возрастанию. */
  t: Float64Array;
  lat: Float64Array;
  lon: Float64Array;
  /** Взлёт и посадка (flightRange): маршрут — только полёт, без ходьбы по земле. */
  range: FlightRange;
}

export interface RaceMatch {
  /** Момент на треке, когда он проходил ближайшую точку, UNIX мс (время трека). */
  timeMs: number;
  /** Расстояние от точки до трека, м. */
  distanceM: number;
}

export interface RacePilot {
  track: RaceTrack;
  /** Время сцены = время трека + offsetMs (режим времени сравнения). */
  offsetMs: number;
  /** Время трека сейчас, UNIX мс. */
  localMs: number;
  /** Где пилот сейчас. */
  lat: number;
  lon: number;
}

const RADIANS_PER_DEGREE = Math.PI / 180;
const METRES_PER_DEGREE = GEO.meanEarthRadiusM * RADIANS_PER_DEGREE;

/**
 * Ближайшая к (lat, lon) точка полёта track не позже untilMs. Проекция —
 * равнопромежуточная у широты точки: на масштабе коридора RACE.maxOffCourseM
 * искажение — доли процента. null — трек дальше RACE.maxOffCourseM или
 * до untilMs полёта ещё не было.
 */
export function matchOnTrack(
  track: RaceTrack,
  lat: number,
  lon: number,
  expectedMs: number,
  untilMs: number,
): RaceMatch | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const cosLat = Math.cos(lat * RADIANS_PER_DEGREE);
  const x = (i: number): number => ((track.lon[i] ?? Number.NaN) - lon) * cosLat * METRES_PER_DEGREE;
  const y = (i: number): number => ((track.lat[i] ?? Number.NaN) - lat) * METRES_PER_DEGREE;

  // Отрезки полёта: расстояние от точки и момент в проекции на отрезок.
  const { takeoff, landing } = track.range;
  const size = Math.max(0, landing - takeoff);
  const distances = new Float64Array(size);
  const times = new Float64Array(size);
  let count = 0;
  let nearest = Number.POSITIVE_INFINITY;
  for (let i = takeoff; i < landing; i++) {
    const t0 = track.t[i] ?? Number.NaN;
    const t1 = track.t[i + 1] ?? Number.NaN;
    if (!(t0 <= untilMs)) break;
    const ax = x(i);
    const ay = y(i);
    const dx = x(i + 1) - ax;
    const dy = y(i + 1) - ay;
    if (![ax, ay, dx, dy, t0, t1].every(Number.isFinite)) continue;
    const lengthSq = dx * dx + dy * dy;
    let u = lengthSq > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSq)) : 0;
    // Отрезок, который лидер ещё не долетел, — только до «сейчас».
    if (t1 > untilMs) u = Math.min(u, (untilMs - t0) / (t1 - t0));
    const distance = Math.hypot(ax + u * dx, ay + u * dy);
    distances[count] = distance;
    times[count] = t0 + u * (t1 - t0);
    count += 1;
    if (distance < nearest) nearest = distance;
  }
  if (count === 0 || nearest > RACE.maxOffCourseM) return null;
  let best = -1;
  for (let k = 0; k < count; k++) {
    if ((distances[k] ?? Number.POSITIVE_INFINITY) > nearest + RACE.matchToleranceM) continue;
    const miss = Math.abs((times[k] ?? 0) - expectedMs);
    if (best < 0 || miss < Math.abs((times[best] ?? 0) - expectedMs)) best = k;
  }
  return { timeMs: times[best] ?? Number.NaN, distanceM: distances[best] ?? Number.NaN };
}

const takeoffMs = (track: RaceTrack): number => track.t[track.range.takeoff] ?? Number.NaN;

/** Сколько пилот пролетел от взлёта — в пересчёте на время другого трека: «ожидаемый» момент там. */
const expectedOn = (track: RaceTrack, pilot: RacePilot): number =>
  takeoffMs(track) + (pilot.localMs - takeoffMs(pilot.track));

/**
 * Отставание каждого пилота от лидера, мс; у лидера — 0. null — пилот ещё
 * не взлетел или не на маршруте. referenceIndex — чей трек задаёт «кто
 * впереди» (первый в сравнении или тот, за кем следит камера).
 */
export function raceGaps(pilots: readonly RacePilot[], referenceIndex: number, sceneMs: number): (number | null)[] {
  const reference = pilots[referenceIndex];
  const flying = pilots.map((pilot) => pilot.localMs >= takeoffMs(pilot.track));
  if (!reference) return pilots.map(() => null);

  // 1. Кто дальше — по опорному треку, целиком: опорный может и отставать.
  const progress = pilots.map((pilot, i) =>
    flying[i]
      ? (matchOnTrack(reference.track, pilot.lat, pilot.lon, expectedOn(reference.track, pilot), Number.POSITIVE_INFINITY)
          ?.timeMs ?? null)
      : null,
  );
  let leaderIndex = -1;
  progress.forEach((value, i) => {
    if (value === null) return;
    const best = leaderIndex < 0 ? null : progress[leaderIndex];
    if (best === null || best === undefined || value > best) leaderIndex = i;
  });
  const leader = pilots[leaderIndex];
  if (!leader) return pilots.map(() => null);

  // 2. Отставание — по треку лидера и только по уже пролетевшему им.
  return pilots.map((pilot, i) => {
    if (i === leaderIndex) return 0;
    if (!flying[i]) return null;
    const match = matchOnTrack(leader.track, pilot.lat, pilot.lon, expectedOn(leader.track, pilot), leader.localMs);
    return match === null ? null : Math.max(0, sceneMs - (match.timeMs + leader.offsetMs));
  });
}
