import { existsSync } from 'node:fs';
import { Worker } from 'node:worker_threads';

import type { AltitudeSource, AnalysisLevel, FlightErrorCode, SourceFormat } from '@skyline/core';

import type { PipelineMessage, PipelineTaskMessage } from './pipeline.worker.js';

/**
 * Пул worker_threads: CPU-тяжёлые шаги конвейера исполняются здесь, а основной
 * поток остаётся свободным для очереди и статусов (ТЗ §5.2 — главный риск стека).
 */

export interface PipelineTask {
  sourceFormat: SourceFormat;
  bytes: Uint8Array;
  now: number;
}

export type PipelineResult =
  | {
      ok: true;
      track: ArrayBuffer;
      pointCount: number;
      analysisLevel: AnalysisLevel;
      altitudeSource: AltitudeSource;
      startedAt: number;
      endedAt: number;
      durationS: number;
      warningCount: number;
    }
  | { ok: false; errorCode: FlightErrorCode };

export type ProgressListener = (value: number) => void;

export interface PipelinePool {
  run(task: PipelineTask, onProgress?: ProgressListener): Promise<PipelineResult>;
  close(): Promise<void>;
}

export interface PipelinePoolOptions {
  size: number;
  timeoutS: number;
  memoryLimitMb: number;
}

interface Job {
  task: PipelineTask;
  onProgress?: ProgressListener;
  settle: (result: PipelineResult) => void;
}

const MS_PER_SECOND = 1000;

/** В сборке рядом лежит .js, в тестах — исходный .ts (Node 22 снимает типы сам). */
function resolveWorkerScript(): URL {
  for (const name of ['pipeline.worker.js', 'pipeline.worker.ts']) {
    const url = new URL(name, import.meta.url);
    if (existsSync(url)) return url;
  }
  throw new Error('pipeline worker script not found next to pool module');
}

export function createPipelinePool(options: PipelinePoolOptions): PipelinePool {
  const script = resolveWorkerScript();
  const waiting: Job[] = [];
  /** Свободные потоки; занятый в этом списке не лежит. */
  const idle: PooledWorker[] = [];
  let created = 0;
  let closed = false;

  /** Поток и обещание его готовности: таймаут задачи не должен включать загрузку. */
  interface PooledWorker {
    worker: Worker;
    ready: Promise<void>;
  }

  const spawn = (): PooledWorker => {
    created += 1;
    const worker = new Worker(script, {
      resourceLimits: { maxOldGenerationSizeMb: options.memoryLimitMb },
    });
    const ready = new Promise<void>((resolve, reject) => {
      const onMessage = (message: PipelineMessage): void => {
        if (message.type !== 'ready') return;
        worker.off('message', onMessage);
        worker.off('error', reject);
        resolve();
      };
      worker.on('message', onMessage);
      worker.once('error', reject);
    });
    return { worker, ready };
  };

  const takeWorker = (): PooledWorker | null => {
    const free = idle.pop();
    if (free) return free;
    return created < options.size ? spawn() : null;
  };

  const release = (pooled: PooledWorker): void => {
    if (closed) {
      void pooled.worker.terminate();
      created -= 1;
      return;
    }
    idle.push(pooled);
    const next = waiting.shift();
    if (next) void dispatch(next);
  };

  const discard = (pooled: PooledWorker): void => {
    created -= 1;
    void pooled.worker.terminate();
    const next = waiting.shift();
    if (next) void dispatch(next);
  };

  const dispatch = async (job: Job): Promise<void> => {
    const free = takeWorker();
    if (!free) {
      waiting.push(job);
      return;
    }
    const pooled: PooledWorker = free;
    const worker: Worker = pooled.worker;

    try {
      await pooled.ready;
    } catch {
      job.settle({ ok: false, errorCode: 'internal_error' });
      discard(pooled);
      return;
    }

    await new Promise<void>((done) => {
      let finished = false;
      const timer = setTimeout(() => {
        finish({ ok: false, errorCode: 'timeout' }, true);
      }, options.timeoutS * MS_PER_SECOND);

      function finish(result: PipelineResult, broken: boolean): void {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        worker.off('message', onMessage);
        worker.off('error', onError);
        worker.off('exit', onExit);
        job.settle(result);
        if (broken) discard(pooled);
        else release(pooled);
        done();
      }

      function onMessage(message: PipelineMessage): void {
        if (message.type === 'ready') return;
        if (message.type === 'progress') {
          job.onProgress?.(message.value);
          return;
        }
        finish(message.result, false);
      }
      function onError(): void {
        finish({ ok: false, errorCode: 'internal_error' }, true);
      }
      function onExit(): void {
        // Поток умер сам: чаще всего лимит памяти.
        finish({ ok: false, errorCode: 'internal_error' }, true);
      }

      worker.on('message', onMessage);
      worker.on('error', onError);
      worker.on('exit', onExit);
      worker.postMessage({
        sourceFormat: job.task.sourceFormat,
        bytes: job.task.bytes,
        now: job.task.now,
      } satisfies PipelineTaskMessage);
    });
  };

  return {
    run: (task, onProgress) =>
      new Promise<PipelineResult>((resolve) => {
        if (closed) {
          resolve({ ok: false, errorCode: 'internal_error' });
          return;
        }
        const job: Job = onProgress ? { task, onProgress, settle: resolve } : { task, settle: resolve };
        void dispatch(job);
      }),
    close: async () => {
      closed = true;
      const workers = idle.splice(0, idle.length);
      created -= workers.length;
      await Promise.all(workers.map((pooled) => pooled.worker.terminate()));
    },
  };
}
