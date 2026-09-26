import { useCallback, useEffect, useRef, useState } from 'react';

import { documentColorTokens, withAlpha } from '../design/tokens';
import { useLocaleStore, useT } from '../i18n/locale';
import { buildSeriesGeometry, CHART_CHANNELS, channelSeries, type ChartChannel } from './altitude-chart';
import { CAMERA_MODES, type CameraMode } from './camera-modes';
import type { DecodedTrack } from './decode-track';
import {
  elapsedClock,
  fractionAt,
  indexAt,
  nextSpeed,
  PLAYBACK_SPEEDS,
  timeAtFraction,
  type PlaybackSpeed,
  type TrackTimeline,
} from './playback';
import { TRACK_SHOWN, type TrackShown } from './track-progress';
import { groundSpeed as formatGroundSpeed, metres, verticalSpeed } from './units';
import { varioCss } from './vario-palette';

/**
 * Таймлайн и график высоты (ТЗ §7.5). Часы Cesium остаются единственным
 * источником времени: панель только показывает их состояние и просит его сменить.
 */

export interface TimelinePanelProps {
  track: DecodedTrack;
  timeline: TrackTimeline;
  timeMs: number;
  playing: boolean;
  speed: PlaybackSpeed;
  cameraMode: CameraMode;
  /** Весь трек или только пройденный путь. */
  trackShown: TrackShown;
  onTrackShown: (shown: TrackShown) => void;
  /** «Занавес» под треком (ТЗ §7.2); без обработчика кнопки нет. */
  curtainOn?: boolean;
  onCurtainOn?: (on: boolean) => void;
  onTogglePlay: () => void;
  onSeekTo: (timeMs: number) => void;
  onSpeed: (speed: PlaybackSpeed) => void;
  onCameraMode: (mode: CameraMode) => void;
  /** Высота над рельефом по точкам трека (задача 2.15); null — рельеф ещё не пришёл. */
  agl?: Float64Array | null;
}

/** Заливка под графиком — акцентный токен, сверху полупрозрачный, книзу в ноль. */
const FILL_TOP_ALPHA = 0.26;
const FILL_BOTTOM_ALPHA = 0;
const LINE_WIDTH_PX = 2.2;
/** Линия нуля (варио — ноль, над рельефом — земля): тонкая и приглушённая. */
const ZERO_LINE_WIDTH_PX = 1;
const ZERO_LINE_ALPHA = 0.5;

