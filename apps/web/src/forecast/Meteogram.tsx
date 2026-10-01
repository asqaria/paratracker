import type { ForecastHourDto } from '@skyline/core';
import { useEffect, useRef, useState } from 'react';

import { documentColorTokens, withAlpha } from '../design/tokens';
import { useLocaleStore, useT } from '../i18n/locale';
import { metres } from '../viewer/units';
import { instabilityColorAt, VERDICT_COLOR } from './forecast-palette';
import type { LocalHour } from './forecast-time';
import { lapseRateAt, meteogramRange, METEOGRAM, windAt } from './meteogram-scale';

/**
 * Диаграмма «время × высота» (задача П.6): по горизонтали — часы дня, по
 * вертикали — высота от старта. Цвет — неустойчивость воздуха (meteogram-scale.ts),
 * белая линия — потолок термиков (полоса — разброс моделей), облачко — база
 * кучёвки, стрелки — ветер на высотах (куда сносит). Клик по столбцу — час.
 */

interface MeteogramProps {
  hours: { local: LocalHour; hour: ForecastHourDto }[];
  elevationM: number;
  time: string | null;
  onTime: (time: string) => void;
}

const HEIGHT_PX = 300;
const PAD = { left: 44, right: 6, top: 16, bottom: 20 } as const;
const VERDICT_STRIP_PX = 8;
const CELL_ALPHA = 0.9;
/** Сглаживание: столбик 3 px, ряд 25 м — цвет перетекает по часам и высоте. */
const SMOOTH_COLUMN_PX = 3;
const SMOOTH_ROW_M = 25;
const CEILING_LINE_PX = 2.5;
const RANGE_ALPHA = 0.25;
/**
 * Выше потолка — затемнение: цвет там — неустойчивость воздуха, но термик
 * туда не дойдёт (у ECMWF над стартом 2–3 уровня давления, «крышку» на
 * потолке по ним не видно — её видит модель, отсюда и потолок).
 */
const ABOVE_CEILING_DIM = 0.6;
/** Длина стрелки ветра по силе: штиль — 6 px, от ~8 м/с (30 км/ч) — 16 px. */
const ARROW_MIN_PX = 6;
const ARROW_MAX_PX = 16;
const ARROW_PX_PER_MS = 1.25;
const ARROW_HEAD_PX = 3.5;
const FONT_PX = 11;
/** Стрелка показывает, куда сносит: «откуда» + 180°. */
const DOWNWIND_DEG = 180;
const RAD = Math.PI / 180;
const CLOUD = '☁';

