import { describe, expect, it } from 'vitest';

import { COLOR_TOKENS, readColorTokens, withAlpha } from './tokens';

describe('withAlpha', () => {
  it('hex → rgb() с прозрачностью', () => {
    expect(withAlpha('#4da3ff', 0.26)).toBe('rgb(77 163 255 / 0.26)');
    expect(withAlpha('#4DA3FF', 0)).toBe('rgb(77 163 255 / 0)');
  });

  it('rgb() из @theme — прозрачность заменяется', () => {
    expect(withAlpha('rgb(16 22 32 / 0.72)', 0.5)).toBe('rgb(16 22 32 / 0.5)');
    expect(withAlpha('rgb(77, 163, 255)', 1)).toBe('rgb(77 163 255 / 1)');
  });

  it('непонятный цвет — ошибка с самим значением, а не тихий чёрный', () => {
    expect(() => withAlpha('tomato', 0.5)).toThrow(/tomato/);
  });
});

describe('readColorTokens', () => {
  const style = (values: Record<string, string>) => ({
    getPropertyValue: (name: string): string => values[name] ?? '',
  });

  it('читает CSS-переменные @theme — единственный источник цвета', () => {
    const values = Object.fromEntries(COLOR_TOKENS.map((name) => [`--color-${name}`, ` #${name.length}0${name.length}0${name.length}0 `]));
    const tokens = readColorTokens(style(values));
    expect(tokens.accent).toBe('#606060');
  });

  it('переменной нет — ошибка с её именем: иначе canvas молча нарисует чёрным', () => {
    expect(() => readColorTokens(style({}))).toThrow(/--color-/);
  });
});
