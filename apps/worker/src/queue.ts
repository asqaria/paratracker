/**
 * Внутрипроцессная очередь обработки (ТЗ §4.2): BullMQ на первом этапе избыточен.
 * Устойчивость к перезапуску даёт не очередь, а статус в БД и восстановительный
 * проход при старте.
 */

export interface FlightQueueOptions {
  concurrency: number;
  process: (flightId: string) => Promise<void>;
  onError?: (error: unknown, flightId: string) => void;
}

export interface FlightQueue {
  /** Ставит полёт в очередь; уже стоящий или обрабатываемый игнорируется. */
  enqueue(flightId: string): void;
  readonly pending: number;
  readonly running: number;
  /** Ждёт, пока очередь опустеет. */
  idle(): Promise<void>;
  /** Перестаёт принимать задания и ждёт текущие. */
  close(): Promise<void>;
}

export function createFlightQueue(options: FlightQueueOptions): FlightQueue {
  const queued: string[] = [];
  const active = new Set<string>();
  const idleWaiters: (() => void)[] = [];
  let closed = false;

  const settleIdle = (): void => {
    if (queued.length > 0 || active.size > 0) return;
    for (const waiter of idleWaiters.splice(0, idleWaiters.length)) waiter();
  };

  const pump = (): void => {
    while (active.size < options.concurrency) {
      const flightId = queued.shift();
      if (flightId === undefined) break;
      active.add(flightId);
      void options
        .process(flightId)
        .catch((error: unknown) => options.onError?.(error, flightId))
        .finally(() => {
          active.delete(flightId);
          pump();
          settleIdle();
        });
    }
    settleIdle();
  };

  return {
    enqueue: (flightId) => {
      if (closed || active.has(flightId) || queued.includes(flightId)) return;
      queued.push(flightId);
      pump();
    },
    get pending() {
      return queued.length;
    },
    get running() {
      return active.size;
    },
    idle: () =>
      new Promise<void>((resolve) => {
        if (queued.length === 0 && active.size === 0) resolve();
        else idleWaiters.push(resolve);
      }),
    close: async () => {
      closed = true;
      await new Promise<void>((resolve) => {
        if (queued.length === 0 && active.size === 0) resolve();
        else idleWaiters.push(resolve);
      });
    },
  };
}
