import { RACE, TIME } from '@skyline/core';
import { describe, expect, it } from 'vitest';

import { cleanAndDerive } from './clean-derive.js';
import { flightRange } from './flight-range.js';
import { matchOnTrack, raceGaps, type RacePilot, type RaceTrack } from './race.js';
import { parseFixture } from './testing/tracks.js';

/**
 * Отставание в сравнении треков (задача 3.12б) на реальном треке с термиками
 * (fixtures/real-wind-thermals.igc). Эталон точный и выводится без алгоритма:
 * трек против самого себя, сдвинутого на DELAY. В точке записи ведомый стоит
 * ровно там, где лидер был DELAY назад, — отставание ровно DELAY, хотя рядом
 * десятки витков спиралей того же трека.
 */

const DELAY_MS = 180 * TIME.msPerSecond;

const p = cleanAndDerive(parseFixture('real-wind-thermals.igc')).points;
const range = flightRange(p.t, p.groundSpeed);
const lead: RaceTrack = { t: p.t, lat: p.lat, lon: p.lon, range };
const delayed: RaceTrack = { ...lead, t: p.t.map((t) => t + DELAY_MS) };
const takeoffMs = p.t[range.takeoff] ?? Number.NaN;

/** Пилот в момент сцены: сцена = время трека + сдвиг. */
const pilot = (track: RaceTrack, offsetMs: number, sceneMs: number): RacePilot => {
  const localMs = sceneMs - offsetMs;
  const first = track.t[0] ?? 0;
  const i = Math.max(0, Math.min(track.t.length - 1, Math.round((localMs - first) / TIME.msPerSecond)));
  return { track, offsetMs, localMs, lat: track.lat[i] ?? Number.NaN, lon: track.lon[i] ?? Number.NaN };
};

/** Моменты посреди полёта — в том числе внутри термиков, где витки трека рядом друг с другом. */
const samples = [0.2, 0.35, 0.5, 0.65, 0.8].map((share) => {
  const i = Math.round(range.takeoff + share * (range.landing - range.takeoff));
  return (p.t[i] ?? 0) + DELAY_MS;
});

describe('raceGaps на реальном треке', () => {
  it('реальное время: ведомый позади ровно на задержку; лидер — 0', () => {
    for (const sceneMs of samples) {
      const gaps = raceGaps([pilot(lead, 0, sceneMs), pilot(delayed, 0, sceneMs)], 0, sceneMs);
      expect(gaps).toEqual([0, DELAY_MS]);
    }
  });

  it('опорный — ведомый: лидер тот же, цифры те же', () => {
    for (const sceneMs of samples) {
      expect(raceGaps([pilot(lead, 0, sceneMs), pilot(delayed, 0, sceneMs)], 1, sceneMs)).toEqual([0, DELAY_MS]);
    }
  });

  it('по взлёту: сдвиг снимает задержку — идут вровень', () => {
    for (const sceneMs of samples) {
      const gaps = raceGaps([pilot(lead, 0, sceneMs), pilot(delayed, -DELAY_MS, sceneMs)], 0, sceneMs);
      expect(gaps).toEqual([0, 0]);
    }
  });

  it('ведомый ещё не взлетел — отставания нет, лидер считается', () => {
    const sceneMs = takeoffMs + DELAY_MS / 2;
    expect(raceGaps([pilot(lead, 0, sceneMs), pilot(delayed, 0, sceneMs)], 0, sceneMs)).toEqual([0, null]);
  });

  it('не на маршруте (11 км в стороне) — отставания нет', () => {
    const far: RaceTrack = { ...delayed, lat: p.lat.map((lat) => lat + 0.1) };
    const sceneMs = samples[2] ?? 0;
    expect(raceGaps([pilot(lead, 0, sceneMs), pilot(far, 0, sceneMs)], 0, sceneMs)).toEqual([0, null]);
  });
});

describe('matchOnTrack', () => {
  it('точка трека — её же время; расстояние 0', () => {
    const i = Math.round((range.takeoff + range.landing) / 2);
    const match = matchOnTrack(lead, p.lat[i] ?? 0, p.lon[i] ?? 0, p.t[i] ?? 0, Number.POSITIVE_INFINITY);
    expect(match).toEqual({ timeMs: p.t[i], distanceM: 0 });
  });

  it('будущее лидера не в счёт: до untilMs', () => {
    const i = Math.round((range.takeoff + range.landing) / 2);
    const until = (p.t[i] ?? 0) - 60 * TIME.msPerSecond;
    const match = matchOnTrack(lead, p.lat[i] ?? 0, p.lon[i] ?? 0, p.t[i] ?? 0, until);
    expect(match === null || match.timeMs <= until).toBe(true);
  });

  it('дальше RACE.maxOffCourseM — null', () => {
    const i = range.takeoff;
    expect(matchOnTrack(lead, (p.lat[i] ?? 0) + 0.1, p.lon[i] ?? 0, p.t[i] ?? 0, Number.POSITIVE_INFINITY)).toBeNull();
    expect(RACE.maxOffCourseM).toBeLessThan(11_000);
  });
});
