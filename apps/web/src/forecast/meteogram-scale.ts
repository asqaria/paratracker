import type { ProfilePoint } from '@skyline/core';

/**
 * Диаграмма «время × высота» (задача П.6, как «Instability card» AeroXC):
 * цвет клетки — неустойчивость воздуха на этой высоте в этот час, то есть
 * как быстро он остывает с подъёмом. Чистая геометрия и классы — рисует
 * Meteogram.tsx.
 */

/**
 * Классы неустойчивости по темпу остывания, °C на 100 м. Сухая адиабата —
 * 0,98: воздух остывает так же быстро, как поднимающийся пузырь, — термики
 * сильные. Стандартная атмосфера — 0,65: термики слабые. Меньше 0,3 и
 * инверсии (воздух наверху теплее) — термики гаснут.
 */
export const INSTABILITY_CLASSES = [
  { id: 'inversion', minLapse: -Infinity },
  { id: 'stable', minLapse: 0.3 },
  { id: 'weak', minLapse: 0.5 },
  { id: 'moderate', minLapse: 0.65 },
  { id: 'good', minLapse: 0.8 },
  { id: 'strong', minLapse: 0.95 },
] as const;
export type InstabilityClass = (typeof INSTABILITY_CLASSES)[number]['id'];

export const METEOGRAM = {
  /**
   * Верх диаграммы — потолок плюс 600 м (владелец: «зачем 5000, если база
   * 2700?»): над потолком пилоту нужен только ветер у «крышки». Не ниже
   * старта + 1,5 км — в слабый день диаграмма не сплющивается; не выше 6 км.
   */
  aboveCeilingM: 600,
  minSpanM: 1500,
  maxTopM: 6000,
  /** Шаг сетки по высоте, м: клетки 100 м — плавно, но без лишней работы. */
  cellM: 100,
  /** Подписи высот через 500 м. */
  labelStepM: 500,
} as const;

const PER_100_M = 100;

/**
 * Темп остывания на высоте, °C/100 м. Профиль — точки по возрастанию высоты;
 * у каждого слоя между соседними точками свой темп, между серединами слоёв —
 * линейно, чтобы цвет не шёл ступеньками по уровням давления. Вне профиля — null.
 */
export function lapseRateAt(points: readonly ProfilePoint[], heightM: number): number | null {
  const layers: { mid: number; lapse: number }[] = [];
  for (let k = 1; k < points.length; k++) {
    const a = points[k - 1];
    const b = points[k];
    if (!a || !b || !(b.heightM > a.heightM)) continue;
    layers.push({ mid: (a.heightM + b.heightM) / 2, lapse: ((a.temperatureC - b.temperatureC) / (b.heightM - a.heightM)) * PER_100_M });
  }
  const first = points[0];
  const last = points.at(-1);
  if (layers.length === 0 || !first || !last || heightM < first.heightM || heightM > last.heightM) return null;
  const lower = [...layers].reverse().find((l) => l.mid <= heightM);
  const upper = layers.find((l) => l.mid >= heightM);
  if (!lower) return upper?.lapse ?? null;
  if (!upper || upper.mid === lower.mid) return lower.lapse;
  const u = (heightM - lower.mid) / (upper.mid - lower.mid);
  return lower.lapse + (upper.lapse - lower.lapse) * u;
}

export function instabilityClass(lapse: number): InstabilityClass {
  let result: InstabilityClass = 'inversion';
  for (const c of INSTABILITY_CLASSES) if (lapse >= c.minLapse) result = c.id;
  return result;
}

/** Высоты диаграммы: снизу — старт, сверху — по потолку дня. */
export function meteogramRange(elevationM: number, ceilingsM: readonly (number | null)[]): { bottomM: number; topM: number } {
  const highest = Math.max(elevationM, ...ceilingsM.filter((c): c is number => c !== null));
  const topM = Math.min(METEOGRAM.maxTopM, Math.max(elevationM + METEOGRAM.minSpanM, highest + METEOGRAM.aboveCeilingM));
  return { bottomM: elevationM, topM };
}
