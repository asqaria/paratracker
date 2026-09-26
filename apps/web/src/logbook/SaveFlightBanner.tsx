import { signInUrl, useMe, useProviders } from '../auth/session';
import { useT } from '../i18n/locale';
import { flightHash } from '../routing';
import { hasClaim } from './claims';

interface SaveFlightBannerViewProps {
  show: boolean;
  flightId: string;
}

/**
 * «Сохраните полёт в логбук» (ТЗ §7.1): полёт загружен в этом браузере без
 * входа и через 30 дней удалится. Вход возвращает на этот же полёт, а
 * ClaimOnSignIn переносит его в логбук.
 */
export function SaveFlightBannerView({ show, flightId }: SaveFlightBannerViewProps) {
  const t = useT();
  if (!show) return null;
  return (
    <a
      data-panel="save-banner"
      href={signInUrl(flightHash(flightId))}
      className="fixed top-3 left-1/2 z-20 -translate-x-1/2 rounded-full glass px-4 py-2 text-sm text-primary hover:text-accent"
    >
      {t('logbook.saveBanner')}
    </a>
  );
}

export function SaveFlightBanner({ flightId }: { flightId: string }) {
  const me = useMe();
  const providers = useProviders();
  return <SaveFlightBannerView show={me === null && providers?.google === true && hasClaim(flightId)} flightId={flightId} />;
}
