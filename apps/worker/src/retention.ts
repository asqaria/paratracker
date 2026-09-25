import { RETENTION, TIME } from '@skyline/core';
import type { ExpiredFlight } from '@skyline/db';

/**
 * Уборка анонимных загрузок по сроку хранения (ТЗ §11.2, задача 1.14).
 * Только сетевой ввод-вывод, без CPU — живёт в основном потоке воркера.
 *
 * Порядок: сначала объекты в S3, потом строка. Упали между ними — строка
 * осталась, следующий проход повторит (удаление в S3 идемпотентно).
 * Наоборот нельзя: объекты без строки уже никто бы не нашёл.
 */

export interface RetentionRepository {
  listExpired(before: Date, limit: number): Promise<ExpiredFlight[]>;
  delete(ids: readonly string[]): Promise<number>;
}

export interface RetentionStorage {
  delete(key: string): Promise<void>;
}

export interface RetentionSweepOptions {
  repository: RetentionRepository;
  storage: RetentionStorage;
  /** UNIX мс; внедряется ради теста. */
  now: () => number;
  /** Сколько полётов выбирается за один запрос. */
  batchSize: number;
  onError: (error: unknown, flightId?: string) => void;
}

export interface RetentionSweepResult {
  deleted: number;
  /** Полёты, чьи объекты не удалились: строка оставлена до следующего прохода. */
  failed: number;
}

export interface RetentionSweep {
  run(): Promise<RetentionSweepResult>;
}

const TTL_MS = RETENTION.anonymousDays * TIME.secondsPerDay * TIME.msPerSecond;

export function createRetentionSweep(options: RetentionSweepOptions): RetentionSweep {
  const { repository, storage, batchSize, onError } = options;

  const removeObjects = async (flight: ExpiredFlight): Promise<boolean> => {
    try {
      await storage.delete(flight.rawObjectKey);
      if (flight.trackObjectKey !== null) await storage.delete(flight.trackObjectKey);
      return true;
    } catch (error) {
      onError(error, flight.id);
      return false;
    }
  };

  return {
    async run() {
      const before = new Date(options.now() - TTL_MS);
      const result: RetentionSweepResult = { deleted: 0, failed: 0 };

      for (;;) {
        const batch = await repository.listExpired(before, batchSize);
        const removed: string[] = [];
        for (const flight of batch) {
          if (await removeObjects(flight)) removed.push(flight.id);
        }
        if (removed.length > 0) result.deleted += await repository.delete(removed);
        result.failed += batch.length - removed.length;

        // Неполная пачка — выбрали всё. Отказ в пачке — стоп: следующий запрос
        // вернул бы те же полёты, и проход крутился бы на них вечно.
        if (batch.length < batchSize || removed.length < batch.length) return result;
      }
    },
  };
}
