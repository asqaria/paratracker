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
      data-panel="legend"
      className="w-48 rounded-xl glass px-3 py-2 compact:w-full compact:border-0 compact:bg-transparent compact:p-1 compact:shadow-none compact:backdrop-blur-none"
    >
      <figcaption className="mb-1.5 text-xs text-secondary compact:mb-1 compact:text-2xs">{t('viewer.varioLegend')}</figcaption>
      <div className="rounded-full" style={{ height: BAR_HEIGHT_PX, background: legendGradient() }} />
      {/* Подписи — на истинных позициях шкалы; крайние прижаты к краям полосы. */}
      <div className="relative mt-1 numeric text-xs text-secondary" style={{ height: LABELS_HEIGHT_PX }}>
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
