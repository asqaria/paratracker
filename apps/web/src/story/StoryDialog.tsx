import type { FlightDetailsResponse } from '@skyline/core';
import { flightRange } from '@skyline/analysis';
import { useEffect, useState } from 'react';

import { fill, useLocaleStore, useT } from '../i18n/locale';
import type { DecodedTrack } from '../viewer/decode-track';
import { formatDuration } from '../viewer/format-summary';
import { imagerySources, type ViewerConfig } from '../viewer/providers';
import { kilometres, metres } from '../viewer/units';
import { renderStory, type StoryData, type StoryVariant, type TileLoader } from './render-story';

/**
 * Картинка для сторис (задача 4.8): два варианта — со спутником и прозрачный
 * поверх своего фото. На телефоне «Поделиться» открывает системное меню (там
 * Instagram), на компьютере — «Скачать».
 */

export interface StoryDialogProps {
  track: DecodedTrack;
  details: FlightDetailsResponse | null;
  /** Конфиг сцены: адрес тайлов Esri; esriAvailable — сервер подтвердил прокси. */
  config: ViewerConfig | null;
  esriAvailable: boolean;
  onClose: () => void;
}

const VARIANTS: readonly StoryVariant[] = ['full', 'overlay'];
const MS_PER_SECOND = 1000;

function tileLoader(template: string): TileLoader {
  return async (z, x, y) => {
    const response = await fetch(template.replace('{z}', String(z)).replace('{y}', String(y)).replace('{x}', String(x)));
    return response.ok ? createImageBitmap(await response.blob()) : null;
  };
}

export function StoryDialog({ track, details, config, esriAvailable, onClose }: StoryDialogProps) {
  const t = useT();
  const locale = useLocaleStore((state) => state.locale);
  const [images, setImages] = useState<Partial<Record<StoryVariant, { blob: Blob; url: string }>>>({});
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const range = flightRange(track.t, track.gSpeed);
    const from = range.takeoff;
    const to = Math.max(range.takeoff, range.landing);
    const startMs = track.t[from] ?? track.t[0] ?? 0;
    const airtimeS = Math.max(0, ((track.t[to] ?? startMs) - startMs) / MS_PER_SECOND);
    const date = new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: details?.timezone ?? 'UTC',
    }).format(new Date(details?.startedAt ?? startMs));
    const xc = details?.xc ?? null;
    const esri = config && esriAvailable ? imagerySources(config).find((s) => s.id === 'esri') : undefined;
    const data: StoryData = {
      lat: track.lat,
      lon: track.lon,
      alt: track.alt,
      vSpeed: track.vSpeed,
      from,
      to,
      title: date,
      subtitle: details?.takeoffSite?.name ?? null,
      stats: [
        { label: t('story.airtime'), value: formatDuration(airtimeS, t) },
        { label: t('story.distance'), value: kilometres(track.summary.distanceTrackM, locale, t) },
        { label: t('story.maxAlt'), value: metres(track.summary.maxAltM, locale, t) },
        xc
          ? {
              label: fill(t('story.xc'), { rules: xc.rules }),
              value: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(xc.score),
            }
          : { label: t('story.gain'), value: metres(track.summary.maxGainM, locale, t) },
      ],
      brand: t('app.name'),
      attribution: esri ? esri.attribution.map((entry) => entry.text).join(' · ') : null,
    };
    const tiles = esri && config?.esriTileUrl ? tileLoader(config.esriTileUrl) : null;
    let cancelled = false;
    const created: string[] = [];
    Promise.all(VARIANTS.map((variant) => renderStory(data, variant, tiles)))
      .then((blobs) => {
        if (cancelled) return;
        const next: Partial<Record<StoryVariant, { blob: Blob; url: string }>> = {};
        blobs.forEach((blob, k) => {
          const variant = VARIANTS[k];
          if (!variant) return;
          const url = URL.createObjectURL(blob);
          created.push(url);
          next[variant] = { blob, url };
        });
        setImages(next);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      created.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [track, details, config, esriAvailable, locale, t]);

  const fileOf = (variant: StoryVariant): File | null => {
    const image = images[variant];
    return image ? new File([image.blob], `skyline-${variant}.png`, { type: 'image/png' }) : null;
  };
  const canShare = (variant: StoryVariant): boolean => {
    const file = fileOf(variant);
    return file !== null && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
  };
  const share = (variant: StoryVariant): void => {
    const file = fileOf(variant);
    if (file) void navigator.share({ files: [file] }).catch(() => undefined);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('story.title')}
      data-panel="story"
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-void/80 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex w-full max-w-2xl flex-col gap-4 rounded-xl glass p-4 text-sm">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">{t('story.title')}</h2>
          <button type="button" onClick={onClose} className="rounded px-2 py-1 text-secondary hover:text-primary compact:min-h-11">
            {t('story.close')}
          </button>
        </div>
        {failed && (
          <p role="alert" className="text-danger">
            {t('story.error')}
          </p>
        )}
        <div className="grid grid-cols-2 gap-4">
          {VARIANTS.map((variant) => {
            const image = images[variant];
            return (
              <figure key={variant} data-story={variant} className="flex flex-col gap-2">
                <div className="aspect-[9/16] overflow-hidden rounded-lg bg-[repeating-conic-gradient(var(--color-subtle)_0_25%,transparent_0_50%)] bg-[length:24px_24px]">
                  {image ? (
                    <img src={image.url} alt={t(`story.${variant}`)} className="h-full w-full object-contain" />
                  ) : (
                    <p role="status" className="grid h-full place-items-center text-secondary">
                      {t('story.rendering')}
                    </p>
                  )}
                </div>
                <figcaption className="text-xs text-secondary">{t(`story.${variant}`)}</figcaption>
                <div className="flex gap-2">
                  {canShare(variant) && (
                    <button
                      type="button"
                      onClick={() => share(variant)}
                      className="flex-1 rounded bg-accent px-3 py-1.5 font-semibold text-void compact:min-h-11"
                    >
                      {t('story.share')}
                    </button>
                  )}
                  {image && (
                    <a
                      href={image.url}
                      download={`skyline-${variant}.png`}
                      className="flex-1 rounded bg-subtle px-3 py-1.5 text-center text-primary compact:min-h-11"
                    >
                      {t('story.download')}
                    </a>
                  )}
                </div>
              </figure>
            );
          })}
        </div>
      </div>
    </div>
  );
}
