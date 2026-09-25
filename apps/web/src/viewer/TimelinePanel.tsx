import { useCallback, useEffect, useRef } from 'react';

import { useLocaleStore, useT } from '../i18n/locale';
import { buildChartGeometry } from './altitude-chart';
import { CAMERA_MODES, type CameraMode } from './camera-modes';
import type { DecodedTrack } from './decode-track';
import {
  elapsedClock,
  fractionAt,
  indexAt,
  PLAYBACK_SPEEDS,
  timeAtFraction,
  type PlaybackSpeed,
  type TrackTimeline,
} from './playback';
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
  onTogglePlay: () => void;
  onSeekTo: (timeMs: number) => void;
  onSpeed: (speed: PlaybackSpeed) => void;
  onCameraMode: (mode: CameraMode) => void;
}

const CHART_HEIGHT_PX = 96;
const FILL_TOP = 'rgba(77, 163, 255, 0.26)';
const FILL_BOTTOM = 'rgba(77, 163, 255, 0)';
const LINE_WIDTH_PX = 2.2;

export function TimelinePanel(props: TimelinePanelProps) {
  const t = useT();
  const locale = useLocaleStore((state) => state.locale);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const chartBox = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);

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
      const width = box.clientWidth;
      const height = CHART_HEIGHT_PX;
      const ratio = window.devicePixelRatio || 1;
      element.width = Math.max(1, Math.round(width * ratio));
      element.height = Math.round(height * ratio);
      const context = element.getContext('2d');
      if (!context) return;

      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);

      const geometry = buildChartGeometry({ alt: props.track.alt, vSpeed: props.track.vSpeed }, { width, height });
      if (geometry.fill.length === 0) return;

      context.beginPath();
      for (const [i, point] of geometry.fill.entries()) {
        if (i === 0) context.moveTo(point.x, point.y);
        else context.lineTo(point.x, point.y);
      }
      context.closePath();
      const gradient = context.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, FILL_TOP);
      gradient.addColorStop(1, FILL_BOTTOM);
      context.fillStyle = gradient;
      context.fill();

      context.lineWidth = LINE_WIDTH_PX;
      context.lineJoin = 'round';
      context.lineCap = 'round';
      for (const segment of geometry.segments) {
        context.beginPath();
        context.moveTo(segment.x1, segment.y1);
        context.lineTo(segment.x2, segment.y2);
        context.strokeStyle = segment.color;
        context.stroke();
      }
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(box);
    return () => observer.disconnect();
  }, [props.track]);

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
    <section className="border-t border-subtle bg-glass backdrop-blur-xl">
      <div className="flex items-center gap-4 px-4 py-2 text-sm">
        <button
          type="button"
          onClick={props.onTogglePlay}
          aria-label={props.playing ? t('viewer.pause') : t('viewer.play')}
          className="rounded bg-accent px-3 py-1 font-semibold text-void"
        >
          {props.playing ? '❚❚' : '▶'}
        </button>

        <div role="group" aria-label={t('viewer.speed')} className="flex gap-1">
          {PLAYBACK_SPEEDS.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={value === props.speed}
              onClick={() => props.onSpeed(value)}
              className="rounded px-2 py-1 font-numeric text-secondary tabular-nums aria-pressed:bg-subtle aria-pressed:text-primary"
            >
              {`×${value}`}
            </button>
          ))}
        </div>

        <div role="group" aria-label={t('viewer.camera')} className="flex gap-1">
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

        {/* Цифры телеметрии — моноширинные с табличными цифрами (ТЗ §8.4). */}
        <dl className="ml-auto flex items-center gap-4 font-numeric tabular-nums">
          <div className="flex gap-1">
            <dt className="text-secondary">{t('viewer.time')}</dt>
            <dd>{elapsedClock(props.timeline, props.timeMs)}</dd>
          </div>
          <div className="flex gap-1">
            <dt className="text-secondary">{t('viewer.altitude')}</dt>
            <dd>{metres(altitude, locale, t)}</dd>
          </div>
          <div className="flex gap-1">
            <dt className="text-secondary">{t('viewer.vario')}</dt>
            <dd style={{ color: varioCss(vSpeed) }}>
              {verticalSpeed(vSpeed, locale, t)}
            </dd>
          </div>
          <div className="flex gap-1">
            <dt className="text-secondary">{t('viewer.groundSpeed')}</dt>
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
        className="relative cursor-col-resize"
        style={{ height: CHART_HEIGHT_PX }}
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
        <span
          aria-hidden
          className="pointer-events-none absolute top-0 h-full w-px bg-primary"
          style={{ left: `${fraction * 100}%` }}
        />
      </div>
    </section>
  );
}
