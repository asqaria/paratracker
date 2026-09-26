/**
 * Состав сравнения треков (задача 3.12) — в адресе страницы, без сохранения
 * в базе: #/compare?f=a,b,c. Элемент — id полёта (свой или публичный) или
 * токен ссылки «по ссылке» (чужой полёт, которым поделились). Ссылку на
 * сравнение можно отправить в чат клуба: получатель увидит те же полёты,
 * и не больше, чем открыли их владельцы.
 */

/** ТЗ §3.12: до 8 треков — больше на сцене и в списке уже не различить. */
export const COMPARE_MAX_FLIGHTS = 8;

export type FlightRef = { kind: 'id'; flightId: string } | { kind: 'share'; token: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Токен ссылки (задача 3.7): base64url; длина — как в маршрутах /s/ и /embed/. */
const TOKEN = /^[\w-]{8,64}$/;

/** Ключ элемента: по нему — дубли, цвета и React-ключи. */
export const refKey = (ref: FlightRef): string => (ref.kind === 'id' ? ref.flightId.toLowerCase() : `s:${ref.token}`);

const refOfItem = (item: string): FlightRef | null => {
  if (UUID.test(item)) return { kind: 'id', flightId: item.toLowerCase() };
  return TOKEN.test(item) ? { kind: 'share', token: item } : null;
};

/** Без дублей и не больше COMPARE_MAX_FLIGHTS: лишнее из адреса отбрасывается. */
export function normalizeRefs(refs: readonly FlightRef[]): FlightRef[] {
  const seen = new Set<string>();
  const out: FlightRef[] = [];
  for (const ref of refs) {
    const key = refKey(ref);
    if (seen.has(key) || out.length >= COMPARE_MAX_FLIGHTS) continue;
    seen.add(key);
    out.push(ref);
  }
  return out;
}

/** Параметр f из #/compare?f=…; мусор пропускается. */
export function refsFromQuery(query: string): FlightRef[] {
  const list = new URLSearchParams(query).get('f') ?? '';
  return normalizeRefs(
    list
      .split(',')
      .map((item) => refOfItem(item.trim()))
      .filter((ref): ref is FlightRef => ref !== null),
  );
}

export function compareHash(refs: readonly FlightRef[]): string {
  const items = normalizeRefs(refs).map((ref) => (ref.kind === 'id' ? ref.flightId : ref.token));
  return items.length === 0 ? '#/compare' : `#/compare?f=${items.join(',')}`;
}

/**
 * Полёт из вставленной ссылки: «поделиться» (/s/…), встраивание (/embed/…),
 * страница полёта (#/flight/…) или просто id. null — не похоже на полёт Skyline.
 */
export function refFromLink(text: string): FlightRef | null {
  const trimmed = text.trim();
  const direct = refOfItem(trimmed);
  if (direct?.kind === 'id') return direct;
  const shared = /(?:^|\/|#\/)(?:s|embed)\/([\w-]{8,64})\/?(?:[?#].*)?$/.exec(trimmed)?.[1];
  if (shared !== undefined) return { kind: 'share', token: shared };
  const flight = /#\/flight\/([0-9a-f-]{36})(?:\/review)?$/i.exec(trimmed)?.[1];
  if (flight !== undefined && UUID.test(flight)) return { kind: 'id', flightId: flight.toLowerCase() };
  return null;
}
