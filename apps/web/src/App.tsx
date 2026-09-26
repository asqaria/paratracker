import { useEffect, useState } from 'react';

import { FlightViewerPage } from './flight/FlightViewerPage';
import { HealthPage } from './health/HealthPage';
import { routeFromHash, type Route } from './routing';
import { UploadPage } from './upload/UploadPage';

/** Экраны по хэшу (ТЗ §8.2). Роутер появится, когда экранов станет больше. */

const LANDING: Route = { kind: 'landing' };

const currentRoute = (): Route =>
  typeof window === 'undefined' ? LANDING : routeFromHash(window.location.hash);

/**
 * Маршрут пересчитывается на hashchange: редирект после загрузки — это смена
 * хэша, и без подписки страница осталась бы на дропзоне.
 */
export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(currentRoute);

  useEffect(() => {
    const onChange = (): void => setRoute(currentRoute());
    window.addEventListener('hashchange', onChange);
    // Хэш мог измениться между первым рендером и подпиской.
    onChange();
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  return route;
}

export function App() {
  const route = useRoute();

  if (route.kind === 'health') return <HealthPage />;
  if (route.kind === 'flight') return <FlightViewerPage flightId={route.flightId} trackUrl={route.trackUrl} />;
  return <UploadPage />;
}
