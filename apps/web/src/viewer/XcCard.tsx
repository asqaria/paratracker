import type { XcScoreDto } from '@skyline/core';

import { useLocaleStore, useT } from '../i18n/locale';
import { kilometres } from './units';

interface XcCardProps {
  xc: XcScoreDto;
  /** Маршрут на сцене; без обработчика переключателя нет. */
  routeShown?: boolean;
  onRouteShown?: (shown: boolean) => void;
  /** Облететь весь маршрут камерой. */
  onShowRoute?: () => void;
}

/**
 * Карточка XC-очков (ТЗ §6.6, задача 3.3): вид маршрута, дистанция, очки,
 * регламент. Не точный максимум (бюджет перебора кончился) — пометка
 * «оценка»: приблизительные очки полезнее пустоты (§6.6).
 */
export function XcCard({ xc, routeShown = true, onRouteShown, onShowRoute }: XcCardProps) {
  const t = useT();
  const locale = useLocaleStore((state) => state.locale);
  const score = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(xc.score);

  return (
    <div data-panel="xc-card" className="mb-2 rounded bg-subtle/60 px-2 py-1.5">
      <p className="flex items-baseline justify-between gap-2 text-xs text-secondary">
        <span>{`XC · ${xc.rules}`}</span>
        {!xc.optimal && <span className="text-primary">{t('xc.estimate')}</span>}
      </p>
      <p className="flex items-baseline justify-between gap-2">
        <span>{t(`xc.type.${xc.type}`)}</span>
        <span className="numeric text-primary">{kilometres(xc.distanceM, locale, t)}</span>
      </p>
      <p className="numeric text-lg font-semibold text-primary">
        {score} <span className="text-xs font-normal text-secondary">{t('xc.points')}</span>
      </p>
      <div className="mt-1 flex items-center justify-between gap-2">
      {onRouteShown && (
        <button
          type="button"
          aria-pressed={routeShown}
          onClick={() => onRouteShown(!routeShown)}
          className="flex items-center gap-2 text-xs text-secondary aria-pressed:text-primary compact:min-h-11"
        >
          <span aria-hidden="true" className="grid size-3.5 place-items-center rounded-sm border border-subtle">
            {routeShown ? '✓' : ''}
          </span>
          {t('xc.route')}
        </button>
      )}
      {onShowRoute && (
        <button type="button" onClick={onShowRoute} className="text-xs text-accent compact:min-h-11">
          {t('xc.showRoute')}
        </button>
      )}
      </div>
    </div>
  );
}
