/**
 * Анимация карты прогноза (задача П.5, ТЗ §6.9): частицы ветра вокруг места
 * старта — текут по ветру выбранного часа, как на Windy, — и «Проиграть день».
 * Частицы живут в пикселях экрана: скорость на экране одна при любом
 * масштабе, иначе на мелком масштабе ветер стоял бы, а на крупном — мелькал.
 */

export const FLOW = {
  /** 1 м/с — 6 px/с: 5 м/с (18 км/ч) пересекает круг частиц за несколько секунд. */
  pxPerSecondPerMs: 6,
  /** Частиц на место: гуще — каша, реже — не видно течения. */
  particlesPerSite: 180,
  /** Круг частиц вокруг места, м: ветер места — прогноз на старте, дальше он уже другой. */
  radiusM: 15_000,
  /** Жизнь частицы, с: разная — чтобы не рождались и не гасли разом. */
  minLifeS: 1.5,
  maxLifeS: 4,
  /** Шаг «Проиграть день»: час за 1,5 с — успеваешь увидеть смену цвета и ветра. */
  playStepMs: 1500,
} as const;

export interface FlowParticle {
  x: number;
  y: number;
  /** Где была на прошлом кадре — хвост штриха. */
  prevX: number;
  prevY: number;
  age: number;
  life: number;
}

export interface FlowArea {
  cx: number;
  cy: number;
  r: number;
}

const RAD = Math.PI / 180;
/** Ветер «откуда» → направление движения «куда». */
const DOWNWIND_DEG = 180;

/** Скорость частиц на экране, px/с. bearingDeg — поворот карты (север вверх — 0). */
export function flowVelocity(speedMs: number, windFromDeg: number, bearingDeg: number): { vx: number; vy: number } {
  if (!(speedMs > 0)) return { vx: 0, vy: 0 };
  const angle = (windFromDeg + DOWNWIND_DEG - bearingDeg) * RAD;
  const px = speedMs * FLOW.pxPerSecondPerMs;
  // Экран: x — вправо (восток), y — вниз (юг).
  return { vx: Math.sin(angle) * px, vy: -Math.cos(angle) * px };
}

export function spawnParticle(area: FlowArea, random: () => number): FlowParticle {
  // Корень из равномерного — равномерно по площади круга, а не гуще в центре.
  const r = area.r * Math.sqrt(random());
  const a = random() * 2 * Math.PI;
  const x = area.cx + r * Math.cos(a);
  const y = area.cy + r * Math.sin(a);
  return { x, y, prevX: x, prevY: y, age: 0, life: FLOW.minLifeS + random() * (FLOW.maxLifeS - FLOW.minLifeS) };
}

/** Шаг анимации на dt секунд; вылетевшие и состарившиеся рождаются заново. */
export function stepParticles(
  particles: FlowParticle[],
  dt: number,
  velocity: { vx: number; vy: number },
  area: FlowArea,
  random: () => number,
): void {
  for (const p of particles) {
    p.prevX = p.x;
    p.prevY = p.y;
    p.x += velocity.vx * dt;
    p.y += velocity.vy * dt;
    p.age += dt;
    if (p.age >= p.life || Math.hypot(p.x - area.cx, p.y - area.cy) > area.r) Object.assign(p, spawnParticle(area, random));
  }
}

/** Следующий час для «Проиграть день»; последний — null (стоп). */
export function nextTime(times: readonly string[], current: string | null): string | null {
  const index = current === null ? -1 : times.indexOf(current);
  if (index < 0) return times[0] ?? null;
  return times[index + 1] ?? null;
}
