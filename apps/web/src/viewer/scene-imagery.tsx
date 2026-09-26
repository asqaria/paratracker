import { useQuery } from '@tanstack/react-query';
import type { TileProviderError, Viewer } from 'cesium';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';

import { useT } from '../i18n/locale';
import { fetchImageryCapabilities } from './imagery-capabilities';
import {
  availableImagery,
  collapsedAttribution,
  imagerySourceById,
  imagerySources,
  preferredImagery,
  terrainSource,
  tileFailureTracker,
  type AttributionEntry,
  type ImageryId,
  type ImagerySource,
  type ViewerConfig,
} from './providers';
import { createImageryProvider, httpStatusOf, IMAGERY_CAPABILITIES_STALE_MS } from './scene-kit';

/**
 * Подложка сцены и её атрибуция — общие для просмотрщика полёта и сравнения
 * (задача 3.12): выбор, откат Esri → Sentinel-2 при отказе тайлов, подпись
 * лицензий, которая меняется вместе с подложкой (ТЗ §4.4, §11.3).
 */

export interface SceneImagery {
  /** Все настроенные подложки: по ним строится Viewer. */
  sources: ImagerySource[];
  /** Подложки, которые сервер подтвердил, — только для них кнопки. */
  shownSources: ImagerySource[];
  imagery: ImageryId;
  /** Подложка при создании Viewer: в зависимостях эффекта её держать нельзя (сбросило бы время). */
  imageryRef: RefObject<ImageryId>;
  notice: string | null;
  /** Выбор пилота: умолчание его больше не меняет. */
  choose(id: ImageryId): void;
  attribution: AttributionEntry[];
}

export function useSceneImagery(config: ViewerConfig | null, viewerRef: RefObject<Viewer | null>): SceneImagery {
  const t = useT();
  const sources = useMemo(() => (config ? imagerySources(config) : []), [config]);
  // Кнопки — только для подложек, которые сервер подтвердил. Сам Viewer строится
  // по полному списку: смена sources в его зависимостях пересоздала бы сцену
  // и сбросила бы время проигрывания, когда придёт ответ.
  const capabilities = useQuery({
    queryKey: ['imagery-capabilities'],
    queryFn: ({ signal }) => fetchImageryCapabilities(signal),
    staleTime: IMAGERY_CAPABILITIES_STALE_MS,
    retry: false,
  });
  const shownSources = useMemo(() => availableImagery(sources, capabilities.data), [sources, capabilities.data]);
  const [notice, setNotice] = useState<string | null>(null);
  const stopTileWatch = useRef<(() => void) | null>(null);
  const [imagery, setImagery] = useState<ImageryId>('sentinel2');
  const imageryRef = useRef<ImageryId>(imagery);
  /** Пользователь сам выбрал подложку — умолчание её больше не меняет. */
  const chosenRef = useRef(false);

  /** Переключение подложки: слой пересоздаётся, атрибуция меняется вместе с ним. */
  const switchImagery = (id: ImageryId, nextNotice: string | null = null): void => {
    const viewer = viewerRef.current;
    const source = config ? imagerySourceById(config, id) : null;
    if (!viewer || !source) return;
    stopTileWatch.current?.();
    stopTileWatch.current = null;
    viewer.imageryLayers.removeAll();
    const layer = createImageryProvider(source);
    viewer.imageryLayers.add(layer);
    // Esri через прокси может перестать отдавать тайлы (истёк ключ, лимит, сбой).
    // Поток ошибок — откат на Sentinel-2 с объяснением, а не синий шар.
    // Для Sentinel-2 отката нет: откатываться некуда, пусть будет видно.
    if (id !== 'sentinel2') {
      const tracker = tileFailureTracker();
      stopTileWatch.current = layer.imageryProvider.errorEvent.addEventListener((error: TileProviderError) => {
        if (tracker.failed(httpStatusOf(error))) switchImagery('sentinel2', t('viewer.imagery.fallback'));
      });
    }
    viewer.scene.requestRender();
    imageryRef.current = id;
    setImagery(id);
    setNotice(nextNotice);
  };

  // Подложка по умолчанию — Esri, как только сервер её подтвердил: до ответа
  // сцена стартует на Sentinel-2 (он без ключа и лимитов) и переключается.
  const preferred = preferredImagery(shownSources);
  useEffect(() => {
    if (chosenRef.current || preferred === imageryRef.current) return;
    if (viewerRef.current) {
      switchImagery(preferred);
    } else {
      imageryRef.current = preferred;
      setImagery(preferred);
    }
    // Зависимость — только preferred: switchImagery пересоздаётся каждый рендер.
  }, [preferred]);

  const active = (config ? imagerySourceById(config, imagery) : null) ?? sources[0] ?? null;
  const attribution = config ? [...terrainSource(config).attribution, ...(active?.attribution ?? [])] : [];

  return {
    sources,
    shownSources,
    imagery,
    imageryRef,
    notice,
    choose: (id) => {
      chosenRef.current = true;
      switchImagery(id);
    },
    attribution,
  };
}

/** Переключатель подложки — один на десктопе (панель сверху) и на телефоне (шторка). */
export function ImageryButtons({ imagery }: { imagery: SceneImagery }) {
  const t = useT();
  return (
    <>
      <div role="group" aria-label={t('viewer.imagery')} className="flex gap-1">
        {imagery.shownSources.map((source) => (
          <button
            key={source.id}
            type="button"
            aria-pressed={source.id === imagery.imagery}
            onClick={() => imagery.choose(source.id)}
            className="rounded px-2 py-1 text-secondary aria-pressed:bg-subtle aria-pressed:text-primary compact:min-h-11"
          >
            {source.id === 'esri' ? t('viewer.imagery.esri') : t('viewer.imagery.sentinel2')}
          </button>
        ))}
      </div>
      {imagery.notice !== null && (
        <p role="status" className="max-w-48 text-xs text-danger">
          {imagery.notice}
        </p>
      )}
    </>
  );
}

/**
 * Атрибуция рельефа и подложки. На телефоне свёрнута до названий источников и
 * «Powered by Esri» (collapsedAttribution), полный текст — по кнопке. Не скрывается.
 */
export function SceneAttribution({ entries }: { entries: readonly AttributionEntry[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <div data-panel="attribution" className="flex items-center bg-void/70 text-xs text-secondary compact:text-2xs">
      <AttributionLine entries={entries} className={open ? '' : 'compact:hidden'} />
      <AttributionLine entries={collapsedAttribution(entries)} className={open ? 'hidden' : 'hidden compact:block'} />
      <button
        type="button"
        aria-expanded={open}
        aria-label={open ? t('viewer.attribution.less') : t('viewer.attribution.more')}
        onClick={() => setOpen((value) => !value)}
        className="hidden min-h-6 px-3 text-primary compact:block"
      >
        {open ? '▴' : '▾'}
      </button>
    </div>
  );
}

/** Строка атрибуции: подпись «Рельеф» / «Подложка» переводится, текст лицензии — дословно. */
function AttributionLine({ entries, className }: { entries: readonly AttributionEntry[]; className: string }) {
  const t = useT();
  return (
    <p className={`flex-1 px-3 py-1 compact:py-0.5 ${className}`}>
      {entries.map((entry, index) => (
        <span key={entry.text}>
          {index > 0 && ' · '}
          {entry.label !== undefined && `${t(`viewer.attribution.${entry.label}`)}: `}
          {entry.href === undefined ? (
            entry.text
          ) : (
            <a href={entry.href} target="_blank" rel="noopener noreferrer" className="text-accent">
              {entry.text}
            </a>
          )}
        </span>
      ))}
    </p>
  );
}
