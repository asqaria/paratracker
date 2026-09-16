import { LOCALES } from '@skyline/core';

import { useLocaleStore, useT } from './locale';

/** Переключатель языка (ТЗ §8.5): один на все экраны, строки только через i18n. */
export function LocaleSwitch() {
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
