import type { FlightStatus, LogbookEntry } from '@skyline/core';

import { useLocaleStore, useT } from '../i18n/locale';
import type { MessageKey } from '../i18n/messages';
import { flightHash } from '../routing';
import { formatEntry } from './format-logbook';

interface LogbookListProps {
  items: LogbookEntry[];
  hasMore: boolean;
  loadingMore: boolean;
  onMore: () => void;
}

/** Статус вместо цифр, пока полёт не готов; у готового — ничего. */
const STATUS_LABEL: Partial<Record<FlightStatus, MessageKey>> = {
  pending: 'upload.status.pending',
  parsing: 'upload.status.parsing',
  analyzing: 'upload.status.analyzing',
  failed: 'upload.status.failed',
};

/** Список полётов логбука (задача 2.11): строка — ссылка в 3D-просмотрщик. */
export function LogbookList({ items, hasMore, loadingMore, onMore }: LogbookListProps) {
  const t = useT();
  const locale = useLocaleStore((state) => state.locale);

  return (
    <div data-panel="logbook-list">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-secondary">
          <tr>
            <th className="py-2 font-normal">{t('logbook.column.date')}</th>
            <th className="py-2 text-right font-normal">{t('logbook.column.duration')}</th>
            <th className="py-2 text-right font-normal">{t('logbook.column.distance')}</th>
            <th className="py-2 text-right font-normal compact:hidden">{t('logbook.column.maxAlt')}</th>
            <th className="py-2 text-right font-normal compact:hidden">{t('logbook.column.thermals')}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((entry) => {
            const row = formatEntry(entry, locale, t);
            const status = STATUS_LABEL[entry.status];
            // Готовый полёт открывается в 3D; остальные — тоже: просмотрщик сам покажет статус.
            return (
              <tr key={entry.id} className="border-t border-subtle">
                <td className="py-2">
                  <a href={flightHash(entry.id)} className="text-primary hover:text-accent">
                    {row.date}
                  </a>
                  {status && <span className="ml-2 text-xs text-secondary">{t(status)}</span>}
                </td>
                <td className="numeric py-2 text-right">{row.duration}</td>
                <td className="numeric py-2 text-right">{row.distance}</td>
                <td className="numeric py-2 text-right compact:hidden">{row.maxAlt}</td>
                <td className="numeric py-2 text-right compact:hidden">{row.thermals}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {hasMore && (
        <button
          type="button"
          onClick={onMore}
          disabled={loadingMore}
          className="mt-3 w-full rounded bg-subtle py-2 text-sm disabled:opacity-50"
        >
          {t('logbook.more')}
        </button>
      )}
    </div>
  );
}
