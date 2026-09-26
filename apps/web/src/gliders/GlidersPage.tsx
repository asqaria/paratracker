import { GLIDER, GLIDER_CERTIFICATIONS, gliderLabel, type GliderCertification, type GliderDto } from '@skyline/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import { useMe } from '../auth/session';
import { UserMenu } from '../auth/UserMenu';
import { LocaleSwitch } from '../i18n/LocaleSwitch';
import { useLocaleStore, useT } from '../i18n/locale';
import { LOGBOOK_QUERY_KEY } from '../logbook/logbook-keys';
import { LOGBOOK_HASH } from '../routing';
import { createGlider, deleteGlider, fetchGliders, GLIDERS_QUERY_KEY, updateGlider } from './gliders-api';

/** «Мои крылья» (ТЗ §8.2 /settings, задача 2.13б): список, основное, добавить, удалить. */
export function GlidersPage() {
  const t = useT();
  const locale = useLocaleStore((state) => state.locale);
  const me = useMe();

  return (
    <main lang={locale} className="mx-auto min-h-dvh w-full max-w-2xl p-6 compact:p-3">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">
          <a href="#/">{t('app.name')}</a>
          <span className="ml-3 font-normal text-secondary">{t('gliders.title')}</span>
        </h1>
        <div className="flex items-center gap-3">
          <UserMenu />
          <LocaleSwitch />
        </div>
      </header>
      {me === null && <p className="text-secondary">{t('logbook.signInPrompt')}</p>}
      {me && <GlidersContent />}
    </main>
  );
}

function GlidersContent() {
  const t = useT();
  const client = useQueryClient();
  const gliders = useQuery({ queryKey: GLIDERS_QUERY_KEY, queryFn: () => fetchGliders() });
  const [error, setError] = useState(false);

  /** После правки крыльев меняются и строки логбука: у полётов подпись крыла. */
  const run = (action: Promise<unknown>): void => {
    setError(false);
    action.then(
      () => Promise.all([
        client.invalidateQueries({ queryKey: GLIDERS_QUERY_KEY }),
        client.invalidateQueries({ queryKey: LOGBOOK_QUERY_KEY }),
      ]),
      () => setError(true),
    );
  };

  const makeDefault = (glider: GliderDto) =>
    run(updateGlider(glider.id, { ...glider, isDefault: true }));

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-xl glass p-4 compact:p-2">
        {gliders.data?.length === 0 && <p className="text-sm text-secondary">{t('gliders.empty')}</p>}
        <ul data-panel="gliders-list" className="flex flex-col">
          {gliders.data?.map((glider) => (
            <li key={glider.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-subtle py-2 first:border-t-0">
              <span>
                <span className="text-primary">{gliderLabel(glider)}</span>
                <span className="ml-2 text-xs text-secondary">{glider.certification ?? t('gliders.noClass')}</span>
              </span>
              <span className="flex items-center gap-3 text-sm">
                {glider.isDefault ? (
                  <span className="text-accent">{t('gliders.default')}</span>
                ) : (
                  <button type="button" onClick={() => makeDefault(glider)} className="text-secondary hover:text-primary compact:min-h-11">
                    {t('gliders.makeDefault')}
                  </button>
                )}
                <button type="button" onClick={() => run(deleteGlider(glider.id))} className="text-secondary hover:text-danger compact:min-h-11">
                  {t('gliders.delete')}
                </button>
              </span>
            </li>
          ))}
        </ul>
      </section>
      <AddGliderForm onAdd={(input) => run(createGlider(input))} />
      {error && (
        <p role="alert" className="text-danger">
          {t('gliders.error')}
        </p>
      )}
      <a href={LOGBOOK_HASH} className="text-sm text-accent">
        {t('logbook.title')}
      </a>
    </div>
  );
}

interface AddGliderFormProps {
  onAdd: (input: {
    manufacturer: string;
    model: string;
    size: string | null;
    certification: GliderCertification | null;
    isDefault: boolean;
  }) => void;
}

function AddGliderForm({ onAdd }: AddGliderFormProps) {
  const t = useT();
  const [manufacturer, setManufacturer] = useState('');
  const [model, setModel] = useState('');
  const [size, setSize] = useState('');
  const [certification, setCertification] = useState<GliderCertification | ''>('');
  const [isDefault, setDefault] = useState(false);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    onAdd({
      manufacturer: manufacturer.trim(),
      model: model.trim(),
      size: size.trim() === '' ? null : size.trim(),
      certification: certification === '' ? null : certification,
      isDefault,
    });
    setManufacturer('');
    setModel('');
    setSize('');
    setCertification('');
    setDefault(false);
  };

  const field = 'min-w-0 rounded bg-subtle px-2 py-1 text-primary';
  return (
    <form data-panel="add-glider" onSubmit={submit} className="flex flex-wrap items-end gap-2 rounded-xl glass p-4 text-sm compact:p-2">
      <label className="flex flex-1 flex-col gap-1">
        <span className="text-xs text-secondary">{t('gliders.manufacturer')}</span>
        <input value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} required maxLength={GLIDER.nameMaxLength} className={field} />
      </label>
      <label className="flex flex-1 flex-col gap-1">
        <span className="text-xs text-secondary">{t('gliders.model')}</span>
        <input value={model} onChange={(e) => setModel(e.target.value)} required maxLength={GLIDER.nameMaxLength} className={field} />
      </label>
      <label className="flex w-20 flex-col gap-1">
        <span className="text-xs text-secondary">{t('gliders.size')}</span>
        <input value={size} onChange={(e) => setSize(e.target.value)} maxLength={GLIDER.sizeMaxLength} className={field} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-secondary">{t('gliders.certification')}</span>
        <select value={certification} onChange={(e) => setCertification(e.target.value as GliderCertification | '')} className={field}>
          <option value="">—</option>
          {GLIDER_CERTIFICATIONS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 py-1 compact:min-h-11">
        <input type="checkbox" checked={isDefault} onChange={(e) => setDefault(e.target.checked)} />
        <span>{t('gliders.default')}</span>
      </label>
      <button type="submit" className="rounded bg-accent px-3 py-1 text-void">
        {t('gliders.add')}
      </button>
    </form>
  );
}
