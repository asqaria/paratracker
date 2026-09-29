import type { CutScene } from '@skyline/analysis';
import { describe, expect, it } from 'vitest';

import { FILM } from './film';
import { filmCard, sceneFacts, TITLES } from './film-titles';

const scene = (kind: CutScene['kind'], fromS: number, toS: number): CutScene => ({
  kind,
  camera: 'chase',
  fromMs: fromS * 1000,
  toMs: toS * 1000,
  durationS: 5,
  timeScale: (toS - fromS) / 5,
});

const thermals = [
  { startMs: 1000_000, endMs: 1600_000, gainM: 640, avgClimbMs: 1.07 },
  { startMs: 5000_000, endMs: 5900_000, gainM: 1100, avgClimbMs: 1.22 },
];
const glides = [{ startMs: 2000_000, endMs: 3200_000, distanceM: 14_200, glideRatio: 8.4 }];
const t = Float64Array.from({ length: 7201 }, (_, s) => s * 1000);
const alt = Float64Array.from({ length: 7201 }, (_, s) => 1900 + (s === 4500 ? 1500 : s / 10));

describe('sceneFacts — цифры сцены', () => {
  it('термик: набор и средний подъём термика, который накрывает окно сцены', () => {
    // Окно сцены — верх лучшего термика (потолок ускорения подрезал начало).
    expect(sceneFacts(scene('bestThermal', 5500, 5900), { thermals, glides, t, alt })).toEqual({ kind: 'bestThermal', gainM: 1100, climbMs: 1.22 });
  });

  it('глайд: дистанция и качество перехода', () => {
    expect(sceneFacts(scene('longestGlide', 2300, 2900), { thermals, glides, t, alt })).toEqual({
      kind: 'longestGlide',
      distanceM: 14_200,
      glideRatio: 8.4,
    });
  });

  it('рекорд высоты: максимум высоты в окне сцены', () => {
    expect(sceneFacts(scene('maxAltitude', 4470, 4530), { thermals, glides, t, alt })).toEqual({ kind: 'maxAltitude', altM: 3400 });
  });

  it('нет подходящего термика или глайда — только вид сцены', () => {
    expect(sceneFacts(scene('firstThermal', 100, 200), { thermals, glides, t, alt })).toEqual({ kind: 'firstThermal' });
    expect(sceneFacts(scene('landing', 7100, 7200), { thermals, glides, t, alt })).toEqual({ kind: 'landing' });
  });
});

describe('filmCard — открывающая и закрывающая карточки', () => {
  const shots = [{ scene: scene('takeoff', 0, 60), startS: 0, endS: 6 }, { scene: scene('landing', 7000, 7200), startS: 8.5, endS: 15.5 }];
  const film = { shots, totalS: 15.5 };

  it('первая сцена до середины — заставка; последняя с 40 % — итоги; остальное — подпись сцены', () => {
    expect(filmCard(film, { kind: 'scene', index: 0, u: 0.2, flightMs: 0 })).toBe('opening');
    expect(filmCard(film, { kind: 'scene', index: 0, u: TITLES.openingShare + 0.01, flightMs: 0 })).toBe('caption');
    expect(filmCard(film, { kind: 'transition', index: 0, u: 0.5, flightMs: 0 })).toBe('none');
    expect(filmCard(film, { kind: 'scene', index: 1, u: 0.2, flightMs: 0 })).toBe('caption');
    expect(filmCard(film, { kind: 'scene', index: 1, u: TITLES.closingFromShare, flightMs: 0 })).toBe('closing');
  });

  it('фильм из одной сцены — сначала заставка, потом итоги', () => {
    const single = { shots: [shots[0]!], totalS: 6 };
    expect(filmCard(single, { kind: 'scene', index: 0, u: 0.1, flightMs: 0 })).toBe('opening');
    expect(filmCard(single, { kind: 'scene', index: 0, u: 0.9, flightMs: 0 })).toBe('closing');
    expect(FILM.transitionS).toBeGreaterThan(0);
  });
});
