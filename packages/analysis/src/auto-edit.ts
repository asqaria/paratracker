import { CINEMA, TIME, type FlightRange, type Glide, type Thermal } from '@skyline/core';

/**
 * Автомонтаж «фильма» из трека (ТЗ §7.6, задача 4.1): полёт делится на сцены
 * по событиям — взлёт, первый и лучший термик, самый длинный глайд, рекорд
 * высоты, финальный заход, посадка, — каждой назначается камера и длительность
 * на экране. Чистая функция по времени (мс UTC): термики и глайды годятся и из
 * анализа воркера, и из API.
 */

export type CutKind = keyof typeof CINEMA.sceneS;

/** Камеры сцен (§7.6); как они летают — дело просмотрщика (задача 4.2). */
export type CutCamera = 'lowOrbit' | 'orbitClimb' | 'chase' | 'wideFlyby' | 'chaseToTop';

export interface CutScene {
  kind: CutKind;
  camera: CutCamera;
  /** Окно полёта, мс UTC. */
  fromMs: number;
  toMs: number;
  /** Секунд на экране. */
  durationS: number;
  /** Ускорение времени: секунд полёта на секунду экрана. */
  timeScale: number;
}

export interface AutoEditInput {
  /** Время точек, мс UTC. */
  t: ArrayLike<number>;
  alt: ArrayLike<number>;
  range: FlightRange;
  thermals: readonly Pick<Thermal, 'startTimeMs' | 'endTimeMs' | 'gainM'>[];
  glides: readonly Pick<Glide, 'startTimeMs' | 'endTimeMs' | 'distanceM' | 'kind'>[];
}

const CAMERA: Record<CutKind, CutCamera> = {
  takeoff: 'lowOrbit',
  firstThermal: 'orbitClimb',
  bestThermal: 'orbitClimb',
  longestGlide: 'chase',
  maxAltitude: 'wideFlyby',
  finalApproach: 'chase',
  landing: 'chaseToTop',
};

interface Candidate {
  kind: CutKind;
  fromMs: number;
  toMs: number;
  /**
   * Подрезается по уже взятым сценам (переход, заход, пролёт у вершины);
   * термик — нет: половина спирали — не термик, он уступает место целиком.
   */
  trimmable: boolean;
  /** Момент, ради которого сцена есть: уже в кадре другой сцены — сцена лишняя. */
  focusMs?: number;
}

const ms = (s: number) => s * TIME.msPerSecond;

/** Свободный от взятых сцен кусок окна, содержащий focus (или самый длинный). */
function freeWindow(c: Candidate, taken: readonly { fromMs: number; toMs: number }[]): { fromMs: number; toMs: number } | null {
  let pieces = [{ fromMs: c.fromMs, toMs: c.toMs }];
  for (const s of taken) {
    pieces = pieces.flatMap((p) => {
      if (s.toMs <= p.fromMs || s.fromMs >= p.toMs) return [p];
      return [
        { fromMs: p.fromMs, toMs: s.fromMs },
        { fromMs: s.toMs, toMs: p.toMs },
      ].filter((q) => q.toMs > q.fromMs);
    });
  }
  const long = pieces.filter((p) => p.toMs - p.fromMs >= ms(CINEMA.minWindowS));
  if (long.length === 0) return null;
  return long.reduce((a, b) => (b.toMs - b.fromMs > a.toMs - a.fromMs ? b : a));
}

export function autoEdit(input: AutoEditInput): CutScene[] {
  const { t, alt, range } = input;
  const startMs = t[range.takeoff] ?? Number.NaN;
  const endMs = t[range.landing] ?? Number.NaN;
  if (!(endMs - startMs >= ms(CINEMA.minWindowS))) return [];
  const inFlight = (from: number, to: number) => from >= startMs && to <= endMs;

  // Короткий полёт: взлёт и посадка делят его пополам, а не наезжают друг на друга.
  const half = (endMs - startMs) / 2;
  const takeoffTo = startMs + Math.min(ms(CINEMA.takeoffWindowS), half);
  const landingFrom = endMs - Math.min(ms(CINEMA.landingWindowS), half);

  const thermals = input.thermals.filter((th) => inFlight(th.startTimeMs, th.endTimeMs));
  // Лучший — по набору; при равенстве — более ранний: результат не зависит от сортировки.
  const best = thermals.reduce<(typeof thermals)[number] | null>((a, b) => (a === null || b.gainM > a.gainM ? b : a), null);
  const first = thermals.reduce<(typeof thermals)[number] | null>(
    (a, b) => (a === null || b.startTimeMs < a.startTimeMs ? b : a),
    null,
  );
  const longest = input.glides
    .filter((g) => g.kind === 'glide' && inFlight(g.startTimeMs, g.endTimeMs))
    .reduce<AutoEditInput['glides'][number] | null>((a, b) => (a === null || b.distanceM > a.distanceM ? b : a), null);

  let peak = range.takeoff;
  for (let i = range.takeoff; i <= range.landing; i++) {
    if ((alt[i] ?? -Infinity) > (alt[peak] ?? -Infinity)) peak = i;
  }
  const peakMs = t[peak] ?? startMs;
  const halfPeak = ms(CINEMA.maxAltitudeWindowS) / 2;

  // Порядок — важность: взлёт и посадка всегда, дальше то, ради чего фильм смотрят.
  const candidates: Candidate[] = [
    { kind: 'takeoff', fromMs: startMs, toMs: takeoffTo, trimmable: false },
    { kind: 'landing', fromMs: landingFrom, toMs: endMs, trimmable: false },
    ...(best ? [{ kind: 'bestThermal' as const, fromMs: best.startTimeMs, toMs: best.endTimeMs, trimmable: false }] : []),
    ...(longest ? [{ kind: 'longestGlide' as const, fromMs: longest.startTimeMs, toMs: longest.endTimeMs, trimmable: true }] : []),
    ...(first && first !== best
      ? [{ kind: 'firstThermal' as const, fromMs: first.startTimeMs, toMs: first.endTimeMs, trimmable: false }]
      : []),
    {
      kind: 'maxAltitude',
      fromMs: Math.max(startMs, peakMs - halfPeak),
      toMs: Math.min(endMs, peakMs + halfPeak),
      trimmable: true,
      focusMs: peakMs,
    },
    {
      kind: 'finalApproach',
      fromMs: Math.max(startMs, landingFrom - ms(CINEMA.finalApproachWindowS)),
      toMs: landingFrom,
      trimmable: true,
    },
  ];

  const taken: { kind: CutKind; fromMs: number; toMs: number }[] = [];
  for (const c of candidates) {
    if (c.toMs - c.fromMs < ms(CINEMA.minWindowS)) continue;
    const focus = c.focusMs;
    if (focus !== undefined && taken.some((s) => focus >= s.fromMs && focus <= s.toMs)) continue;
    const overlaps = taken.some((s) => s.fromMs < c.toMs && c.fromMs < s.toMs);
    if (!overlaps) {
      taken.push({ kind: c.kind, fromMs: c.fromMs, toMs: c.toMs });
      continue;
    }
    if (!c.trimmable) continue;
    const free = freeWindow(c, taken);
    if (free) taken.push({ kind: c.kind, ...free });
  }

  return taken
    .sort((a, b) => a.fromMs - b.fromMs)
    .map((s) => {
      const durationS = CINEMA.sceneS[s.kind];
      return {
        kind: s.kind,
        camera: CAMERA[s.kind],
        fromMs: s.fromMs,
        toMs: s.toMs,
        durationS,
        timeScale: (s.toMs - s.fromMs) / TIME.msPerSecond / durationS,
      };
    });
}
