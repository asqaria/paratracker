import { useLocaleStore, useT } from '../i18n/locale';
import { legendGradient, legendTicks } from './vario-legend';

/** Легенда раскраски трека по вариометру (ТЗ §7.3, §8.3). */

const BAR_HEIGHT_PX = 9;
const LABELS_HEIGHT_PX = 14;

export function VarioLegend() {
  const t = useT();
  const locale = useLocaleStore((state) => state.locale);

  return (
    <figure
      role="img"
      aria-label={t('viewer.varioLegend.description')}
      className="w-48 rounded-xl border border-subtle bg-glass px-3 py-2 backdrop-blur-xl"
    >
      <figcaption className="mb-1.5 text-xs text-secondary">{t('viewer.varioLegend')}</figcaption>
      <div className="rounded-full" style={{ height: BAR_HEIGHT_PX, background: legendGradient() }} />
      {/* Подписи — на истинных позициях шкалы; крайние прижаты к краям полосы. */}
      <div className="relative mt-1 font-numeric text-xs tabular-nums text-secondary" style={{ height: LABELS_HEIGHT_PX }}>
        {legendTicks(locale).map((tick, index, ticks) => (
          <span
            key={tick.vSpeed}
            className="absolute"
            style={{
              left: `${tick.positionPct}%`,
              transform: index === 0 ? 'none' : index === ticks.length - 1 ? 'translateX(-100%)' : 'translateX(-50%)',
            }}
          >
            {tick.label}
          </span>
        ))}
      </div>
    </figure>
  );
}
