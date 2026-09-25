/**
 * Калибровка трека по земле — только для отображения (ТЗ §3.3: «сдвиг =
 * рельеф(старт) − высота(старт)», по умолчанию — калиброванная высота).
 *
 * Высота в данных честная: GNSS над эллипсоидом или баро по ISA. Но GNSS шумит
 * по вертикали на ±5–15 м, баро уходит с давлением, у рельефа своя погрешность —
 * и трек у старта и посадки висит над склоном или уходит в него. Сцена сдвигает
 * линию так, чтобы точки на земле легли на тот рельеф, который она же рисует.
 * Поправка своя на старте и на посадке, между ними — линейно по времени:
 * так снимается и дрейф давления за часы полёта. Телеметрия и сводка остаются
 * на настоящих данных.
 */

export const GROUND_CALIBRATION = {
  /** Точки на земле ищутся в первые и последние 60 с записи: дальше пилот уже в воздухе. */
  windowS: 60,
  /**
   * …и не дальше 30 м от первой/последней точки. Пилоты взлетают через 20–30 с
   * после начала записи: без радиуса окно по времени захватывало полёт (замер
   * на реальных треках, спек высот).
   */
  groundRadiusM: 30,
  /** Меньше 5 точек на земле — запись началась (кончилась) в воздухе, калибровать не по чему. */
  minGroundFixes: 5,
  /**
   * Поправка больше 400 м — ошибка данных, а не калибровка: баровысота по ISA
   * отличается от настоящей примерно на 8 м на гектопаскаль, при крайних
   * QNH ±40 гПа это около ±330 м; у GNSS остаток после геоида — метры.
   */
  maxOffsetM: 400,
  /**
   * Опора — 90-й перцентиль разностей «рельеф − трек», а не медиана. В «землю»
   * у посадки попадают секунды подлёта: они над рельефом, дают малую разность
   * и тянули медиану вниз — половина точек на земле уходила под рельеф
   * (замер: посадка +0.4 м по медиане против +5.2 м по точкам, где пилот стоит).
   * Верхние 10 % отсекают одиночные выбросы GPS вниз.
   */
  groundQuantile: 0.9,
  /** Пилот на земле стоит, подвесная система — примерно в метре над склоном. */
  harnessHeightM: 1,
  /**
   * Земля — это ходьба: медианная путевая скорость точек не выше 3 м/с. Без
   * этого запись, начатая в воздухе в термике, держалась бы в радиусе 30 м от
   * первой точки и сошла бы за стоянку; параплан в воздухе заметно быстрее.
   */
  maxGroundSpeedMs: 3,
  /**
   * Первые и последние 15 с полёта трек плавно уходит от земли и возвращается
   * к ней: GPS-высота у земли отстаёт, и резкий стык давал ступеньку в 15–19 м.
   * 15 с — разбег и первые секунды над склоном, пока крыло набирает скорость.
   */
  transitionS: 15,
} as const;

const MS_PER_SECOND = 1000;
const METRES_PER_DEGREE_LAT = 111_320;
const RADIANS_PER_DEGREE = Math.PI / 180;

/** Поправка на одном конце полёта: когда и на сколько сдвинуть. */
export interface GroundAnchor {
  tMs: number;
  offsetM: number;
}

/** Индексы точек на земле у старта ('start') или посадки ('end'). */
export function groundIndices(
  t: Float64Array,
  lat: Float64Array,
  lon: Float64Array,
  end: 'start' | 'end',
): number[] {
  const n = t.length;
  if (n === 0) return [];
  const anchor = end === 'start' ? 0 : n - 1;
  const anchorT = t[anchor] ?? Number.NaN;
  const anchorLat = lat[anchor] ?? Number.NaN;
  const anchorLon = lon[anchor] ?? Number.NaN;
  const metresPerDegreeLon = METRES_PER_DEGREE_LAT * Math.cos(anchorLat * RADIANS_PER_DEGREE);
  const windowMs = GROUND_CALIBRATION.windowS * MS_PER_SECOND;

  const indices: number[] = [];
  for (let i = 0; i < n; i++) {
    if (Math.abs((t[i] ?? Number.NaN) - anchorT) > windowMs) continue;
    const dNorth = ((lat[i] ?? Number.NaN) - anchorLat) * METRES_PER_DEGREE_LAT;
    const dEast = ((lon[i] ?? Number.NaN) - anchorLon) * metresPerDegreeLon;
    if (Math.hypot(dNorth, dEast) <= GROUND_CALIBRATION.groundRadiusM) indices.push(i);
  }
  return indices;
}

/**
 * Точки на земле у старта или посадки — или пусто, если их мало или они
 * движутся быстрее ходьбы (запись началась или кончилась в воздухе).
 */
export function groundSegment(
  t: Float64Array,
  lat: Float64Array,
  lon: Float64Array,
  gSpeed: Float64Array,
  end: 'start' | 'end',
): number[] {
  const indices = groundIndices(t, lat, lon, end);
  if (indices.length < GROUND_CALIBRATION.minGroundFixes) return [];
  const speeds = indices.map((i) => gSpeed[i] ?? Number.NaN).filter(Number.isFinite).sort((a, b) => a - b);
  const median = speeds[speeds.length >> 1] ?? Number.NaN;
  return median <= GROUND_CALIBRATION.maxGroundSpeedMs ? indices : [];
}

