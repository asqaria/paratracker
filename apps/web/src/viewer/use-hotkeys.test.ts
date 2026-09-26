import { describe, expect, it } from 'vitest';

import { resolveHotkey, type HotkeyEvent } from './use-hotkeys';

const press = (event: Partial<HotkeyEvent>): HotkeyEvent => ({
  code: '',
  key: '',
  shiftKey: false,
  ...event,
});

describe('resolveHotkey', () => {
  it('Space переключает проигрывание', () => {
    expect(resolveHotkey(press({ code: 'Space', key: ' ' }))).toEqual({ kind: 'togglePlay' });
  });

  it('стрелки сдвигают время на ±1 с', () => {
    expect(resolveHotkey(press({ code: 'ArrowLeft', key: 'ArrowLeft' }))).toEqual({
      kind: 'seek',
      deltaSeconds: -1,
    });
    expect(resolveHotkey(press({ code: 'ArrowRight', key: 'ArrowRight' }))).toEqual({
      kind: 'seek',
      deltaSeconds: 1,
    });
  });

  it('Shift+стрелки — на ±1 мин', () => {
    expect(resolveHotkey(press({ code: 'ArrowLeft', key: 'ArrowLeft', shiftKey: true }))).toEqual({
      kind: 'seek',
      deltaSeconds: -60,
    });
    expect(resolveHotkey(press({ code: 'ArrowRight', key: 'ArrowRight', shiftKey: true }))).toEqual({
      kind: 'seek',
      deltaSeconds: 60,
    });
  });

  it('цифры 1–4 выбирают режимы камеры в порядке ТЗ', () => {
    expect(resolveHotkey(press({ code: 'Digit1', key: '1' }))).toEqual({ kind: 'cameraMode', mode: 'chase' });
    expect(resolveHotkey(press({ code: 'Digit2', key: '2' }))).toEqual({ kind: 'cameraMode', mode: 'side' });
    expect(resolveHotkey(press({ code: 'Digit3', key: '3' }))).toEqual({ kind: 'cameraMode', mode: 'free' });
    expect(resolveHotkey(press({ code: 'Digit4', key: '4' }))).toEqual({ kind: 'cameraMode', mode: 'cockpit' });
    expect(resolveHotkey(press({ code: 'Digit5', key: '5' }))).toEqual({ kind: 'cameraMode', mode: 'top' });
  });

  it('прочие клавиши не значат ничего', () => {
    // Ноль и шестёрка вне диапазона режимов, буквы и модификаторы — тоже мимо.
    expect(resolveHotkey(press({ code: 'Digit0', key: '0' }))).toBeNull();
    expect(resolveHotkey(press({ code: 'Digit6', key: '6' }))).toBeNull();
    expect(resolveHotkey(press({ code: 'KeyK', key: 'k' }))).toBeNull();
    expect(resolveHotkey(press({ code: 'Enter', key: 'Enter' }))).toBeNull();
  });
});
