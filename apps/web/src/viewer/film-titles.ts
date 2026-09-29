import type { CutKind, CutScene } from '@skyline/analysis';

import type { Film, FilmFrame } from './film';

/**
 * Титры фильма (задача 4.3, ТЗ §7.6): заставка с местом и датой на взлёте,
 * подпись каждой сцены с её цифрами, итоги полёта на посадке. Здесь —
 * какую карточку показать и какие цифры у сцены; рисует FilmOverlay.
 */

export const TITLES = {
  /** Заставка — первая половина взлёта: пилот успевает прочитать место и дату. */
  openingShare: 0.5,
  /** Итоги — с 40 % посадки: к концу фильма цифры полёта уже на экране. */
  closingFromShare: 0.4,
} as const;

export type FilmCard = 'opening' | 'caption' | 'closing' | 'none';

/** Какая карточка на кадре: в перелётах подписей нет — там камера рассказывает сама. */
export function filmCard(film: Film, frame: FilmFrame): FilmCard {
  if (frame.kind !== 'scene') return 'none';
  const last = film.shots.length - 1;
  if (frame.index === 0 && frame.u < TITLES.openingShare) return 'opening';
  if (frame.index === last && frame.u >= Math.max(TITLES.closingFromShare, last === 0 ? TITLES.openingShare : 0)) return 'closing';
  return 'caption';
}

export interface FactThermal {
  startMs: number;
  endMs: number;
  gainM: number;
  avgClimbMs: number;
}

export interface FactGlide {
  startMs: number;
  endMs: number;
  distanceM: number;
  glideRatio: number | null;
}

export interface SceneFactsInput {
  thermals: readonly FactThermal[];
  glides: readonly FactGlide[];
  t: ArrayLike<number>;
  alt: ArrayLike<number>;
}

export interface SceneFacts {
  kind: CutKind;
  gainM?: number;
  climbMs?: number;
  distanceM?: number;
  glideRatio?: number | null;
  altM?: number;
}

/** Окно сцены целиком внутри отрезка — это он (окно могло быть подрезано). */
const within = (scene: CutScene, startMs: number, endMs: number): boolean => scene.fromMs >= startMs && scene.toMs <= endMs;

export function sceneFacts(scene: CutScene, input: SceneFactsInput): SceneFacts {
  switch (scene.kind) {
    case 'firstThermal':
    case 'bestThermal': {
      const thermal = input.thermals.find((th) => within(scene, th.startMs, th.endMs));
      return thermal ? { kind: scene.kind, gainM: thermal.gainM, climbMs: thermal.avgClimbMs } : { kind: scene.kind };
    }
    case 'longestGlide': {
      const glide = input.glides.find((g) => within(scene, g.startMs, g.endMs));
      return glide ? { kind: scene.kind, distanceM: glide.distanceM, glideRatio: glide.glideRatio } : { kind: scene.kind };
    }
    case 'maxAltitude': {
      let best = -Infinity;
      for (let i = 0; i < input.t.length; i++) {
        const time = input.t[i] ?? Number.NaN;
        if (time < scene.fromMs || time > scene.toMs) continue;
        best = Math.max(best, input.alt[i] ?? -Infinity);
      }
      return Number.isFinite(best) ? { kind: scene.kind, altM: best } : { kind: scene.kind };
    }
    default:
      return { kind: scene.kind };
  }
}
