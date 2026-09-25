/**
 * Цвета дизайн-системы для того, что не видит классов Tailwind: canvas графика
 * и сцена Cesium. Источник один — @theme в index.css (ТЗ §8.4); здесь только
 * чтение CSS-переменных, значения не дублируются.
 */

export const COLOR_TOKENS = ['void', 'glass', 'subtle', 'primary', 'secondary', 'accent', 'danger'] as const;
export type ColorToken = (typeof COLOR_TOKENS)[number];
export type ColorTokens = Record<ColorToken, string>;

/** Минимум CSSStyleDeclaration, нужный для чтения: подменяется в тестах. */
export interface StyleSource {
  getPropertyValue(name: string): string;
}

export function readColorTokens(style: StyleSource): ColorTokens {
  const entries = COLOR_TOKENS.map((name) => {
    const variable = `--color-${name}`;
    const value = style.getPropertyValue(variable).trim();
    // Без переменной canvas молча рисует чёрным — лучше упасть с её именем.
    if (value === '') throw new Error(`Design token ${variable} is not defined (see index.css @theme)`);
    return [name, value] as const;
  });
  return Object.fromEntries(entries) as ColorTokens;
}

/** Токены документа; вызывать после монтирования, когда стили уже применены. */
export const documentColorTokens = (): ColorTokens => readColorTokens(getComputedStyle(document.documentElement));

const HEX = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;
const RGB = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i;
const HEX_RADIX = 16;

/** Цвет токена с другой прозрачностью: заливки графика и свечение трека. */
export function withAlpha(color: string, alpha: number): string {
  const channels = HEX.exec(color.trim())?.slice(1).map((part) => Number.parseInt(part, HEX_RADIX))
    ?? RGB.exec(color.trim())?.slice(1).map(Number);
  if (!channels) throw new Error(`Unsupported color token value: ${color}`);
  return `rgb(${channels.join(' ')} / ${alpha})`;
}
