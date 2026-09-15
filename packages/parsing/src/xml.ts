/**
 * Минимальный XML-сканер для GPX и KML. Не валидирует и не бросает:
 * оборванный документ (прибор выключился при записи) отдаёт всё до обрыва.
 * DTD и внешние сущности не раскрываются — XXE и «billion laughs» невозможны.
 */

export interface XmlHandler {
  /** Нужен ли сейчас текст: сканер не режет строки впустую. */
  readonly collectingText: boolean;
  /** Имя — локальное, без префикса пространства имён. offset — позиция `<` в тексте. */
  open(name: string, attributes: string, offset: number): void;
  close(name: string): void;
  text(value: string): void;
}

const TOKEN =
  /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE(?:[^[>]|\[[\s\S]*?\])*>|<![^>]*>|<(\/?)([A-Za-z_][\w.:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;
const ATTRIBUTE = /([^\s=/]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const ENTITY = /&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g;
const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const MAX_CODE_POINT = 0x10ffff;
const HEX_RADIX = 16;
const DECIMAL_RADIX = 10;

const localName = (name: string): string => name.slice(name.indexOf(':') + 1);

export function decodeXmlEntities(raw: string): string {
  if (!raw.includes('&')) return raw;
  return raw.replace(ENTITY, (whole, body: string) => {
    if (body.startsWith('#')) {
      const hex = body[1] === 'x';
      const code = parseInt(body.slice(hex ? 2 : 1), hex ? HEX_RADIX : DECIMAL_RADIX);
      return code <= MAX_CODE_POINT ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body] ?? whole;
  });
}

export function readAttributes(raw: string): Map<string, string> {
  const attributes = new Map<string, string>();
  for (const [, name, doubleQuoted, singleQuoted] of raw.matchAll(ATTRIBUTE)) {
    if (name !== undefined) attributes.set(localName(name), decodeXmlEntities(doubleQuoted ?? singleQuoted ?? ''));
  }
  return attributes;
}

export function scanXml(text: string, handler: XmlHandler): void {
  const token = new RegExp(TOKEN.source, TOKEN.flags);
  let position = 0;

  for (let match = token.exec(text); match !== null; match = token.exec(text)) {
    if (match.index > position && handler.collectingText) {
      handler.text(decodeXmlEntities(text.slice(position, match.index)));
    }
    position = token.lastIndex;

    const [, cdata, slash, name, attributes = ''] = match;
    if (cdata !== undefined) {
      if (handler.collectingText) handler.text(cdata);
      continue;
    }
    if (name === undefined) continue; // комментарий, инструкция, DOCTYPE

    const local = localName(name);
    if (slash) {
      handler.close(local);
      continue;
    }
    const selfClosing = attributes.endsWith('/');
    handler.open(local, selfClosing ? attributes.slice(0, -1) : attributes, match.index);
    if (selfClosing) handler.close(local);
  }

  if (position < text.length && handler.collectingText) {
    handler.text(decodeXmlEntities(text.slice(position)));
  }
}

/** Номер строки (1-based) по позиции в тексте; переводы строк считаются один раз, при первом вызове. */
export function lineLocator(text: string): (offset: number) => number {
  let breaks: number[] | null = null;

  return (offset) => {
    if (breaks === null) {
      breaks = [];
      for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (char === '\n' || (char === '\r' && text[i + 1] !== '\n')) breaks.push(i);
      }
    }
    let low = 0;
    let high = breaks.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if ((breaks[mid] ?? Infinity) < offset) low = mid + 1;
      else high = mid;
    }
    return low + 1;
  };
}
