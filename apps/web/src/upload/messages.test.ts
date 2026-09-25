import { FLIGHT_STATUSES, PARSER, RETENTION } from '@skyline/core';
import { describe, expect, it } from 'vitest';

import { messages } from '../i18n/messages';
import {
  hintMessage,
  processingErrorMessage,
  rejectionMessage,
  retentionMessage,
  statusLabel,
  uploadErrorMessage,
  type Translate,
} from './messages';
import { UploadError } from './upload-track';

const ru: Translate = (key) => messages.ru[key];
const en: Translate = (key) => messages.en[key];

describe('hintMessage', () => {
  it('подставляет порог размера из constants, а не из перевода', () => {
    expect(hintMessage(ru)).toBe('IGC, GPX, KML или KMZ, до 50 МБ');
    expect(hintMessage(en)).toBe('IGC, GPX, KML or KMZ, up to 50 MB');
    // Порог берётся из ТЗ §3.3 через core: перевод про число не знает.
    expect(messages.ru['upload.hint']).toContain('{max}');
    expect(PARSER.maxFileBytes).toBe(50_000_000);
  });
});

describe('retentionMessage', () => {
  it('срок хранения анонимной загрузки — из constants (ТЗ §11.2)', () => {
    expect(RETENTION.anonymousDays).toBe(30);
    expect(retentionMessage(ru, 'ru')).toBe('Без регистрации полёт хранится 30 дней');
    expect(retentionMessage(en, 'en')).toBe('Without an account, the flight is kept for 30 days');
  });

  it.each([
    [1, 'ru', 'Без регистрации полёт хранится 1 день'],
    [21, 'ru', 'Без регистрации полёт хранится 21 день'],
    [3, 'ru', 'Без регистрации полёт хранится 3 дня'],
    [14, 'ru', 'Без регистрации полёт хранится 14 дней'],
    [1, 'en', 'Without an account, the flight is kept for 1 day'],
  ] as const)('%i дн., %s — склонение по правилам языка', (days, locale, expected) => {
    expect(retentionMessage(locale === 'ru' ? ru : en, locale, days)).toBe(expected);
  });
});

describe('rejectionMessage', () => {
  it('пустой файл и чужой формат', () => {
    expect(rejectionMessage(ru, { reason: 'empty' })).toBe('Файл пустой');
    expect(rejectionMessage(en, { reason: 'unsupported_format' })).toContain('IGC');
  });

  it('превышение размера называет порог в мегабайтах', () => {
    expect(rejectionMessage(ru, { reason: 'too_large', maxBytes: PARSER.maxFileBytes })).toBe('Файл больше 50 МБ');
    expect(rejectionMessage(en, { reason: 'too_large', maxBytes: PARSER.maxFileBytes })).toBe(
      'The file is larger than 50 MB',
    );
  });
});

describe('uploadErrorMessage', () => {
  it('известную причину показывает точно', () => {
    const error = new UploadError('Payload Too Large', 413, { reason: 'too_large', maxBytes: PARSER.maxFileBytes });
    expect(uploadErrorMessage(ru, error)).toBe('Файл больше 50 МБ');
  });

  it('прочее — общий текст, без сырых деталей сервера', () => {
    // Пилоту незачем видеть «HTTP 500» или стек.
    expect(uploadErrorMessage(ru, new UploadError('Storage unavailable', 500, null))).toBe(
      'Не удалось загрузить файл',
    );
    expect(uploadErrorMessage(ru, new Error('network'))).toBe('Не удалось загрузить файл');
    expect(uploadErrorMessage(en, 'что угодно')).toBe('Could not upload the file');
  });
});

describe('processingErrorMessage', () => {
  it('без кода — только текст', () => {
    expect(processingErrorMessage(ru)).toBe('Трек не удалось обработать');
  });

  it('с кодом — код рядом, для обращения в поддержку', () => {
    expect(processingErrorMessage(ru, 'timeout')).toBe('Трек не удалось обработать (timeout)');
  });
});

describe('statusLabel', () => {
  it('у каждого статуса конвейера есть перевод', () => {
    for (const status of FLIGHT_STATUSES) {
      expect(statusLabel(ru, status), status).not.toBe('');
      expect(statusLabel(en, status), status).not.toBe('');
    }
  });
});
