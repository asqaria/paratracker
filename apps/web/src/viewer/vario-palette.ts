/**
 * Раскраска трека по вариометру (ТЗ §7.3): дивергентная шкала, центр 0 м/с,
 * диапазон ±5 м/с с клипом. Цвета — токены §8.4, проверенные на дейтеранопию;
 * ноль серый, не белый: белый не читается на облаках и снеге.
 */

export interface VarioStop {
  vSpeed: number;
  rgb: readonly [number, number, number];
}

export const VARIO_STOPS: readonly VarioStop[] = [
  { vSpeed: -5, rgb: [0x3a, 0x1c, 0x71] },
  { vSpeed: -2, rgb: [0x4a, 0x6f, 0xdc] },
  { vSpeed: -0.5, rgb: [0x7e, 0x8b, 0xa3] },
  { vSpeed: 0, rgb: [0x6b, 0x72, 0x80] },
  { vSpeed: 0.5, rgb: [0xc9, 0xa2, 0x27] },
  { vSpeed: 2, rgb: [0xe8, 0x59, 0x0c] },
  { vSpeed: 5, rgb: [0xc9, 0x2a, 0x2a] },
];

/** ТЗ §7.3: за пределами диапазона цвет не меняется. */
export const VARIO_RANGE_MS = 5;
const NEUTRAL_INDEX = 3;
const OPAQUE = 255;

export type Rgb = [number, number, number];
export type Rgba = [number, number, number, number];

const neutral = (): Rgb => [...(VARIO_STOPS[NEUTRAL_INDEX]?.rgb ?? [0x6b, 0x72, 0x80])] as Rgb;

/** Цвет 0…255 по вертикальной скорости, м/с. NaN — нейтральный серый. */
export function varioRgb(vSpeed: number): Rgb {
  if (Number.isNaN(vSpeed)) return neutral();
  const value = Math.min(VARIO_RANGE_MS, Math.max(-VARIO_RANGE_MS, vSpeed));

  for (let i = 0; i < VARIO_STOPS.length - 1; i++) {
    const from = VARIO_STOPS[i];
    const to = VARIO_STOPS[i + 1];
    if (!from || !to || value < from.vSpeed || value > to.vSpeed) continue;
    const span = to.vSpeed - from.vSpeed;
    const k = span === 0 ? 0 : (value - from.vSpeed) / span;
    return [
      Math.round(from.rgb[0] + (to.rgb[0] - from.rgb[0]) * k),
      Math.round(from.rgb[1] + (to.rgb[1] - from.rgb[1]) * k),
      Math.round(from.rgb[2] + (to.rgb[2] - from.rgb[2]) * k),
    ];
  }
  return neutral();
}

export function varioRgba(vSpeed: number, alpha: number = OPAQUE): Rgba {
  const [r, g, b] = varioRgb(vSpeed);
  return [r, g, b, alpha];
}

export const varioCss = (vSpeed: number): string => `rgb(${varioRgb(vSpeed).join(' ')})`;
