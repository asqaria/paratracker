import { useQuery } from '@tanstack/react-query';

import { FlightViewerPage } from '../flight/FlightViewerPage';
import { useLocaleStore, useT } from '../i18n/locale';
import { resolveShare, withShare } from './sharing-api';

/**
 * Полёт по ссылке «по ссылке» (#/s/{токен}, задача 3.7): без входа. Токен
 * идёт во все запросы полёта — без него посторонний полёт не увидит.
 * embed — тот же полёт в iframe чужого сайта (/embed/{токен}, задача 3.9).
 */
export function SharedFlightPage({ token, embed = false }: { token: string; embed?: boolean }) {
  const t = useT();
  const locale = useLocaleStore((state) => state.locale);
  const flight = useQuery({ queryKey: ['share', token], queryFn: () => resolveShare(token), retry: false, staleTime: Infinity });

  if (flight.status === 'pending') {
    return (
      <p role="status" className="grid min-h-dvh place-items-center text-secondary">
        {t('viewer.loading')}
      </p>
    );
  }
  if (flight.status === 'error' || flight.data === null) {
    return (
      <main lang={locale} className="grid min-h-dvh place-items-center p-6 text-center">
        <div>
          <p role="alert" className="text-lg">
            {t('share.notFound')}
          </p>
          <a href="/#/" {...(embed ? { target: '_blank', rel: 'noopener' } : {})} className="mt-4 inline-block text-accent">
            {t('app.name')}
          </a>
        </div>
      </main>
    );
  }
  return (
    <FlightViewerPage
      flightId={flight.data}
      trackUrl={withShare(`/api/v1/flights/${flight.data}/track`, token)}
      share={token}
      embed={embed}
    />
  );
}
