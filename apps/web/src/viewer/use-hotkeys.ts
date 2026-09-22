import { useEffect } from 'react';

import { CAMERA_HOTKEY_ORDER, type CameraMode } from './camera-modes';

/**
 * Горячие клавиши просмотрщика (ТЗ §7.5).
 *
 * Разбор клавиши — чистая функция resolveHotkey: её можно проверить тестом,
 * не поднимая DOM и не рендеря сцену. Хук — только подписка и вызов.
 */

/** ТЗ §7.5: стрелки — ±1 с, Shift+стрелки — ±1 мин. */
const SEEK_STEP_S = 1;
const SEEK_STEP_SHIFT_S = 60;

export type HotkeyAction =
  | { kind: 'togglePlay' }
  | { kind: 'seek'; deltaSeconds: number }
  | { kind: 'cameraMode'; mode: CameraMode };

/** Минимум полей события, нужный для разбора. */
export interface HotkeyEvent {
  code: string;
  key: string;
  shiftKey: boolean;
}

export function resolveHotkey(event: HotkeyEvent): HotkeyAction | null {
  if (event.code === 'Space') return { kind: 'togglePlay' };

  if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') {
    const step = event.shiftKey ? SEEK_STEP_SHIFT_S : SEEK_STEP_S;
    return { kind: 'seek', deltaSeconds: event.code === 'ArrowLeft' ? -step : step };
  }

  // Цифры 1–4 — режимы камеры. Number('') === 0, поэтому проверяем длину.
  if (event.key.length === 1) {
    const digit = Number(event.key);
    const mode = Number.isInteger(digit) ? CAMERA_HOTKEY_ORDER[digit - 1] : undefined;
    if (mode !== undefined) return { kind: 'cameraMode', mode };
  }

  return null;
}

export interface HotkeyHandlers {
  onTogglePlay: () => void;
  /** Сдвиг времени в секундах. */
  onSeek: (deltaSeconds: number) => void;
  onCameraMode: (mode: CameraMode) => void;
}

export function useHotkeys(handlers: HotkeyHandlers): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // Не перехватываем клавиши у полей ввода.
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName))) {
        return;
      }

      const action = resolveHotkey(event);
      if (action === null) return;
      // Space иначе прокручивает страницу, стрелки — крутят камеру Cesium.
      event.preventDefault();

      if (action.kind === 'togglePlay') handlers.onTogglePlay();
      else if (action.kind === 'seek') handlers.onSeek(action.deltaSeconds);
      else handlers.onCameraMode(action.mode);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handlers]);
}
