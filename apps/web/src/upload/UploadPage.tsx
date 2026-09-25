import type { FlightStatus } from '@skyline/core';
import { useCallback, useEffect, useState } from 'react';

import { LocaleSwitch } from '../i18n/LocaleSwitch';
import { useLocaleStore, useT } from '../i18n/locale';
import { flightHash, HEALTH_HASH } from '../routing';
import { subscribeFlightStatus } from './flight-events';
import {
  hintMessage,
  processingErrorMessage,
  rejectionMessage,
  retentionMessage,
  statusLabel,
  uploadErrorMessage,
} from './messages';
import { ACCEPT_ATTRIBUTE, checkTrackFile, uploadTrack } from './upload-track';

/**
 * Лендинг с дропзоной (ТЗ §8.2, US-01): бросил файл — ушёл в просмотрщик,
 * без регистрации. Прогресс берётся из конвейера, а не изображается таймером.
 */

type Phase =
  | { kind: 'idle' }
  | { kind: 'uploading'; fileName: string }
  | { kind: 'processing'; fileName: string; status: FlightStatus; progress?: number }
  | { kind: 'error'; message: string };

const PERCENT = 100;

export function UploadPage() {
  const t = useT();
  const locale = useLocaleStore((state) => state.locale);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [flightId, setFlightId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const begin = useCallback(
    (file: File) => {
      const rejection = checkTrackFile(file);
      if (rejection !== null) {
        setPhase({ kind: 'error', message: rejectionMessage(t, rejection) });
        return;
      }
      setPhase({ kind: 'uploading', fileName: file.name });
      void uploadTrack(file).then(
        (accepted) => {
          setFlightId(accepted.flightId);
          setPhase({ kind: 'processing', fileName: file.name, status: accepted.status });
        },
        (cause: unknown) => setPhase({ kind: 'error', message: uploadErrorMessage(t, cause) }),
      );
    },
    [t],
  );

  useEffect(() => {
    if (flightId === null) return undefined;
    return subscribeFlightStatus(flightId, {
      onStatus: (event) => {
        if (event.status === 'ready' && event.trackReady) {
          // Готово — уводим в просмотрщик; маршрут слушает hashchange.
          window.location.hash = flightHash(event.flightId);
          return;
        }
        if (event.status === 'failed') {
          setPhase({ kind: 'error', message: processingErrorMessage(t, event.errorCode) });
          return;
        }
        setPhase((previous) =>
          previous.kind === 'processing'
            ? {
                ...previous,
                status: event.status,
                ...(event.progress === undefined ? {} : { progress: event.progress }),
              }
            : previous,
        );
      },
      // Обрыв сети подписка лечит сама опросом /status — тревожить пилота рано.
      onError: () => undefined,
    });
  }, [flightId, t]);

  const reset = (): void => {
    setFlightId(null);
    setPhase({ kind: 'idle' });
  };

  const busy = phase.kind === 'uploading' || phase.kind === 'processing';
  const percent = phase.kind === 'processing' && phase.progress !== undefined
    ? Math.round(phase.progress * PERCENT)
    : null;

  return (
    <main lang={locale} className="grid min-h-dvh place-items-center p-6">
      <section className="w-full max-w-xl rounded-2xl border border-subtle bg-glass p-6 backdrop-blur-xl">
        <header className="mb-6 flex items-center justify-between">
          <h1 className="text-lg font-semibold">{t('app.name')}</h1>
          <LocaleSwitch />
        </header>

        {busy ? (
          <div className="rounded-xl border border-subtle p-8 text-center">
            <p role="status" className="text-lg">
              {phase.kind === 'uploading' ? t('upload.uploading') : statusLabel(t, phase.status)}
            </p>
            <p className="mt-1 font-numeric text-xs text-secondary">{phase.fileName}</p>

            {/* Полоса прогресса определённая только когда конвейер сообщил долю. */}
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={PERCENT}
              {...(percent === null ? {} : { 'aria-valuenow': percent })}
              className="mt-6 h-1 w-full overflow-hidden rounded bg-subtle"
            >
              <div
                className={`h-full bg-accent ${percent === null ? 'w-1/3 animate-pulse' : ''}`}
                style={percent === null ? undefined : { width: `${percent}%` }}
              />
            </div>
            {percent !== null && (
              <p className="mt-2 font-numeric tabular-nums text-sm text-secondary">{`${percent}%`}</p>
            )}
          </div>
        ) : (
          <label
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              const file = event.dataTransfer.files.item(0);
              if (file) begin(file);
            }}
            className={`block cursor-pointer rounded-xl border border-dashed p-10 text-center transition-colors ${
              dragging ? 'border-accent bg-subtle' : 'border-subtle'
            }`}
          >
            <input
              type="file"
              accept={ACCEPT_ATTRIBUTE}
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.item(0);
                if (file) begin(file);
              }}
            />
            <p className="text-xl">{t('upload.title')}</p>
            <p className="mt-2 text-sm text-secondary">{hintMessage(t)}</p>
            <p className="mt-4 text-sm text-accent">{t('upload.browse')}</p>
          </label>
        )}

        {/* ТЗ §11.2: анонимная загрузка живёт ограниченный срок — пилот знает об этом заранее. */}
        <p className="mt-3 text-center text-xs text-secondary">{retentionMessage(t, locale)}</p>

        {phase.kind === 'error' && (
          <div className="mt-4 flex items-center justify-between gap-4">
            <p role="alert" className="text-danger">
              {phase.message}
            </p>
            <button type="button" onClick={reset} className="rounded bg-subtle px-3 py-1 text-sm">
              {t('upload.retry')}
            </button>
          </div>
        )}

        <footer className="mt-6 flex items-center justify-between text-sm">
          <a href="#/demo" className="text-accent">
            {t('upload.demo')}
          </a>
          <a href={HEALTH_HASH} className="text-secondary">
            {t('upload.health')}
          </a>
        </footer>
      </section>
    </main>
  );
}
