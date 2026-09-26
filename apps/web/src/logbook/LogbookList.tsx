import type { FlightStatus, LogbookEntry } from '@skyline/core';

import { COMPARE_MAX_FLIGHTS } from '../compare/compare-refs';
import { useLocaleStore, useT } from '../i18n/locale';
import type { MessageKey } from '../i18n/messages';
import { flightHash } from '../routing';
import { formatEntry } from './format-logbook';

interface LogbookListProps {
  items: LogbookEntry[];
  hasMore: boolean;
  loadingMore: boolean;
  onMore: () => void;
  /** Отмеченные для сравнения (задача 3.12). */
  selected: ReadonlySet<string>;
  onToggle: (flightId: string) => void;
}

/** Статус вместо цифр, пока полёт не готов; у готового — ничего. */
const STATUS_LABEL: Partial<Record<FlightStatus, MessageKey>> = {
  pending: 'upload.status.pending',
  parsing: 'upload.status.parsing',
  analyzing: 'upload.status.analyzing',
  failed: 'upload.status.failed',
};

/** Список полётов логбука (задача 2.11): строка — ссылка в 3D-просмотрщик. */
export function LogbookList({ items, hasMore, loadingMore, onMore, selected, onToggle }: LogbookListProps) {
  const t = useT();
  const locale = useLocaleStore((state) => state.locale);

  return (
    <div data-panel="logbook-list">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-secondary">
          <tr>
            <th className="w-8 py-2 font-normal">
              <span className="sr-only">{t('compare.select')}</span>
            </th>
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
                <td className="py-2 align-top">
                  {/* Сравнивать можно только готовые полёты: у остальных нет трека. */}
                  {entry.status === 'ready' && (
                    <input
                      type="checkbox"
                      aria-label={`${t('compare.select')}: ${row.date}`}
                      checked={selected.has(entry.id)}
                      disabled={!selected.has(entry.id) && selected.size >= COMPARE_MAX_FLIGHTS}
                      onChange={() => onToggle(entry.id)}
                      className="mt-1 h-4 w-4 accent-accent compact:h-6 compact:w-6"
                    />
                  )}
                </td>
                <td className="py-2">
                  <a href={flightHash(entry.id)} className="text-primary hover:text-accent">
                    {row.date}
                  </a>
                  {status && <span className="ml-2 text-xs text-secondary">{t(status)}</span>}
                  {(entry.takeoffSite ?? entry.glider) && (
                    <span className="block text-xs text-secondary">
                      {[entry.takeoffSite?.name, entry.glider?.label].filter(Boolean).join(' · ')}
                    </span>
                  )}
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
