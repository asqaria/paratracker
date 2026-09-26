import { CLAIM, RETENTION, TIME } from '@skyline/core';

/**
 * Токены анонимных загрузок (задача 2.11). Бросил трек без входа — сервер
 * выдал токен; вошёл — браузер предъявляет токены и полёты переходят в логбук.
 *
 * localStorage, а не cookie: токен нужен только этому браузеру и только
 * в одном запросе после входа. Хранилище бывает недоступно (приватный режим,
 * запрет сайта) — тогда перенос просто не случится, страница не падает.
 */

export interface ClaimStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface Options {
  storage?: ClaimStorage | undefined;
  now?: number;
}

const STORAGE_KEY = 'skyline.claims';
/** Дольше сервер анонимный полёт не хранит — токен бесполезен. */
const MAX_AGE_MS = RETENTION.anonymousDays * TIME.secondsPerDay * TIME.msPerSecond;

interface StoredClaim {
  flightId: string;
  token: string;
  savedAt: number;
}
type Stored = StoredClaim[];

const isStoredClaim = (value: unknown): value is StoredClaim =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as StoredClaim).flightId === 'string' &&
  typeof (value as StoredClaim).token === 'string' &&
  typeof (value as StoredClaim).savedAt === 'number';

const defaultStorage = (): ClaimStorage | undefined => {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
};

function read(options: Options): Stored {
  const now = options.now ?? Date.now();
  try {
    const raw = (options.storage ?? defaultStorage())?.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isStoredClaim).filter((c) => now - c.savedAt <= MAX_AGE_MS);
  } catch {
    return [];
  }
}

function write(claims: Stored, options: Options): void {
  try {
    (options.storage ?? defaultStorage())?.setItem(STORAGE_KEY, JSON.stringify(claims));
  } catch {
    // Хранилище недоступно — перенос не случится, это не повод ронять загрузку.
  }
}

export function rememberClaim(flightId: string, token: string, options: Options = {}): void {
  const now = options.now ?? Date.now();
  const others = read(options).filter((c) => c.flightId !== flightId);
  write([...others, { flightId, token, savedAt: now }].slice(-CLAIM.maxFlights), options);
}

export function pendingClaims(options: Options = {}): { flightId: string; token: string }[] {
  return read(options).map(({ flightId, token }) => ({ flightId, token }));
}

export function hasClaim(flightId: string, options: Options = {}): boolean {
  return read(options).some((c) => c.flightId === flightId);
}

export function forgetClaims(flightIds: readonly string[], options: Options = {}): void {
  const drop = new Set(flightIds);
  write(
    read(options).filter((c) => !drop.has(c.flightId)),
    options,
  );
}
