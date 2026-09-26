import type { FlightSummary } from '@skyline/core';

import { useLocaleStore, useT } from '../i18n/locale';
import type { MessageKey } from '../i18n/messages';
import { formatSummary, type FormattedSummary } from './format-summary';

/** Панель сводки полёта (ТЗ §7, задача 1.13): стекло в углу сцены. */

export interface SummaryPanelProps {
  summary: FlightSummary;
  /** Внутри шторки: без своей рамки, одной строкой в четыре колонки. */
  bare?: boolean;
}

const ITEMS: ReadonlyArray<{ key: keyof FormattedSummary; label: MessageKey }> = [
  { key: 'duration', label: 'viewer.summary.duration' },
  { key: 'maxAlt', label: 'viewer.summary.maxAlt' },
  { key: 'distance', label: 'viewer.summary.distance' },
  { key: 'maxGain', label: 'viewer.summary.maxGain' },
];

export function SummaryPanel({ summary, bare = false }: SummaryPanelProps) {
  const t = useT();
  const locale = useLocaleStore((state) => state.locale);
  const formatted = formatSummary(summary, locale, t);

  return (
    <section
      aria-label={t('viewer.summary')}
      data-panel={bare ? 'sheet-summary' : 'summary'}
      className={bare ? 'px-1 text-sm' : 'rounded-xl glass p-3 text-sm compact:px-2.5 compact:py-1.5'}
    >
      {/*
        Цифры — моноширинные с табличными цифрами (ТЗ §8.4).
        На телефоне — одной строкой в четыре колонки: сцене нужна высота.
      */}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 compact:grid-cols-4 compact:gap-x-3 compact:gap-y-0">
        {ITEMS.map((item) => (
          <div key={item.key} className="flex flex-col">
            <dt className="text-xs text-secondary compact:text-2xs">{t(item.label)}</dt>
            <dd className="numeric text-base compact:text-xs">{formatted[item.key]}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
