import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { useLocaleStore } from '../i18n/locale';
import { messages, type MessageKey } from '../i18n/messages';
import type { DecodedTrack } from './decode-track';
import { timelineOf } from './playback';
import { TimelinePanel } from './TimelinePanel';
import { groundSpeed, metres, verticalSpeed } from './units';

/**
 * Панель проверяется серверным рендером: canvas и ResizeObserver живут
 * в эффектах, на сервере они не запускаются, а разметка и цифры — проверяемы.
 */

const POINT_COUNT = 5;
const START_MS = Date.UTC(2024, 6, 14, 9, 0, 0);

const track = (): DecodedTrack => {
  const index = Array.from({ length: POINT_COUNT }, (_, i) => i);
  return {
    pointCount: POINT_COUNT,
    t: Float64Array.from(index, (i) => START_MS + i * 1000),
    lat: Float64Array.from(index, (i) => 43.2 + i * 1e-4),
    lon: Float64Array.from(index, (i) => 76.9 + i * 1e-4),
    alt: Float64Array.from(index, (i) => 2400 + i * 10),
    vSpeed: Float64Array.from(index, () => 2.4),
    gSpeed: Float64Array.from(index, () => 11.6),
    heading: Float64Array.from(index, () => 180),
    flags: new Uint8Array(POINT_COUNT),
    summary: { durationS: POINT_COUNT - 1, maxAltM: 2440, distanceTrackM: 55, maxGainM: 40 },
  };
};

const noop = (): void => {};

const render = (timeMs: number, playing: boolean): string => {
  const decoded = track();
  return renderToString(
    <TimelinePanel
      track={decoded}
      timeline={timelineOf(decoded.t)}
      timeMs={timeMs}
      playing={playing}
      speed={4}
      cameraMode="chase"
      onTogglePlay={noop}
      onSeekTo={noop}
      onSpeed={noop}
      onCameraMode={noop}
    />,
  );
};

describe('TimelinePanel', () => {
  // На сервере Zustand отдаёт начальное состояние стора, сверяемся с ним.
  const { locale } = useLocaleStore.getInitialState();

  it('показывает телеметрию точки под курсором времени', () => {
    // Третья секунда полёта: высота 2420 м, варио +2.4 м/с, скорость 11.6 м/с = 42 км/ч.
    const html = render(START_MS + 2000, false);
    const t = (key: MessageKey): string => messages[locale][key];

    expect(html).toContain('00:00:02');
    expect(html).toContain(metres(2420, locale, t));
    expect(html).toContain(verticalSpeed(2.4, locale, t));
    expect(html).toContain(groundSpeed(11.6, locale, t));
    expect(html).toContain(messages[locale]['viewer.altitude']);
  });

  it('позиция скраббера соответствует времени', () => {
    // Трек длиной 4 с: середина — 50 %.
    expect(render(START_MS + 2000, false)).toContain('aria-valuenow="50"');
    expect(render(START_MS, false)).toContain('aria-valuenow="0"');
    expect(render(START_MS + 4000, false)).toContain('aria-valuenow="100"');
  });

  it('кнопка проигрывания подписана по состоянию часов', () => {
    expect(render(START_MS, false)).toContain(messages[locale]['viewer.play']);
    expect(render(START_MS, true)).toContain(messages[locale]['viewer.pause']);
  });

  it('даёт все скорости и режимы камеры из ТЗ', () => {
    const html = render(START_MS, false);
    for (const speed of [1, 2, 4, 8, 16, 60]) expect(html).toContain(`×${speed}`);
    for (const mode of ['chase', 'free', 'cockpit', 'top'] as const) {
      expect(html).toContain(messages[locale][`viewer.camera.${mode}`]);
    }
  });
});