/** Полёт — от взлёта до посадки, индексы точек трека; вне него — ходьба по земле. */
export interface FlightRange {
  takeoff: number;
  landing: number;
}

export function flightRange(t: Float64Array, lat: Float64Array, lon: Float64Array, gSpeed: Float64Array): FlightRange {
  const start = groundSegment(t, lat, lon, gSpeed, 'start');
  const end = groundSegment(t, lat, lon, gSpeed, 'end');
  return { takeoff: start.at(-1) ?? 0, landing: end[0] ?? t.length - 1 };
}

/**
 * Поправка «рельеф − трек» по точкам на земле: верхний перцентиль плюс
 * высота подвески (см. GROUND_CALIBRATION). null — точек мало или поправка
 * неправдоподобно велика.
 */
export function groundOffset(alt: readonly number[], ground: readonly number[]): number | null {
  const diffs: number[] = [];
  for (let i = 0; i < Math.min(alt.length, ground.length); i++) {
    const diff = (ground[i] ?? Number.NaN) - (alt[i] ?? Number.NaN);
    if (Number.isFinite(diff)) diffs.push(diff);
  }
  if (diffs.length < GROUND_CALIBRATION.minGroundFixes) return null;

  diffs.sort((a, b) => a - b);
  const rank = Math.floor(GROUND_CALIBRATION.groundQuantile * (diffs.length - 1));
  const offset = (diffs[rank] ?? Number.NaN) + GROUND_CALIBRATION.harnessHeightM;
  return Math.abs(offset) <= GROUND_CALIBRATION.maxOffsetM ? offset : null;
}

/**
 * Привязка поправки по времени: на старте — момент взлёта (последняя точка
 * на земле), на посадке — приземление (первая). Между ними поправка линейна.
 */
export function groundAnchor(
  t: Float64Array,
  indices: readonly number[],
  offsetM: number | null,
  end: 'start' | 'end',
): GroundAnchor | null {
  const index = end === 'start' ? indices.at(-1) : indices[0];
  if (offsetM === null || index === undefined) return null;
  return { tMs: t[index] ?? Number.NaN, offsetM };
}

/** Поправка в момент tMs: линейно между концами, за концами — ближайший, без концов — 0. */
export function offsetAt(tMs: number, start: GroundAnchor | null, end: GroundAnchor | null): number {
  if (start && end) {
    if (tMs <= start.tMs) return start.offsetM;
    if (tMs >= end.tMs) return end.offsetM;
    const k = (tMs - start.tMs) / (end.tMs - start.tMs);
    return start.offsetM + (end.offsetM - start.offsetM) * k;
  }
  return start?.offsetM ?? end?.offsetM ?? 0;
}

/** Высоты для сцены: новый массив, исходный не трогается. */
export function calibrateAltitudes(
  t: Float64Array,
  alt: Float64Array,
  start: GroundAnchor | null,
  end: GroundAnchor | null,
): Float64Array {
  return alt.map((value, i) => value + offsetAt(t[i] ?? Number.NaN, start, end));
}

/**
 * Ходьба до взлёта и после посадки — ровно по рельефу (+ подвеска) в каждой
 * точке, а первые и последние transitionS секунд полёта плавно переходят от
 * земли к высоте полёта. Сдвиг одной поправкой не годится для ходьбы: шум GPS
 * на месте ±5 м поднимал шаги в воздух. А резкий стык давал ступеньку: GPS-
 * высота у земли отстаёт, и на реальном треке разрыв был +14.5 м на взлёте и
 * −19 м на посадке за одну секунду. terrain — высота рельефа по индексам
 * точек, NaN — не пришла; такие точки остаются по данным полёта.
 */
export function settleOnGround(
  t: Float64Array,
  alt: Float64Array,
  terrain: Float64Array,
  range: FlightRange,
): Float64Array {
  const transitionMs = GROUND_CALIBRATION.transitionS * MS_PER_SECOND;
  const takeoffMs = t[range.takeoff] ?? Number.NaN;
  const landingMs = t[range.landing] ?? Number.NaN;

  return alt.map((value, i) => {
    const ground = (terrain[i] ?? Number.NaN) + GROUND_CALIBRATION.harnessHeightM;
    if (!Number.isFinite(ground)) return value;
    if (i <= range.takeoff || i >= range.landing) return ground;

    const tMs = t[i] ?? Number.NaN;
    // Доля «полёта»: 0 — у земли, 1 — через transitionS после взлёта и до посадки.
    const k = Math.min(1, (tMs - takeoffMs) / transitionMs, (landingMs - tMs) / transitionMs);
    if (!(k < 1)) return value;
    const smooth = k * k * (3 - 2 * k); // smoothstep: без излома на обоих концах
    return ground + (value - ground) * smooth;
  });
}
