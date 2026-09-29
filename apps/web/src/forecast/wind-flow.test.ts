import { describe, expect, it } from 'vitest';

import { FLOW, flowVelocity, nextTime, spawnParticle, stepParticles, type FlowParticle } from './wind-flow';

describe('flowVelocity — куда текут частицы на экране', () => {
  it('северный ветер (дует с севера) — вниз по экрану; скорость — пиксели на м/с', () => {
    const v = flowVelocity(4, 0, 0);
    expect(v.vx).toBeCloseTo(0, 9);
    expect(v.vy).toBeCloseTo(4 * FLOW.pxPerSecondPerMs, 9);
  });

  it('западный ветер — вправо; карта повёрнута на 90° — поворот учитывается', () => {
    expect(flowVelocity(2, 270, 0).vx).toBeCloseTo(2 * FLOW.pxPerSecondPerMs, 9);
    // Поворот MapLibre 90°: вверху восток, юг — справа; ветер с севера течёт на юг — вправо.
    const rotated = flowVelocity(2, 0, 90);
    expect(rotated.vx).toBeCloseTo(2 * FLOW.pxPerSecondPerMs, 9);
    expect(rotated.vy).toBeCloseTo(0, 9);
  });

  it('штиль — частицы стоят', () => {
    expect(flowVelocity(0, 90, 0)).toEqual({ vx: 0, vy: 0 });
  });
});

describe('stepParticles', () => {
  const area = { cx: 100, cy: 100, r: 50 };
  const fixed = () => 0.5;

  it('частица смещается на v·dt и стареет', () => {
    const p: FlowParticle = { x: 100, y: 100, age: 0, life: 3, prevX: 100, prevY: 100 };
    stepParticles([p], 0.1, { vx: 20, vy: -10 }, area, fixed);
    expect([p.x, p.y, p.age]).toEqual([102, 99, 0.1]);
    expect([p.prevX, p.prevY]).toEqual([100, 100]);
  });

  it('вылетела из круга или состарилась — рождается заново внутри круга', () => {
    const out: FlowParticle = { x: 149, y: 100, age: 0, life: 3, prevX: 149, prevY: 100 };
    const old: FlowParticle = { x: 100, y: 100, age: 2.95, life: 3, prevX: 100, prevY: 100 };
    stepParticles([out, old], 0.1, { vx: 50, vy: 0 }, area, fixed);
    for (const p of [out, old]) {
      expect(Math.hypot(p.x - area.cx, p.y - area.cy)).toBeLessThanOrEqual(area.r);
      expect(p.age).toBe(0);
      expect([p.prevX, p.prevY]).toEqual([p.x, p.y]);
    }
  });

  it('новая частица — внутри круга, срок жизни в заданных пределах', () => {
    let k = 0;
    const seq = [0.99, 0.99, 0, 0.3];
    const p = spawnParticle(area, () => seq[k++ % seq.length] ?? 0);
    expect(Math.hypot(p.x - area.cx, p.y - area.cy)).toBeLessThanOrEqual(area.r);
    expect(p.life).toBeGreaterThanOrEqual(FLOW.minLifeS);
    expect(p.life).toBeLessThanOrEqual(FLOW.maxLifeS);
  });
});

describe('nextTime — «Проиграть день»', () => {
  const times = ['a', 'b', 'c'];
  it('следующий час; с последнего — конец; неизвестный — с начала', () => {
    expect(nextTime(times, 'a')).toBe('b');
    expect(nextTime(times, 'c')).toBeNull();
    expect(nextTime(times, null)).toBe('a');
    expect(nextTime(times, 'zzz')).toBe('a');
  });
});
