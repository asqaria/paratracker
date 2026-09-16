import { lazy, Suspense } from 'react';

import { useT } from '../i18n/locale';
import { useTrack } from '../viewer/use-track';

/**
 * Страница просмотрщика. Cesium грузится ленивым чанком (ТЗ §7.7) — здесь
 * его импорта нет, иначе он попал бы в начальный чанк и бюджет 250 КБ упал бы.
 */
const Scene = lazy(() => import('../viewer/index'));

export interface FlightViewerPageProps {
  /** Откуда брать .track: /api/v1/flights/{id}/track или демо-файл. */
  trackUrl: string;
}

export function FlightViewerPage({ trackUrl }: FlightViewerPageProps) {
  const t = useT();
  const track = useTrack(trackUrl);

  if (track.status === 'loading') {
    return (
      <p role="status" className="grid min-h-dvh place-items-center text-secondary">
        {t('viewer.loading')}
      </p>
    );
  }

  if (track.status === 'error') {
    return (
      <div className="grid min-h-dvh place-items-center">
        <p role="alert" className="text-danger">
          {t('viewer.error')}
        </p>
        <p className="font-numeric text-xs text-secondary">{track.message}</p>
      </div>
    );
  }

  return (
    <Suspense
      fallback={
        <p role="status" className="grid min-h-dvh place-items-center text-secondary">
          {t('viewer.loadingScene')}
        </p>
      }
    >
      <Scene
        track={track.track}
        labels={{
          imagery: t('viewer.imagery'),
          points: t('viewer.points'),
          sentinel2: t('viewer.imagery.sentinel2'),
          esri: t('viewer.imagery.esri'),
        }}
      />
    </Suspense>
  );
}