export function TimelinePanel(props: TimelinePanelProps) {
  const t = useT();
  const locale = useLocaleStore((state) => state.locale);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const chartBox = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);
  /** Канал графика (задача 2.15): высота по умолчанию — как было до каналов. */
  const [channel, setChannel] = useState<ChartChannel>('altitude');
  const agl = props.agl ?? null;
  const available = (c: ChartChannel): boolean => channelSeries(c, props.track, agl) !== null;

  const index = indexAt(props.track.t, props.timeMs);
  const altitude = props.track.alt[index] ?? Number.NaN;
  const vSpeed = props.track.vSpeed[index] ?? Number.NaN;
  const groundSpeedText = formatGroundSpeed(props.track.gSpeed[index] ?? Number.NaN, locale, t);
  const fraction = fractionAt(props.timeline, props.timeMs);

  /** График перерисовывается на изменение размера и трека, но не на каждый кадр. */
  useEffect(() => {
    const element = canvas.current;
    const box = chartBox.current;
    if (!element || !box) return undefined;

    const draw = (): void => {
      // Высота — из вёрстки: на телефоне график ниже (compact:h-11).
      const width = box.clientWidth;
      const height = box.clientHeight;
      if (height === 0) return;
      const ratio = window.devicePixelRatio || 1;
      element.width = Math.max(1, Math.round(width * ratio));
      element.height = Math.round(height * ratio);
      const context = element.getContext('2d');
      if (!context) return;

      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);

      const series = channelSeries(channel, props.track, agl) ?? channelSeries('altitude', props.track, agl);
      if (!series) return;
      const geometry = buildSeriesGeometry(series, { width, height });
      if (geometry.segments.length === 0 && geometry.fill.length === 0) return;
      const { accent, secondary } = documentColorTokens();

      if (geometry.zeroY !== null) {
        context.beginPath();
        context.moveTo(0, geometry.zeroY);
        context.lineTo(width, geometry.zeroY);
        context.lineWidth = ZERO_LINE_WIDTH_PX;
        context.strokeStyle = withAlpha(secondary, ZERO_LINE_ALPHA);
        context.stroke();
      }

      if (geometry.fill.length > 0) {
      context.beginPath();
      for (const [i, point] of geometry.fill.entries()) {
        if (i === 0) context.moveTo(point.x, point.y);
        else context.lineTo(point.x, point.y);
      }
      context.closePath();
      const gradient = context.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, withAlpha(accent, FILL_TOP_ALPHA));
      gradient.addColorStop(1, withAlpha(accent, FILL_BOTTOM_ALPHA));
      context.fillStyle = gradient;
      context.fill();
      }

      context.lineWidth = LINE_WIDTH_PX;
      context.lineJoin = 'round';
      context.lineCap = 'round';
      for (const segment of geometry.segments) {
        context.beginPath();
        context.moveTo(segment.x1, segment.y1);
        context.lineTo(segment.x2, segment.y2);
        context.strokeStyle = segment.color ?? accent;
        context.stroke();
      }
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(box);
    return () => observer.disconnect();
  }, [props.track, channel, agl]);

  const seekFromPointer = useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      const box = chartBox.current;
      if (!box) return;
      const rect = box.getBoundingClientRect();
      props.onSeekTo(timeAtFraction(props.timeline, (event.clientX - rect.left) / rect.width));
    },
    [props],
  );

  return (
    // Снизу — отступ под полоску «домой» iPhone (viewport-fit=cover в index.html).
    <section data-panel="timeline" className="glass pb-[env(safe-area-inset-bottom)]">
      {/*
        На телефоне (compact) ряд кнопок не помещается: скорость — одна кнопка
        по кругу, камера — системный список, телеметрия — сеткой: в альбомной
        ориентации в том же ряду, в портрете (max-sm) — вторым рядом.
        Кнопки — не меньше 44 px (compact:min-h-11), под палец.
      */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-sm compact:gap-x-2 compact:px-3 compact:py-1.5">
        <button
          type="button"
          onClick={props.onTogglePlay}
          aria-label={props.playing ? t('viewer.pause') : t('viewer.play')}
          className="rounded bg-accent px-3 py-1 font-semibold text-void compact:min-h-11 compact:min-w-11"
        >
          {props.playing ? '❚❚' : '▶'}
        </button>

        <button
          type="button"
          aria-label={`${t('viewer.speed')}: ×${props.speed}`}
          onClick={() => props.onSpeed(nextSpeed(props.speed))}
          className="hidden min-h-11 min-w-14 rounded bg-subtle px-3 numeric compact:block"
        >
          {`×${props.speed}`}
        </button>

        <select
          aria-label={t('viewer.channel')}
          value={channel}
          onChange={(event) => {
            const next = CHART_CHANNELS.find((value) => value === event.target.value);
            if (next) setChannel(next);
          }}
          className="hidden min-h-11 rounded bg-subtle px-2 text-primary compact:block"
        >
          {CHART_CHANNELS.map((c) => (
            <option key={c} value={c} disabled={!available(c)}>
              {t(`viewer.channel.${c}`)}
            </option>
          ))}
        </select>

        <select
          aria-label={t('viewer.camera')}
          value={props.cameraMode}
          onChange={(event) => {
            const mode = CAMERA_MODES.find((value) => value === event.target.value);
            if (mode) props.onCameraMode(mode);
          }}
          className="hidden min-h-11 rounded bg-subtle px-2 text-primary compact:block"
        >
          {CAMERA_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {t(`viewer.camera.${mode}`)}
            </option>
          ))}
        </select>

        <button
          type="button"
          aria-label={`${t('viewer.trackShown')}: ${t(`viewer.trackShown.${props.trackShown}`)}`}
          onClick={() => props.onTrackShown(props.trackShown === 'all' ? 'flown' : 'all')}
          className="hidden min-h-11 rounded bg-subtle px-3 compact:block"
        >
          {t(`viewer.trackShown.${props.trackShown}`)}
        </button>

        {props.onCurtainOn && (
          <button
            type="button"
            aria-pressed={props.curtainOn ?? false}
            onClick={() => props.onCurtainOn?.(!(props.curtainOn ?? false))}
            className="hidden min-h-11 rounded px-3 text-secondary aria-pressed:bg-subtle aria-pressed:text-primary compact:block"
          >
            {t('viewer.curtain')}
          </button>
        )}

        <div role="group" aria-label={t('viewer.speed')} className="flex gap-1 compact:hidden">
          {PLAYBACK_SPEEDS.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={value === props.speed}
              onClick={() => props.onSpeed(value)}
              className="rounded px-2 py-1 numeric text-secondary aria-pressed:bg-subtle aria-pressed:text-primary"
            >
              {`×${value}`}
            </button>
          ))}
        </div>

        <div role="group" aria-label={t('viewer.camera')} className="flex gap-1 compact:hidden">
          {CAMERA_MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={mode === props.cameraMode}
              onClick={() => props.onCameraMode(mode)}
              className="rounded px-2 py-1 text-secondary aria-pressed:bg-subtle aria-pressed:text-primary"
            >
              {t(`viewer.camera.${mode}`)}
            </button>
          ))}
        </div>

        <div role="group" aria-label={t('viewer.trackShown')} className="flex gap-1 compact:hidden">
          {TRACK_SHOWN.map((shown) => (
            <button
              key={shown}
              type="button"
              aria-pressed={shown === props.trackShown}
              onClick={() => props.onTrackShown(shown)}
              className="rounded px-2 py-1 text-secondary aria-pressed:bg-subtle aria-pressed:text-primary"
            >
              {t(`viewer.trackShown.${shown}`)}
            </button>
          ))}
          {props.onCurtainOn && (
            <button
              type="button"
              aria-pressed={props.curtainOn ?? false}
              onClick={() => props.onCurtainOn?.(!(props.curtainOn ?? false))}
              className="rounded px-2 py-1 text-secondary aria-pressed:bg-subtle aria-pressed:text-primary"
            >
              {t('viewer.curtain')}
            </button>
          )}
        </div>

        {/* Цифры телеметрии — моноширинные с табличными цифрами (ТЗ §8.4). */}
        <dl className="ml-auto flex items-center gap-4 numeric compact:ml-0 compact:grid compact:grid-cols-4 compact:gap-2 compact:sm:min-w-0 compact:sm:flex-1 max-sm:w-full">
          <div className="flex gap-1 compact:flex-col compact:gap-0">
            <dt className="text-secondary compact:text-2xs">{t('viewer.time')}</dt>
            <dd>{elapsedClock(props.timeline, props.timeMs)}</dd>
          </div>
          <div className="flex gap-1 compact:flex-col compact:gap-0">
            <dt className="text-secondary compact:text-2xs">{t('viewer.altitude')}</dt>
            <dd>{metres(altitude, locale, t)}</dd>
          </div>
          <div className="flex gap-1 compact:flex-col compact:gap-0">
            <dt className="text-secondary compact:text-2xs">{t('viewer.vario')}</dt>
            <dd style={{ color: varioCss(vSpeed) }}>
              {verticalSpeed(vSpeed, locale, t)}
            </dd>
          </div>
          <div className="flex gap-1 compact:flex-col compact:gap-0">
            <dt className="text-secondary compact:text-2xs">{t('viewer.groundSpeed')}</dt>
            <dd>{groundSpeedText}</dd>
          </div>
        </dl>
      </div>

      {/* Скраббер: клик и перетаскивание прямо по графику. */}
      <div
        ref={chartBox}
        role="slider"
        tabIndex={0}
        aria-label={t('viewer.scrubber')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(fraction * 100)}
        className="relative h-24 cursor-col-resize touch-none compact:h-11"
        onPointerDown={(event) => {
          dragging.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          seekFromPointer(event);
        }}
        onPointerMove={(event) => {
          if (dragging.current) seekFromPointer(event);
        }}
        onPointerUp={(event) => {
          dragging.current = false;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
      >
        <canvas ref={canvas} className="h-full w-full" />
        {/* Каналы графика на десктопе — в углу графика; на телефоне — список в строке управления. */}
        <div
          role="group"
          aria-label={t('viewer.channel')}
          className="absolute left-1 top-1 flex gap-1 text-xs compact:hidden"
          onPointerDown={(event) => event.stopPropagation()}
        >
          {CHART_CHANNELS.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={c === channel}
              disabled={!available(c)}
              onClick={() => setChannel(c)}
              className="rounded bg-void/60 px-2 py-0.5 text-secondary aria-pressed:bg-subtle aria-pressed:text-primary disabled:opacity-40"
            >
              {t(`viewer.channel.${c}`)}
            </button>
          ))}
        </div>
        <span
          aria-hidden
          className="pointer-events-none absolute top-0 h-full w-px bg-primary"
          style={{ left: `${fraction * 100}%` }}
        />
      </div>
    </section>
  );
}
