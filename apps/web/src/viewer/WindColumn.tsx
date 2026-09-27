import type { WindBandDto, WindDto } from '@skyline/core';

import { fill, useLocaleStore, useT } from '../i18n/locale';
import { compassPoint } from './format-analytics';
import { groundSpeed } from './units';
import { downwindDeg, layersTopDown, type WindHere } from './wind-arrows';

/**
 * Ветер по высотам в углу сцены (задача 3.14): слой — стрелка, румб, скорость;
 * слой пилота подсвечен. Стрелки повёрнуты относительно камеры: CSS-переменная
 * --camera-heading обновляется в кадре сцены без перерисовки React.
 */

export interface WindColumnProps {
  profile: readonly WindBandDto[];
  flight: WindDto | null;
  /** Ветер там, где пилот сейчас: по нему — подсветка слоя. */
  here: WindHere | null;
  bare?: boolean;
}

function Arrow({ fromDeg }: { fromDeg: number }) {
  return (
    <span
      aria-hidden
      className="inline-block w-4 text-center text-accent"
      style={{ transform: `rotate(calc(${downwindDeg(fromDeg)}deg - var(--camera-heading, 0deg)))` }}
    >
      ↑
    </span>
  );
}

export function WindColumn({ profile, flight, here, bare = false }: WindColumnProps) {
  const t = useT();
  const locale = useLocaleStore((state) => state.locale);
  if (profile.length === 0 && !flight) return null;
  const altitude = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });

  return (
    <section
      data-panel="wind"
      aria-label={t('wind.title')}
      className={bare ? 'text-xs' : 'rounded-xl glass p-3 text-xs compact:px-2.5 compact:py-1.5'}
    >
      <h3 className="mb-1 text-secondary">{t('wind.title')}</h3>
      <ul className="numeric flex flex-col gap-0.5">
        {layersTopDown(profile).map((band) => {
          const current = here?.band?.[0] === band.altitudeBand[0];
          return (
            <li
              key={band.altitudeBand[0]}
              aria-current={current ? 'true' : undefined}
              className="flex items-center gap-2 rounded px-1 text-secondary aria-[current=true]:bg-subtle aria-[current=true]:text-primary"
            >
              <span className="w-24">
                {fill(t('wind.band'), { low: altitude.format(band.altitudeBand[0]), high: altitude.format(band.altitudeBand[1]) })}
              </span>
              <Arrow fromDeg={band.windDirDeg} />
              <span className="w-6">{compassPoint(band.windDirDeg, t)}</span>
              <span>{groundSpeed(band.windSpeedMs, locale, t)}</span>
            </li>
          );
        })}
        {flight && (
          <li
            aria-current={here !== null && here.band === null ? 'true' : undefined}
            className="flex items-center gap-2 rounded px-1 text-secondary aria-[current=true]:bg-subtle aria-[current=true]:text-primary"
          >
            <span className="w-24">{t('wind.flight')}</span>
            <Arrow fromDeg={flight.dirDeg} />
            <span className="w-6">{compassPoint(flight.dirDeg, t)}</span>
            <span>{groundSpeed(flight.speedMs, locale, t)}</span>
          </li>
        )}
      </ul>
    </section>
  );
}