export function Meteogram({ hours, elevationM, time, onTime }: MeteogramProps) {
  const t = useT();
  const locale = useLocaleStore((state) => state.locale);
  const wrapper = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = wrapper.current;
    if (!element) return undefined;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry?.contentRect.width ?? 0)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const { bottomM, topM } = meteogramRange(
    elevationM,
    hours.flatMap(({ hour }) => [hour.models[0]?.ceilingM ?? null, hour.ceilingRangeM?.[1] ?? null]),
  );
  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const plotH = HEIGHT_PX - PAD.top - PAD.bottom;
  const columnW = hours.length > 0 ? plotW / hours.length : 0;
  const yOf = (heightM: number): number => PAD.top + plotH * (1 - (heightM - bottomM) / (topM - bottomM));

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || width === 0) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(HEIGHT_PX * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, HEIGHT_PX);
    const colors = documentColorTokens();
    const font = getComputedStyle(canvas).fontFamily;
    ctx.font = `${FONT_PX}px ${font}`;

    // Неустойчивость: по высоте — профиль часа, между часами — линейно (центры столбцов).
    const profiles = hours.map(({ hour }) => [hour.surface, ...hour.profile]);
    for (let px = 0; px < plotW; px += SMOOTH_COLUMN_PX) {
      const f = Math.min(hours.length - 1, Math.max(0, (px + SMOOTH_COLUMN_PX / 2) / columnW - 0.5));
      const k0 = Math.floor(f);
      const k1 = Math.min(hours.length - 1, k0 + 1);
      const u = f - k0;
      const p0 = profiles[k0];
      const p1 = profiles[k1];
      if (!p0 || !p1) continue;
      for (let h = bottomM; h < topM; h += SMOOTH_ROW_M) {
        const mid = h + SMOOTH_ROW_M / 2;
        const a = lapseRateAt(p0, mid);
        const b = lapseRateAt(p1, mid);
        const lapse = a === null ? b : b === null ? a : a + (b - a) * u;
        if (lapse === null) continue;
        ctx.fillStyle = instabilityColorAt(lapse, CELL_ALPHA);
        const y0 = yOf(Math.min(topM, h + SMOOTH_ROW_M));
        // Последний столбик не вылезает за правый край.
        ctx.fillRect(PAD.left + px, y0, Math.min(SMOOTH_COLUMN_PX + 0.5, plotW - px), yOf(h) - y0 + 0.5);
      }
    }
    hours.forEach(({ hour }, k) => {
      // Вердикт часа — полоска сверху.
      ctx.fillStyle = VERDICT_COLOR[hour.verdict];
      ctx.fillRect(PAD.left + k * columnW + 1, 2, columnW - 2, VERDICT_STRIP_PX);
    });

    // Выше потолка главной модели — затемнение по той же ломаной, что и линия потолка.
    const ceilingLine = hours.flatMap(({ hour }, k) => {
      const ceiling = hour.models[0]?.ceilingM;
      return ceiling === null || ceiling === undefined
        ? []
        : [{ x: PAD.left + (k + 0.5) * columnW, y: yOf(Math.min(topM, Math.max(bottomM, ceiling))) }];
    });
    const firstPoint = ceilingLine[0];
    const lastPoint = ceilingLine.at(-1);
    if (firstPoint && lastPoint) {
      ctx.fillStyle = withAlpha(colors.void, ABOVE_CEILING_DIM);
      ctx.beginPath();
      ctx.moveTo(PAD.left, PAD.top);
      ctx.lineTo(PAD.left, firstPoint.y);
      for (const p of ceilingLine) ctx.lineTo(p.x, p.y);
      ctx.lineTo(PAD.left + plotW, lastPoint.y);
      ctx.lineTo(PAD.left + plotW, PAD.top);
      ctx.closePath();
      ctx.fill();
    }

    // Разброс потолка по моделям — плавная полоса через центры часов, потолок главной модели — линия.
    const band = hours.flatMap(({ hour }, k) => {
      const range = hour.ceilingRangeM;
      return range ? [{ x: PAD.left + (k + 0.5) * columnW, low: yOf(Math.max(bottomM, range[0])), high: yOf(Math.min(topM, range[1])) }] : [];
    });
    if (band.length > 1) {
      ctx.fillStyle = withAlpha(colors.primary, RANGE_ALPHA);
      ctx.beginPath();
      band.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.high) : ctx.lineTo(p.x, p.high)));
      [...band].reverse().forEach((p) => ctx.lineTo(p.x, p.low));
      ctx.closePath();
      ctx.fill();
    }
    ctx.strokeStyle = colors.primary;
    ctx.lineWidth = CEILING_LINE_PX;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    let started = false;
    hours.forEach(({ hour }, k) => {
      const ceiling = hour.models[0]?.ceilingM;
      if (ceiling === null || ceiling === undefined) return;
      const x = PAD.left + (k + 0.5) * columnW;
      const y = yOf(Math.min(topM, Math.max(bottomM, ceiling)));
      if (started) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
      started = true;
    });
    ctx.stroke();

    // База кучёвки — облачко; ветер на высотах — стрелки по ветру.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    hours.forEach(({ hour }, k) => {
      const cx = PAD.left + (k + 0.5) * columnW;
      const base = hour.models[0]?.cloudBaseM;
      if (base !== null && base !== undefined && base <= topM) {
        ctx.fillStyle = colors.primary;
        ctx.fillText(CLOUD, cx, yOf(base));
      }
      ctx.lineWidth = 1.5;
      const ceiling = hour.models[0]?.ceilingM ?? null;
      // Ветер по высотам (задача П.7): модель с большим числом уровней; у старых прогнозов — профиль.
      const windPoints = hour.wind ?? [hour.surface, ...hour.profile];
      for (let h = bottomM + METEOGRAM.windStepM / 2; h <= topM; h += METEOGRAM.windStepM) {
        const wind = windAt(windPoints, h);
        if (!wind) continue;
        // Выше потолка фон затемнён — стрелка светлая, иначе её не видно.
        ctx.strokeStyle = ceiling !== null && h > ceiling ? colors.primary : colors.void;
        const length = Math.min(ARROW_MAX_PX, ARROW_MIN_PX + wind.speedMs * ARROW_PX_PER_MS);
        const angle = (wind.dirDeg + DOWNWIND_DEG) * RAD;
        const dx = Math.sin(angle) * length;
        const dy = -Math.cos(angle) * length;
        const y = yOf(h);
        ctx.beginPath();
        ctx.moveTo(cx - dx / 2, y - dy / 2);
        ctx.lineTo(cx + dx / 2, y + dy / 2);
        ctx.lineTo(cx + dx / 2 - Math.sin(angle - 0.5) * ARROW_HEAD_PX, y + dy / 2 + Math.cos(angle - 0.5) * ARROW_HEAD_PX);
        ctx.moveTo(cx + dx / 2, y + dy / 2);
        ctx.lineTo(cx + dx / 2 - Math.sin(angle + 0.5) * ARROW_HEAD_PX, y + dy / 2 + Math.cos(angle + 0.5) * ARROW_HEAD_PX);
        ctx.stroke();
      }
    });

    // Сетка высот и подписи.
    ctx.textAlign = 'right';
    ctx.fillStyle = colors.secondary;
    ctx.strokeStyle = withAlpha(colors.void, RANGE_ALPHA);
    ctx.lineWidth = 1;
    for (let h = Math.ceil(bottomM / METEOGRAM.labelStepM) * METEOGRAM.labelStepM; h <= topM; h += METEOGRAM.labelStepM) {
      const y = yOf(h);
      ctx.beginPath();
      ctx.moveTo(PAD.left, y);
      ctx.lineTo(width - PAD.right, y);
      ctx.stroke();
      ctx.fillText(metres(h, locale, t), PAD.left - 4, y);
    }
    // Часы снизу; выбранный — рамкой.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    hours.forEach(({ local }, k) => {
      const x = PAD.left + k * columnW;
      ctx.fillStyle = local.time === time ? colors.primary : colors.secondary;
      ctx.fillText(String(local.hour).padStart(2, '0'), x + columnW / 2, HEIGHT_PX - 5);
      if (local.time === time) {
        ctx.strokeStyle = colors.primary;
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 1, 1, columnW - 2, PAD.top + plotH - 1);
      }
    });
  });

  return (
    <div ref={wrapper} className="w-full">
      <canvas
        ref={canvasRef}
        data-forecast="meteogram"
        role="img"
        aria-label={t('forecast.chart')}
        style={{ width: '100%', height: HEIGHT_PX }}
        className="numeric cursor-pointer"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const k = Math.floor((event.clientX - rect.left - PAD.left) / columnW);
          const picked = hours[k];
          if (picked) onTime(picked.local.time);
        }}
      />
    </div>
  );
}
