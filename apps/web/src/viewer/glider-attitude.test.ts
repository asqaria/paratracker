import { describe, expect, it } from 'vitest';

import { shortestTurn } from './camera-modes';
import { gliderAttitude, launchHeadingDeg, MAX_BANK_DEG } from './glider-attitude';

import type { AttitudeTrack } from './glider-attitude';

/**
 * Поза модели параплана: курс по сглаженной траектории и крен координированного
 * виража tan(крен) = v·ω / g. Треки синтетические, геометрия известна.
 */

const START_MS = Date.UTC(2026, 6, 15, 10);
const LAT0 = 43.2;
const LON0 = 76.9;
const M_PER_DEG_LAT = 111_320;
const mPerDegLon = M_PER_DEG_LAT * Math.cos((LAT0 * Math.PI) / 180);
const G = 9.80665;

/** Трек с шагом 1 с; gSpeed — заданная путевая скорость, как её пишет воркер. */
function trackOf(
  seconds: number,
  offset: (s: number) => { east: number; north: number },
  speedMs: number,
): AttitudeTrack {
  const n = seconds + 1;
  const track = {
    t: new Float64Array(n),
    lat: new Float64Array(n),
    lon: new Float64Array(n),
    alt: new Float64Array(n),
    gSpeed: new Float64Array(n).fill(speedMs),
  };
  for (let i = 0; i < n; i++) {
    const { east, north } = offset(i);
    track.t[i] = START_MS + i * 1000;
    track.lat[i] = LAT0 + north / M_PER_DEG_LAT;
    track.lon[i] = LON0 + east / mPerDegLon;
    track.alt[i] = 1500 - 0.1 * i;
  }
  return track;
}

/** Круг радиуса r со скоростью v: вправо (по часовой, если смотреть сверху) или влево. */
const circle = (r: number, v: number, right: boolean) =>
  trackOf(300, (s) => {
    const angle = ((right ? 1 : -1) * v * s) / r;
    return { east: r * Math.sin(angle), north: r * Math.cos(angle) };
  }, v);

const at = (s: number): number => START_MS + s * 1000;

describe('gliderAttitude — как стоит крыло', () => {
  it('прямой глайд: курс по направлению полёта, крена нет', () => {
    const glide = trackOf(120, (s) => ({ east: 8 * s, north: 8 * s }), 8 * Math.SQRT2);
    const pose = gliderAttitude(glide, at(60), true);
    expect(shortestTurn(45, pose.headingDeg)).toBeCloseTo(0, 1);
    expect(pose.bankDeg).toBeCloseTo(0, 1);
  });

  it('вираж радиусом 40 м на 10 м/с — крен atan(v²/(g·r)) ≈ 14°, вправо — положительный', () => {
    const expected = (Math.atan((10 * 10) / (G * 40)) * 180) / Math.PI;
    const right = gliderAttitude(circle(40, 10, true), at(150), true);
    const left = gliderAttitude(circle(40, 10, false), at(150), true);
    expect(right.bankDeg).toBeCloseTo(expected, 0);
    expect(left.bankDeg).toBeCloseTo(-expected, 0);
  });

  it('курс в вираже — по касательной к кругу', () => {
    // Вправо по кругу с севера: через четверть круга пилот летит на юг.
    const r = 40;
    const v = 10;
    const quarter = (Math.PI / 2) * (r / v);
    const pose = gliderAttitude(circle(r, v, true), at(100 + 4 * quarter), true);
    const angle = (v * (100 + 4 * quarter)) / r;
    // Скорость (cos a, −sin a) по (восток, север): курс 90° + a, растёт по часовой.
    const tangent = ((90 + (angle * 180) / Math.PI) % 360 + 360) % 360;
    expect(Math.abs(shortestTurn(tangent, pose.headingDeg))).toBeLessThan(5);
  });

  it('крутой быстрый вираж — крен не больше предела', () => {
    // r = 30 м на 86 км/ч: atan(v²/(g·r)) ≈ 63°. Круг за 8 с — на 1 Гц ещё различим;
    // спираль быстрее ~1 рад/с по фиксам раз в секунду не восстановить.
    const pose = gliderAttitude(circle(30, 24, true), at(150), true);
    expect(pose.bankDeg).toBe(MAX_BANK_DEG);
  });

  it('шум GPS на прямой не раскачивает крыло', () => {
    // ±1,5 м через фикс — остаток шума после медианного фильтра воркера (ТЗ §5.2).
    const noisy = trackOf(200, (s) => ({ east: 10 * s, north: s % 2 === 0 ? 1.5 : -1.5 }), 10);
    for (let s = 30; s < 170; s += 0.7) {
      expect(Math.abs(gliderAttitude(noisy, at(s), true).bankDeg)).toBeLessThan(5);
    }
  });

  it('на земле (до взлёта, после посадки) — без крена', () => {
    expect(gliderAttitude(circle(40, 10, true), at(150), false).bankDeg).toBe(0);
  });

  it('стоит на месте — курса нет (NaN): сцена держит прежний', () => {
    const standing = trackOf(120, () => ({ east: 0, north: 0 }), 0);
    const pose = gliderAttitude(standing, at(60), true);
    expect(pose.headingDeg).toBeNaN();
    expect(pose.bankDeg).toBe(0);
  });
});

describe('launchHeadingDeg — пилот на старте лицом к разбегу', () => {
  it('курс первых секунд после взлёта: стоял — разбежался на восток', () => {
    const n = 200;
    const t = Float64Array.from({ length: n }, (_, i) => i * 1000);
    // 60 с стоит, потом летит на восток 10 м/с.
    const lon = Float64Array.from({ length: n }, (_, i) => 76.9 + (Math.max(0, i - 60) * 10) / 81_000);
    const lat = new Float64Array(n).fill(43.2);
    const alt = new Float64Array(n).fill(1500);
    const heading = launchHeadingDeg({ t, lat, lon, alt }, 60_000);
    expect(Math.abs(heading - 90)).toBeLessThan(2);
  });

  it('после взлёта курса нет (стоит всю запись) — NaN', () => {
    const n = 100;
    const t = Float64Array.from({ length: n }, (_, i) => i * 1000);
    const still = { t, lat: new Float64Array(n).fill(43.2), lon: new Float64Array(n).fill(76.9), alt: new Float64Array(n).fill(1500) };
    expect(launchHeadingDeg(still, 10_000)).toBeNaN();
  });
});
