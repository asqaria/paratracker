import { describe, expect, it, vi } from 'vitest';

import { createFlightQueue } from './queue.js';

const deferred = (): { promise: Promise<void>; resolve: () => void } => {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe('внутрипроцессная очередь', () => {
  it('не запускает больше concurrency задач одновременно', async () => {
    const gates = [deferred(), deferred(), deferred()];
    let running = 0;
    let peak = 0;
    const queue = createFlightQueue({
      concurrency: 2,
      process: async (flightId) => {
        running += 1;
        peak = Math.max(peak, running);
        await gates[Number(flightId)]?.promise;
        running -= 1;
      },
    });

    for (const id of ['0', '1', '2']) queue.enqueue(id);
    expect(queue.running).toBe(2);
    expect(queue.pending).toBe(1);

    for (const gate of gates) gate.resolve();
    await queue.idle();

    expect(peak).toBe(2);
    expect(queue.running).toBe(0);
  });

  it('повторная постановка того же полёта не создаёт дубль', async () => {
    const process = vi.fn<(flightId: string) => Promise<void>>(async () => {
      await Promise.resolve();
    });
    const queue = createFlightQueue({ concurrency: 1, process });

    queue.enqueue('a');
    queue.enqueue('a');
    queue.enqueue('b');
    await queue.idle();

    expect(process.mock.calls.map(([id]) => id)).toEqual(['a', 'b']);
  });

  it('уже обработанный полёт можно поставить снова', async () => {
    const process = vi.fn<(flightId: string) => Promise<void>>(async () => {
      await Promise.resolve();
    });
    const queue = createFlightQueue({ concurrency: 1, process });

    queue.enqueue('a');
    await queue.idle();
    queue.enqueue('a');
    await queue.idle();

    expect(process).toHaveBeenCalledTimes(2);
  });

  it('ошибка обработчика не останавливает очередь', async () => {
    const seen: string[] = [];
    const errors: string[] = [];
    const queue = createFlightQueue({
      concurrency: 1,
      process: async (flightId) => {
        seen.push(flightId);
        await Promise.resolve();
        if (flightId === 'boom') throw new Error('обработка упала');
      },
      onError: (error, flightId) => errors.push(`${flightId}: ${(error as Error).message}`),
    });

    queue.enqueue('boom');
    queue.enqueue('next');
    await queue.idle();

    expect(seen).toEqual(['boom', 'next']);
    expect(errors).toEqual(['boom: обработка упала']);
  });

  it('после close новые задачи не принимаются', async () => {
    const process = vi.fn<(flightId: string) => Promise<void>>(async () => {
      await Promise.resolve();
    });
    const queue = createFlightQueue({ concurrency: 1, process });

    queue.enqueue('a');
    await queue.close();
    queue.enqueue('b');

    expect(process.mock.calls.map(([id]) => id)).toEqual(['a']);
  });
});
