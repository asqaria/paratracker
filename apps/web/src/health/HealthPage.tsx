import { LOCALES } from '@skyline/core';
import { useQuery } from '@tanstack/react-query';

import { useLocaleStore, useT } from '../i18n/locale';
import { fetchHealth, type HealthState } from './fetch-health';

type Summary = 'loading' | 'unreachable' | HealthState['kind'];

function CheckRow({ label, up, detail }: { label: string; up: boolean; detail?: string | undefined }) {
  const t = useT();
  return (
    <li className="flex items-center justify-between gap-4 py-3">
      <span className="text-secondary">{label}</span>
      <span className="flex items-center gap-2">
        {detail && <span className="font-numeric tabular-nums text-secondary">{detail}</span>}
        <span className={up ? 'text-accent' : 'text-danger'}>{t(up ? 'health.up' : 'health.down')}</span>
      </span>
    </li>
  );
}

function LocaleSwitch() {
  const t = useT();
  const { locale, setLocale } = useLocaleStore();
  return (
    <div role="group" aria-label={t('locale.label')} className="flex gap-1 text-sm">
      {LOCALES.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={option === locale}
          onClick={() => setLocale(option)}
          className="rounded px-2 py-1 text-secondary aria-pressed:bg-subtle aria-pressed:text-primary"
        >
          {t(`locale.${option}`)}
        </button>
      ))}
    </div>
  );
}

export function HealthPage() {
  const t = useT();
  const locale = useLocaleStore((state) => state.locale);
  const health = useQuery({ queryKey: ['health'], queryFn: ({ signal }) => fetchHealth(signal) });

  const summary: Summary = health.isPending ? 'loading' : health.isError ? 'unreachable' : health.data.kind;
  const checks = health.data?.checks;

  return (
    <main lang={locale} className="grid min-h-dvh place-items-center p-6">
      <section className="w-full max-w-md rounded-2xl border border-subtle bg-glass p-6 backdrop-blur-xl">
        <header className="mb-6 flex items-center justify-between">
          <h1 className="text-lg font-semibold">{t('app.name')}</h1>
          <LocaleSwitch />
        </header>

        <h2 className="text-sm text-secondary">{t('health.title')}</h2>
        <p role="status" className={`mt-1 text-2xl ${summary === 'ok' ? 'text-primary' : summary === 'loading' ? 'text-secondary' : 'text-danger'}`}>
          {t(`health.${summary}`)}
        </p>

        {checks && (
          <ul className="mt-6 divide-y divide-subtle">
            <CheckRow
              label={t('health.database')}
              up={checks.database.status === 'up'}
              detail={checks.database.status === 'up' ? `${t('health.postgis')} ${checks.database.postgisVersion}` : undefined}
            />
            <CheckRow label={t('health.storage')} up={checks.storage.status === 'up'} />
          </ul>
        )}
      </section>
    </main>
  );
}
