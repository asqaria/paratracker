import { strFromU8 } from 'fflate';

/** String.fromCharCode принимает ограниченное число аргументов — декодируем кусками. */
const DECODE_CHUNK_BYTES = 0x8000;
const BOM = '﻿';
const UTF8_BOM_AS_LATIN1 = 'ï»¿';

/** IGC — ASCII; байты вне ASCII читаем как latin1, чтобы позиции символов совпадали с байтами. */
export function decodeLatin1(bytes: Uint8Array): string {
  let text = '';
  for (let i = 0; i < bytes.length; i += DECODE_CHUNK_BYTES) {
    text += String.fromCharCode(...bytes.subarray(i, i + DECODE_CHUNK_BYTES));
  }
  return text;
}

/** GPX и KML — XML в UTF-8 по умолчанию. */
export function decodeUtf8(bytes: Uint8Array): string {
  return strFromU8(bytes);
}

export function stripBom(text: string): string {
  if (text.startsWith(BOM)) return text.slice(BOM.length);
  if (text.startsWith(UTF8_BOM_AS_LATIN1)) return text.slice(UTF8_BOM_AS_LATIN1.length);
  return text;
}

export function inputSize(input: string | Uint8Array): number {
  return typeof input === 'string' ? input.length : input.byteLength;
}

/** Десятичное число из текста; NaN — пусто, не число или бесконечность. */
export function parseDecimal(text: string | undefined): number {
  if (text === undefined || text.trim() === '') return Number.NaN;
  const value = Number(text);
  return Number.isFinite(value) ? value : Number.NaN;
}
