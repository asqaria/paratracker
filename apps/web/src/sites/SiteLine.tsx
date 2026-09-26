import { SITE, type SiteSummary } from '@skyline/core';
import { useState } from 'react';

import { useT } from '../i18n/locale';
import { PGE_URL } from './create-site';

interface SiteLineProps {
  site: SiteSummary | null;
  /** Владелец полёта: может добавить место, если его нет. */
  canEdit: boolean;
  onCreate: (name: string) => Promise<void>;
}

/**
 * Место старта полёта (задача 2.13). Место из paragliding.earth — со ссылкой
 * на источник (CC BY-SA), от пилота — с пометкой. Места нет, а полёт свой —
 * форма «добавить»: точка берётся из взлёта, пилот вводит только название.
 */
export function SiteLine({ site, canEdit, onCreate }: SiteLineProps) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [state, setState] = useState<'idle' | 'saving' | 'error'>('idle');

  if (site) {
    return (
      <p data-panel="takeoff-site" className="text-sm">
        <span className="text-secondary">{t('site.takeoff')}: </span>
        <span className="text-primary">{site.name}</span>
        <span className="ml-2 text-xs text-secondary">
          {site.source === 'seed' ? (
            <a href={PGE_URL} target="_blank" rel="noreferrer" className="hover:text-accent">
              paragliding.earth
            </a>
          ) : (
            t('site.byPilot')
          )}
        </span>
      </p>
    );
  }

  if (!canEdit) return null;

  if (!editing) {
    return (
      <p data-panel="takeoff-site" className="text-sm text-secondary">
        {t('site.unknown')}{' '}
        <button type="button" onClick={() => setEditing(true)} className="text-accent compact:min-h-11">
          {t('site.add')}
        </button>
      </p>
    );
  }

  return (
    <form
      data-panel="takeoff-site"
      className="flex flex-wrap items-center gap-2 text-sm"
      onSubmit={(event) => {
        event.preventDefault();
        setState('saving');
        onCreate(name.trim()).then(
          () => setState('idle'),
          () => setState('error'),
        );
      }}
    >
      <input
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder={t('site.namePlaceholder')}
        aria-label={t('site.namePlaceholder')}
        minLength={SITE.nameMinLength}
        maxLength={SITE.nameMaxLength}
        required
        autoFocus
        className="min-w-0 flex-1 rounded bg-subtle px-2 py-1 text-primary"
      />
      <button type="submit" disabled={state === 'saving'} className="rounded bg-accent px-3 py-1 text-void disabled:opacity-50">
        {t('site.save')}
      </button>
      <button type="button" onClick={() => setEditing(false)} className="px-2 py-1 text-secondary">
        {t('site.cancel')}
      </button>
      {state === 'error' && (
        <p role="alert" className="w-full text-danger">
          {t('site.error')}
        </p>
      )}
    </form>
  );
}
