import { LOCALES, type Locale } from '@skyline/core';
import { useCallback } from 'react';
import { create } from 'zustand';

import { messages, type MessageKey } from './messages';

const FALLBACK_LOCALE: Locale = 'en';

export function detectLocale(languages: readonly string[]): Locale {
  for (const tag of languages) {
    const match = LOCALES.find((locale) => tag.toLowerCase().startsWith(locale));
    if (match) return match;
  }
  return FALLBACK_LOCALE;
}

interface LocaleState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

export const useLocaleStore = create<LocaleState>()((set) => ({
  locale: detectLocale(typeof navigator === 'undefined' ? [] : navigator.languages),
  setLocale: (locale) => set({ locale }),
}));

export function useT(): (key: MessageKey) => string {
  const locale = useLocaleStore((state) => state.locale);
  return useCallback((key) => messages[locale][key], [locale]);
}

/** Подстановка {name} в перевод: числа и пороги не должны жить внутри строк i18n. */
export const fill = (template: string, values: Record<string, string>): string =>
  template.replace(/\{(\w+)\}/g, (whole: string, name: string) => values[name] ?? whole);
