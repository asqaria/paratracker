import { z } from 'zod';

import { SITE } from './constants.js';

/** Места старта и посадки (ТЗ §6.8, §9, задача 2.13). */

export const SITE_TYPES = ['takeoff', 'landing', 'both'] as const;
export const SiteType = z.enum(SITE_TYPES);
export type SiteType = z.infer<typeof SiteType>;

/** seed — из открытой базы (paragliding.earth, CC BY-SA); user — добавил пилот. */
export const SITE_SOURCES = ['seed', 'user'] as const;
export const SiteSource = z.enum(SITE_SOURCES);
export type SiteSource = z.infer<typeof SiteSource>;

/** Кириллица → латиница: русский и казахский алфавиты. Для адресов /sites/:slug. */
const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  ә: 'a', ғ: 'g', қ: 'k', ң: 'n', ө: 'o', ұ: 'u', ү: 'u', һ: 'h', і: 'i',
};

/** Адресная часть имени места: латиница, цифры, дефисы. Уникальность — забота БД. */
export function siteSlug(name: string): string {
  const latin = [...name.toLowerCase()].map((ch) => TRANSLIT[ch] ?? ch).join('');
  const slug = latin
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SITE.slugMaxLength)
    .replace(/-+$/, '');
  return slug === '' ? SITE.fallbackSlug : slug;
}
