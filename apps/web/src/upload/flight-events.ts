import { FlightStatusResponse, UNFINISHED_FLIGHT_STATUSES, type FlightStatus } from '@skyline/core';

/**
 * Прогресс обработки полёта (ТЗ §5.2, §10). Сначала SSE /events, при обрыве —
 * опрос /status: страница не должна навсегда застыть на «обрабатываем», если
 * поток порвал прокси. Кривое событие игнорируется, а не роняет UI.
 */

export const flightEventsUrl = (flightId: string): string => `/api/v1/flights/${flightId}/events`;
export const flightStatusUrl = (flightId: string): string => `/api/v1/flights/${flightId}/status`;

/** Пауза между опросами, когда SSE недоступен. */
const DEFAULT_POLL_INTERVAL_MS = 1000;

/** Терминальные статусы — те, которых нет в списке незавершённых из core. */
export const isTerminalStatus = (status: FlightStatus): boolean =>
  !(UNFINISHED_FLIGHT_STATUSES as readonly FlightStatus[]).includes(status);

/** Событие конвейера или null, если пришёл мусор. */
export function parseFlightEvent(data: string): FlightStatusResponse | null {
  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {
    return null;
  }
  const parsed = FlightStatusResponse.safeParse(json);
  return parsed.success ? parsed.data : null;
}

export async function fetchFlightStatus(
  flightId: string,
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<FlightStatusResponse> {
  const response = await fetchImpl(flightStatusUrl(flightId), {
    signal,
    headers: { accept: 'application/json, application/problem+json' },
  });
  if (!response.ok) throw new Error(`Flight status failed: HTTP ${response.status}`);
  return FlightStatusResponse.parse(await response.json());
}

/** Минимум от EventSource, который нам нужен: остальное не используется. */
export interface FlightEventStream {
  onmessage: ((event: { data: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  close(): void;
}

export interface FlightStatusHandlers {
  onStatus: (status: FlightStatusResponse) => void;
  onError: (message: string) => void;
}

export interface SubscribeDeps {
  openStream?: (url: string) => FlightEventStream;
  fetchImpl?: typeof fetch;
  pollIntervalMs?: number;
}

/**
 * Подписка на статусы полёта до терминального. Возвращает функцию отписки,
 * она же вызывается сама, когда пришёл ready или failed.
 */
export function subscribeFlightStatus(
  flightId: string,
  handlers: FlightStatusHandlers,
  deps: SubscribeDeps = {},
): () => void {
  const openStream = deps.openStream ?? ((url: string) => new EventSource(url) as unknown as FlightEventStream);
  const fetchImpl = deps.fetchImpl ?? fetch;
  const pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

  let stopped = false;
  let stream: FlightEventStream | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const controller = new AbortController();

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    stream?.close();
    stream = null;
    if (timer !== null) clearTimeout(timer);
    controller.abort();
  };

  const handle = (status: FlightStatusResponse): void => {
    if (stopped) return;
    handlers.onStatus(status);
    if (isTerminalStatus(status.status)) stop();
  };

  const poll = (): void => {
    if (stopped) return;
    void fetchFlightStatus(flightId, controller.signal, fetchImpl).then(
      (status) => {
        handle(status);
        if (!stopped) timer = setTimeout(poll, pollIntervalMs);
      },
      (cause: unknown) => {
        if (stopped) return;
        handlers.onError(cause instanceof Error ? cause.message : String(cause));
        timer = setTimeout(poll, pollIntervalMs);
      },
    );
  };

  stream = openStream(flightEventsUrl(flightId));
  stream.onmessage = (event) => {
    const status = parseFlightEvent(event.data);
    if (status !== null) handle(status);
  };
  stream.onerror = () => {
    // Терминальный статус уже пришёл — это штатное закрытие потока сервером.
    if (stopped) return;
    stream?.close();
    stream = null;
    poll();
  };

  return stop;
}
