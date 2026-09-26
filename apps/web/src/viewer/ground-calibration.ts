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

import type { FlightRange } from '@skyline/core';

/** Взлёт и посадка — в analysis (FLIGHT в core): по ним же режутся глайды, ТЗ §6.4. */
export { flightRange } from '@skyline/analysis';
export type { FlightRange } from '@skyline/core';

export const GROUND_CALIBRATION = {
  /** Поправки считаются по минуте перед взлётом и минуте после посадки: пилот стоит на старте. */
  groundWindowS: 60,
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
   * Первые и последние 15 с полёта трек плавно уходит от земли и возвращается
   * к ней: GPS-высота у земли отстаёт, и резкий стык давал ступеньку в 15–19 м.
   * 15 с — разбег и первые секунды над склоном, пока крыло набирает скорость.
   */
  transitionS: 15,
  /**
   * Длинная ходьба (подъём пешком — часы, тысячи точек) ложится на рельеф по
   * точкам не чаще раза в 10 с, между ними — линейно: склон за 10 с шага не
   * меняется, а запрос рельефа на каждую точку не укладывался бы во время.
   */
  terrainSampleStepS: 10,
} as const;

const MS_PER_SECOND = 1000;

/** Поправка на одном конце полёта: когда и на сколько сдвинуть. */
export interface GroundAnchor {
  tMs: number;
  offsetM: number;
}

/** Точки, где пилот стоит: минута перед взлётом ('start') или после посадки ('end'). */
export function groundWindow(t: Float64Array, range: FlightRange, side: 'start' | 'end'): number[] {
  const windowMs = GROUND_CALIBRATION.groundWindowS * MS_PER_SECOND;
  const indices: number[] = [];
  if (side === 'start') {
    const edge = t[range.takeoff] ?? Number.NaN;
    for (let i = 0; i <= range.takeoff; i++) if (edge - (t[i] ?? Number.NaN) <= windowMs) indices.push(i);
  } else {
    const edge = t[range.landing] ?? Number.NaN;
    for (let i = range.landing; i < t.length; i++) if ((t[i] ?? Number.NaN) - edge <= windowMs) indices.push(i);
  }
  return indices;
}

/**
 * Где сцене спрашивать высоту рельефа. exact — каждая точка: окна поправок и
 * плавного перехода у взлёта и посадки. sparse — остальная ходьба вне полёта,
 * не чаще раза в terrainSampleStepS; промежутки заполняет fillTerrain.
 */
export function terrainSampleIndices(t: Float64Array, range: FlightRange): { exact: number[]; sparse: number[] } {
  const transitionMs = GROUND_CALIBRATION.transitionS * MS_PER_SECOND;
  const takeoffMs = t[range.takeoff] ?? Number.NaN;
  const landingMs = t[range.landing] ?? Number.NaN;
  const exactSet = new Set<number>([...groundWindow(t, range, 'start'), ...groundWindow(t, range, 'end')]);
  for (let i = range.takeoff; i <= range.landing; i++) {
    const tMs = t[i] ?? Number.NaN;
    if (tMs - takeoffMs <= transitionMs || landingMs - tMs <= transitionMs) exactSet.add(i);
  }

  const stepMs = GROUND_CALIBRATION.terrainSampleStepS * MS_PER_SECOND;
  const sparse: number[] = [];
  let lastMs = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < t.length; i++) {
    if ((i >= range.takeoff && i <= range.landing) || exactSet.has(i)) continue;
    const tMs = t[i] ?? Number.NaN;
    if (tMs - lastMs >= stepMs) {
      sparse.push(i);
      lastMs = tMs;
    }
  }
  return { exact: [...exactSet].sort((a, b) => a - b), sparse };
}

/**
 * Рельеф между редкими точками ходьбы: линейно по времени между соседними
 * известными; с одной стороны — ближайшая. Только вне полёта (до взлёта
 * и после посадки) — через полёт не тянется.
 */
export function fillTerrain(t: Float64Array, terrain: Float64Array, range: FlightRange): Float64Array {
  const filled = Float64Array.from(terrain);
  const fillZone = (from: number, to: number): void => {
    const known: number[] = [];
    for (let i = from; i <= to; i++) if (Number.isFinite(terrain[i] ?? Number.NaN)) known.push(i);
    if (known.length === 0) return;
    let next = 0; // первая известная точка правее i
    for (let i = from; i <= to; i++) {
      while (next < known.length && (known[next] ?? Infinity) <= i) next++;
      if (Number.isFinite(filled[i] ?? Number.NaN)) continue;
      const left = known[next - 1];
      const right = known[next];
      if (left !== undefined && right !== undefined) {
        const w = ((t[i] ?? 0) - (t[left] ?? 0)) / ((t[right] ?? 0) - (t[left] ?? 0));
        filled[i] = (terrain[left] ?? 0) + ((terrain[right] ?? 0) - (terrain[left] ?? 0)) * w;
      } else {
        filled[i] = terrain[left ?? right ?? i] ?? Number.NaN;
      }
    }
  };
  fillZone(0, range.takeoff);
  fillZone(range.landing, t.length - 1);
  return filled;
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
