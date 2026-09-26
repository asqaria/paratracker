import { useT } from '../i18n/locale';
import { COMPARE_ALIGNMENTS, type CompareAlignment } from './compare-timeline';
import { nextSpeed, PLAYBACK_SPEEDS, type PlaybackSpeed } from './playback';
import { TRACK_SHOWN, type TrackShown } from './track-progress';

/**
 * Управление временем сравнения (задача 3.12): проигрывание, скорость,
 * ползунок и выбор «реальное время / по взлёту». Часы — в сцене, панель
 * только показывает их и просит сменить.
 */

export interface CompareControlsProps {
  startMs: number;
  endMs: number;
  timeMs: number;
  /** Подпись времени: «14:05:12» в реальном, «+1:23:45» — по взлёту. */
  clockLabel: string;
  playing: boolean;
  speed: PlaybackSpeed;
  alignment: CompareAlignment;
  trackShown: TrackShown;
  onTogglePlay: () => void;
  onSeekTo: (timeMs: number) => void;
  onSpeed: (speed: PlaybackSpeed) => void;
  onAlignment: (alignment: CompareAlignment) => void;
  onTrackShown: (shown: TrackShown) => void;
}

/** Шаг ползунка — секунда: запись идёт раз в секунду. */
const SLIDER_STEP_MS = 1000;

export function CompareControls(props: CompareControlsProps) {
  const t = useT();
  const toggle = (
    <div role="group" aria-label={t('compare.align')} className="flex gap-1">
      {COMPARE_ALIGNMENTS.map((alignment) => (
        <button
          key={alignment}
          type="button"
          aria-pressed={alignment === props.alignment}
          onClick={() => props.onAlignment(alignment)}
          className="rounded px-2 py-1 text-secondary aria-pressed:bg-subtle aria-pressed:text-primary compact:min-h-11"
        >
          {t(`compare.align.${alignment}`)}
        </button>
      ))}
    </div>
  );

  return (
    <section data-panel="timeline" className="glass pb-[env(safe-area-inset-bottom)]">
      <div className="flex items-center gap-3 px-4 pt-2 compact:px-3">
        <button
          type="button"
          onClick={props.onTogglePlay}
          aria-label={props.playing ? t('viewer.pause') : t('viewer.play')}
          className="rounded bg-accent px-3 py-1 font-semibold text-void compact:min-h-11 compact:min-w-11"
        >
          {props.playing ? '❚❚' : '▶'}
        </button>
        <input
          type="range"
          aria-label={t('compare.slider')}
          min={props.startMs}
          max={props.endMs}
          step={SLIDER_STEP_MS}
          value={Math.min(props.endMs, Math.max(props.startMs, props.timeMs))}
          onChange={(event) => props.onSeekTo(Number(event.target.value))}
          className="min-w-0 flex-1 accent-accent compact:min-h-11"
        />
        <span data-panel="compare-clock" className="numeric text-sm text-primary">
          {props.clockLabel}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-sm compact:gap-x-2 compact:px-3 compact:py-1.5">
        <button
          type="button"
          aria-label={`${t('viewer.speed')}: ×${props.speed}`}
          onClick={() => props.onSpeed(nextSpeed(props.speed))}
          className="hidden min-h-11 min-w-14 rounded bg-subtle px-3 numeric compact:block"
        >
          {`×${props.speed}`}
        </button>
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
        {toggle}
        <div role="group" aria-label={t('viewer.trackShown')} className="flex gap-1">
          {TRACK_SHOWN.map((shown) => (
            <button
              key={shown}
              type="button"
              aria-pressed={shown === props.trackShown}
              onClick={() => props.onTrackShown(shown)}
              className="rounded px-2 py-1 text-secondary aria-pressed:bg-subtle aria-pressed:text-primary compact:min-h-11"
            >
              {t(`viewer.trackShown.${shown}`)}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
