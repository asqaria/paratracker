import { PARSER, RETENTION, type FlightErrorCode, type FlightStatus, type Locale } from '@skyline/core';

import { fill } from '../i18n/locale';
import type { MessageKey } from '../i18n/messages';
import { UploadError, type UploadRejection } from './upload-track';

/**
 * Причина отказа → текст для пилота. Вынесено из компонента, чтобы
 * проверять тестом без DOM: сообщения важнее разметки.
 */

export type Translate = (key: MessageKey) => string;

/** Мегабайт как единица показа: внутри системы байты (CLAUDE.md, «Единицы»). */
export const MEGABYTE = 1_000_000;

const megabytes = (bytes: number): string => String(Math.round(bytes / MEGABYTE));

/** Подсказка под дропзоной: форматы и порог размера. */
export const hintMessage = (t: Translate): string =>
  fill(t('upload.hint'), { max: megabytes(PARSER.maxFileBytes) });

/** Категории Intl.PluralRules, для которых есть перевод; «zero» и «two» в ru и en не встречаются. */
const RETENTION_KEYS: Record<string, MessageKey> = {
  one: 'upload.retention.one',
  few: 'upload.retention.few',
  many: 'upload.retention.many',
  other: 'upload.retention.other',
};

/** ТЗ §11.2: пилот предупреждён, сколько живёт анонимная загрузка. Склонение — по правилам языка. */
export function retentionMessage(t: Translate, locale: Locale, days: number = RETENTION.anonymousDays): string {
  const key = RETENTION_KEYS[new Intl.PluralRules(locale).select(days)] ?? 'upload.retention.other';
  return fill(t(key), { days: String(days) });
}

export function rejectionMessage(t: Translate, rejection: UploadRejection): string {
  if (rejection.reason === 'empty') return t('upload.error.empty');
  if (rejection.reason === 'unsupported_format') return t('upload.error.unsupportedFormat');
  return fill(t('upload.error.tooLarge'), { max: megabytes(rejection.maxBytes) });
}

/** Ошибка загрузки: известная причина — конкретный текст, иначе общий. */
export function uploadErrorMessage(t: Translate, cause: unknown): string {
  if (cause instanceof UploadError && cause.rejection !== null) return rejectionMessage(t, cause.rejection);
  return t('upload.error.upload');
}

/**
 * Обработка не удалась. Код показываем рядом: он нужен в обращении в поддержку,
 * а переводить двадцать кодов парсера в Фазе 1 незачем.
 */
export function processingErrorMessage(t: Translate, code?: FlightErrorCode): string {
  return code === undefined ? t('upload.error.processing') : `${t('upload.error.processing')} (${code})`;
}

export const statusLabel = (t: Translate, status: FlightStatus): string => t(`upload.status.${status}`);
