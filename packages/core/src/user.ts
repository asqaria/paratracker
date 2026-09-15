import { z } from 'zod';

/** Языки интерфейса на старте (ТЗ §8.5). */
export const LOCALES = ['ru', 'en'] as const;
export const Locale = z.enum(LOCALES);
export type Locale = z.infer<typeof Locale>;

/**
 * Система единиц в профиле (ТЗ §8.5). Влияет только на форматирование в UI —
 * внутри системы всегда СИ.
 */
export const UNIT_SYSTEMS = ['metric', 'imperial'] as const;
export const UnitSystem = z.enum(UNIT_SYSTEMS);
export type UnitSystem = z.infer<typeof UnitSystem>;

/** Видимость полёта (ТЗ §9). */
export const PRIVACY_LEVELS = ['public', 'unlisted', 'private'] as const;
export const Privacy = z.enum(PRIVACY_LEVELS);
export type Privacy = z.infer<typeof Privacy>;

/** ТЗ §11.2: трек содержит дом пилота и распорядок, поэтому по умолчанию — unlisted. */
export const DEFAULT_PRIVACY = 'unlisted' satisfies Privacy;
